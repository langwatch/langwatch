import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lintApiTransportBoundaries } from "../src";
import type { ArchitectureViolation, ClassifiedPackage } from "../src";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "langwatch-api-transport-boundaries-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(path: string, content: string): void {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

function featureServer(): ClassifiedPackage {
  const packageRoot = join(root, "packages/features/widget/server");
  return {
    name: "@langwatch/widget-server",
    root: packageRoot,
    manifestPath: join(packageRoot, "package.json"),
    manifest: { name: "@langwatch/widget-server" },
    kind: "server",
    feature: "widget",
    featureRoot: join(root, "packages/features/widget"),
    layoutVersion: 0,
    subjects: ["widget"],
    enterprise: false,
  };
}

function apiApplication(): ClassifiedPackage {
  const packageRoot = join(root, "apps/api");
  return {
    name: "@langwatch/platform-api",
    root: packageRoot,
    manifestPath: join(packageRoot, "package.json"),
    manifest: { name: "@langwatch/platform-api" },
    kind: "application",
    applicationRole: "api",
    enterprise: false,
  };
}

function violations(packages: readonly ClassifiedPackage[]): ArchitectureViolation[] {
  return lintApiTransportBoundaries(root, packages);
}

function policy(
  name: string,
  packages: readonly ClassifiedPackage[] = [featureServer()],
): ArchitectureViolation[] {
  return violations(packages).filter((violation) => violation.policy === name);
}

describe("strict feature API transport boundaries", () => {
  it("allows typed @langwatch/api registration over a composed service", () => {
    write(
      "packages/features/widget/server/src/api/public/widget.api.ts",
      `
        import type { ServiceBuilder } from "@langwatch/api";
        import type { WidgetService } from "@langwatch/widget-contract";

        type App = { widgets: WidgetService };

        export function install(api: ServiceBuilder<unknown, Record<string, unknown>, App>) {
          const group = api.group("widgets");
          group.register(
            "get",
            "2026-08-28",
            (_context, input) => _context.app.widgets.get(input),
            (builder) => builder.withRateLimit().withMiddleware(() => undefined),
          );
        }
      `,
    );

    expect(violations([featureServer()])).toEqual([]);
  });

  it("rejects persistence, environment and application implementation imports", () => {
    write(
      "packages/features/widget/server/src/api/public/widget.api.ts",
      `
        import { PrismaClient } from "@langwatch/prisma-client/generated";
        import { WidgetRepository } from "../../repositories/widget.repository";
        import { env } from "~/env.mjs";
        import { getRuntime } from "~/server/app-layer/runtime";
        void [PrismaClient, WidgetRepository, env, getRuntime];
      `,
    );

    expect(policy("api-transport-import-boundary")).toEqual([
      expect.objectContaining({ specifier: "@langwatch/prisma-client/generated" }),
      expect.objectContaining({ specifier: "../../repositories/widget.repository" }),
      expect.objectContaining({ specifier: "~/env.mjs" }),
      expect.objectContaining({ specifier: "~/server/app-layer/runtime" }),
    ]);
  });

  it("rejects service and repository construction in inline and named handlers", () => {
    write(
      "packages/features/widget/server/src/api/public/widget.api.ts",
      `
        class WidgetService { static create() { return new WidgetService(); } }
        class WidgetRepository {}
        const namedHandler = () => new WidgetRepository();
        declare const group: { register(...args: unknown[]): void };

        group.register("list", "2026-08-28", () => WidgetService.create());
        group.register("get", "2026-08-28", namedHandler);
      `,
    );

    expect(policy("api-transport-construction")).toEqual([
      expect.objectContaining({ message: "Endpoint handler constructs WidgetRepository." }),
      expect.objectContaining({ message: "Endpoint handler constructs WidgetService." }),
    ]);
  });

  it("rejects raw Hono route registration in a strict feature API", () => {
    write(
      "packages/features/widget/server/src/api/public/widget.api.ts",
      `
        import type { Hono } from "hono";
        export function install(app: Hono) {
          app.get("/widgets/:id", (context) => context.json({ id: "widget_1" }));
        }
      `,
    );

    expect(policy("api-transport-builder")).toEqual([
      expect.objectContaining({ message: "Strict feature API registers raw Hono route get()." }),
    ]);
  });

  it("rejects generic string-path query and mutate dispatch", () => {
    write(
      "packages/features/widget/server/src/api/public/widget.api.ts",
      `
        abstract class RpcClient {
          abstract query(path: string, input: unknown): Promise<unknown>;
          abstract mutate(path: string, input: unknown): Promise<unknown>;
        }
        type AlternateRpc = {
          query: (path: string, input: unknown) => Promise<unknown>;
        };
        declare const rpc: RpcClient;
        declare const alternate: AlternateRpc;
        void rpc["query"]("widgets.get", { id: "widget_1" });
        void alternate;
      `,
    );

    expect(policy("api-transport-service-locator")).toHaveLength(4);
  });

  it("keeps endpoint handlers to one service call without domain control flow", () => {
    write(
      "packages/features/widget/server/src/api/public/widget.api.ts",
      `
        declare const group: { register(...args: unknown[]): void };
        const toPublic = (value: unknown) => value;
        group.register("allowed", "2026-08-28", async (context, input) => {
          await context.authorize(input.projectId);
          return toPublic(await context.app.widgets.get(input));
        });
        group.register("many", "2026-08-28", async (context, input) => {
          await context.app.widgets.get(input);
          return context.app.widgets.update(input);
        });
        group.register("branch", "2026-08-28", async (context, input) => {
          if (input.archived) return context.app.widgets.archive(input);
          return context.app.widgets.get(input);
        });
        group.register("nested", "2026-08-28", async (context, input) => {
          return Promise.all(input.ids.map((id) => context.app.widgets.get({ id })));
        });
      `,
    );

    const found = policy("api-transport-handler-shape");
    expect(found).toEqual([
      expect.objectContaining({ message: "Endpoint handler makes 2 canonical service calls." }),
      expect.objectContaining({ message: "Endpoint handler contains domain control flow." }),
      expect.objectContaining({ message: "Endpoint handler makes 2 canonical service calls." }),
      expect.objectContaining({
        message: "Endpoint handler calls a canonical service from a nested callback.",
      }),
    ]);
  });

  it("applies the same thin-handler law to every fluent REST method", () => {
    write(
      "packages/features/widget/server/src/api/public/widget.api.ts",
      `
        class WidgetService { static create() { return new WidgetService(); } }
        declare const rest: {
          get(...args: unknown[]): void;
          post(...args: unknown[]): void;
          put(...args: unknown[]): void;
          patch(...args: unknown[]): void;
          delete(...args: unknown[]): void;
        };
        rest.get("/widgets/:id", "2026-08-28", (endpoint) => endpoint.handle(async (context, input) => {
          await context.authorize(input.projectId);
          return context.app.widgets.get(input);
        }));
        rest.post("/widgets", "2026-08-28", (endpoint) => endpoint.handle(async (context, input) => {
          await context.app.widgets.create(input);
          return context.app.widgets.get(input);
        }));
        rest.put("/widgets/:id", "2026-08-28", (endpoint) => endpoint.handle(async (context, input) => {
          if (input.archived) return context.app.widgets.archive(input);
          return context.app.widgets.update(input);
        }));
        rest.patch("/widgets/:id", "2026-08-28", (endpoint) => endpoint.handle(() => WidgetService.create()));
        rest.delete("/widgets/:id", "2026-08-28", (endpoint) => endpoint.handle((context, input) => context.app.widgets.delete(input)));
      `,
    );

    expect(policy("api-transport-construction")).toEqual([
      expect.objectContaining({ message: "Endpoint handler constructs WidgetService." }),
    ]);
    expect(policy("api-transport-handler-shape")).toEqual([
      expect.objectContaining({ message: "Endpoint handler makes 2 canonical service calls." }),
      expect.objectContaining({ message: "Endpoint handler contains domain control flow." }),
      expect.objectContaining({ message: "Endpoint handler makes 2 canonical service calls." }),
    ]);
  });

  it("applies structural import and locator checks to apps/api without banning its Hono root", () => {
    write(
      "apps/api/src/widget.transport.ts",
      `
        import { Hono } from "hono";
        import { env } from "./env";
        const app = new Hono();
        app.get("/health", (context) => context.text("ok"));
        abstract class Rpc { abstract query(path: string): Promise<unknown>; }
        void env;
      `,
    );

    const found = violations([apiApplication()]);
    expect(found.filter((violation) => violation.policy === "api-transport-builder")).toEqual([]);
    expect(
      found.filter((violation) => violation.policy === "api-transport-import-boundary"),
    ).toHaveLength(1);
    expect(
      found.filter((violation) => violation.policy === "api-transport-service-locator"),
    ).toHaveLength(1);
  });
});
