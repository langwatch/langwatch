import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lintApiTransportBoundaries } from "../src/index.ts";
import type { ArchitectureViolation, ClassifiedPackage } from "../src/index.ts";
import { snapshotOf } from "./workspace.ts";

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
  const packageRoot = join(root, "modules/widget/server");
  return {
    name: "@langwatch/widget-server",
    root: packageRoot,
    manifestPath: join(packageRoot, "package.json"),
    manifest: { name: "@langwatch/widget-server" },
    kind: "server",
    feature: "widget",
    featureRoot: join(root, "modules/widget"),
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
  return lintApiTransportBoundaries(snapshotOf({ root, packages }));
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
      "modules/widget/server/src/api/public/widget.api.ts",
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

  it("reports a path that can actually be opened", () => {
    // `lintAll` relativises every violation once, against the same root. This
    // rule used to do it a second time, which resolved an already-relative path
    // against the lint package's own directory and reported all thirteen real
    // findings under `packages/architecture-enforcer/apps/api/...` — a path that
    // does not exist, so the reader could not open the file the rule named.
    write(
      "apps/api/src/features/thing/thing.api.ts",
      'import type { PrismaClient } from "@langwatch/prisma-client/generated";\nexport type T = PrismaClient;',
    );

    const [violation] = violations([apiApplication()]);

    expect(violation).toBeDefined();
    expect(existsSync(violation!.file)).toBe(true);
  });

  it("does not scan apps/api's *.mount.ts files — a mount is a composition seam", () => {
    write(
      "apps/api/src/features/thing/thing.mount.ts",
      'import type { PrismaClient } from "@langwatch/prisma-client/generated";\nexport type T = PrismaClient;',
    );

    expect(violations([apiApplication()])).toEqual([]);
  });

  it("does not scan a feature composition root under apps/api's features", () => {
    write(
      "apps/api/src/features/thing/thing.composition.ts",
      'import type { PrismaClient } from "@langwatch/prisma-client/generated";\nexport type T = PrismaClient;',
    );

    expect(violations([apiApplication()])).toEqual([]);
  });

  it("does not treat apps/api's composition roots or platform/infrastructure as transport", () => {
    write(
      "apps/api/src/app/api-usage.composition.ts",
      'import type { PrismaClient } from "@langwatch/prisma-client/generated";\nexport type T = PrismaClient;',
    );
    write(
      "apps/api/src/platform/infrastructure/api-database.infrastructure.ts",
      'import type { PrismaClient } from "@langwatch/prisma-client/generated";\nexport type T = PrismaClient;',
    );

    expect(violations([apiApplication()])).toEqual([]);
  });

  it("still scans apps/api's app-trpc and app-rest roots", () => {
    write(
      "apps/api/src/app-trpc/thing.router.ts",
      'import type { PrismaClient } from "@langwatch/prisma-client/generated";\nexport type T = PrismaClient;',
    );
    write(
      "apps/api/src/app-rest/thing.api.ts",
      'import type { PrismaClient } from "@langwatch/prisma-client/generated";\nexport type T = PrismaClient;',
    );

    const found = violations([apiApplication()]);
    expect(found).toHaveLength(2);
  });

  it("rejects persistence, environment and application implementation imports", () => {
    write(
      "modules/widget/server/src/api/public/widget.api.ts",
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
      "modules/widget/server/src/api/public/widget.api.ts",
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

  it("rejects legacy registerRoute handlers through the same global boundary", () => {
    write(
      "modules/widget/server/src/transport/api-rest/widget.api.ts",
      `
        declare const service: { registerRoute(...args: unknown[]): void };
        const handler = async (context: { req: Request }) => context.req;
        service.registerRoute("get", "/widgets", "2026-08-28", handler, () => undefined);
      `,
    );

    expect(policy("api-transport-handler-boundary")).toEqual([
      expect.objectContaining({
        message: "Handler reaches raw request context through context.req (ADR-133).",
      }),
      expect.objectContaining({
        message: "Legacy registerRoute handler bypasses the fluent endpoint boundary.",
      }),
    ]);
  });

  it("rejects raw Hono route registration in a strict feature API", () => {
    write(
      "modules/widget/server/src/api/public/widget.api.ts",
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
      "modules/widget/server/src/api/public/widget.api.ts",
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

  it("refuses a transport that reads the caller off the request context bag", () => {
    write(
      "modules/widget/server/src/api/public/widget.api.ts",
      `
        declare const c: { get(key: string): unknown };
        const apiKeyId = c.get("apiKeyId");
        const userId = c.get("apiKeyUserId");
        const token = c.get("resolvedToken");
        void [apiKeyId, userId, token];
      `,
    );

    expect(policy("api-transport-credential-context")).toHaveLength(3);
  });

  it("accepts a transport reading the application's own context keys", () => {
    write(
      "modules/widget/server/src/api/public/widget.api.ts",
      `
        declare const c: { get(key: string): unknown };
        void c.get("project");
      `,
    );

    expect(policy("api-transport-credential-context")).toEqual([]);
  });

  it("accepts a synchronous request query-string reader", () => {
    write(
      "modules/widget/server/src/api/public/widget.api.ts",
      `
        type RequestQuery = {
          query(name: string): string | undefined;
        };
        declare const request: RequestQuery;
        void request.query("anchor");
      `,
    );

    expect(policy("api-transport-service-locator")).toEqual([]);
  });

  it("keeps endpoint handlers to one service call without domain control flow", () => {
    write(
      "modules/widget/server/src/api/public/widget.api.ts",
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

  it.each([
    [
      "direct",
      "context.app.widget.widgets.get(input); return context.app.widget.widgets.update(input);",
    ],
    [
      "service alias",
      "const widgets = context.app.widget.widgets; widgets.get(input); return widgets.update(input);",
    ],
    [
      "app alias",
      "const widget = context.app.widget; widget.widgets.get(input); return widget.widgets.update(input);",
    ],
    [
      "destructured service",
      "const { widgets } = context.app.widget; widgets.get(input); return widgets.update(input);",
    ],
    [
      "nested destructuring",
      "const { widget: { widgets } } = context.app; widgets.get(input); return widgets.update(input);",
    ],
  ])("counts nested feature service calls through %s", (_name, body) => {
    write(
      "modules/widget/server/src/api/public/widget.api.ts",
      `
      group.register("many", "2026-08-28", async (context, input) => { ${body} });
    `,
    );
    expect(policy("api-transport-handler-shape")).toEqual([
      expect.objectContaining({ message: "Endpoint handler makes 2 canonical service calls." }),
    ]);
  });

  it("rejects nested feature-service calls inside callbacks", () => {
    write(
      "modules/widget/server/src/api/public/widget.api.ts",
      `
      group.register("nested", "2026-08-28", async (context, input) => {
        return Promise.all(input.ids.map(id => context.app.widget.widgets.get(id)));
      });
    `,
    );
    expect(policy("api-transport-handler-shape")).toEqual([
      expect.objectContaining({
        message: "Endpoint handler calls a canonical service from a nested callback.",
      }),
    ]);
  });

  it("applies the same thin-handler law to every fluent REST method", () => {
    write(
      "modules/widget/server/src/api/public/widget.api.ts",
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
      "apps/api/src/app-rest/widget.transport.ts",
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

  it("requires inline handlers and rejects raw transport responses and empty sentinels", () => {
    write(
      "modules/widget/server/src/api/public/widget.api.ts",
      `
        declare const rest: { get(...args: unknown[]): void };
        const detached = async (context: { req: Request; app: { widgets: { get(): Promise<unknown> } } }) => {
          context.req;
          return NO_CONTENT;
        };
        rest.get("/widgets", "2026-08-28", (endpoint) => endpoint.handle(detached));
        rest.get("/raw", "2026-08-28", (endpoint) => endpoint.handle(async (context) => {
          context.status = 204;
          return context.json({ ok: true });
        }));
        rest.get("/response", "2026-08-28", (endpoint) => endpoint.handle(() => new Response("ok")));
      `,
    );

    expect(policy("api-transport-handler-boundary").map(({ message }) => message)).toEqual([
      "Handler calls transport response method json() (ADR-133).",
      "Handler constructs a raw Response (ADR-133).",
      "Handler reaches raw request context through context.req (ADR-133).",
      "Handler returns the NO_CONTENT sentinel (ADR-133).",
      "Fluent endpoint handler must be an inline function.",
      "Handler mutates transport response state through context.status (ADR-133).",
    ]);
  });

  it("allows the complete typed handler context and a void return", () => {
    write(
      "modules/widget/server/src/api/public/widget.api.ts",
      `
        declare const rest: { post(...args: unknown[]): void };
        rest.post("/widgets", "2026-08-28", (endpoint) => endpoint.handle(async ({ input, app, actor, scope, signal }) => {
          await app.widgets.create({ input, actor, scope, signal });
          return void 0;
        }));
      `,
    );

    expect(policy("api-transport-handler-boundary")).toEqual([]);
  });

  it("rejects handler header access and response-shaped methods while allowing DTO status", () => {
    write(
      "modules/widget/server/src/api/public/widget.api.ts",
      `
        declare const rest: { post(...args: unknown[]): void };
        rest.post("/widgets", "2026-08-28", (endpoint) => endpoint.withInput({}).handle(async ({ input, app }) => {
          const data = input;
          data.headers;
          data.status = "draft";
          await app.text({ value: data.headers });
          return NO_CONTENTS;
        }));
      `,
    );

    expect(policy("api-transport-handler-boundary").map(({ message }) => message)).toEqual([
      "Handler accesses transport headers through data.headers (ADR-133).",
      "Handler calls transport response method text() (ADR-133).",
      "Handler accesses transport headers through data.headers (ADR-133).",
    ]);
  });

  it("rejects computed raw context access and handler factories", () => {
    write(
      "modules/widget/server/src/api/public/widget.api.ts",
      `
        declare const rest: { get(...args: unknown[]): void };
        const makeHandler = () => async (context: unknown) => context;
        rest.get("/raw", "2026-08-28", (endpoint) => endpoint.handle(async (context) => context["req"]));
        rest.get("/factory", "2026-08-28", (endpoint) => endpoint.handle(makeHandler()));
      `,
    );

    expect(policy("api-transport-handler-boundary").map(({ message }) => message)).toEqual([
      'Handler reaches raw request context through context["req"] (ADR-133).',
      "Fluent endpoint handler must be an inline function.",
    ]);
  });
});

describe("feature app construction", () => {
  it.each(["new WidgetApp()", "WidgetApp.create()", "createWidgetApp()"])(
    "rejects %s in a request handler",
    (construction) => {
      write(
        "modules/widget/server/src/api/public/widget.api.ts",
        `
      group.register("create", "2026-08-28", async (context, input) => ${construction});
    `,
      );
      expect(policy("api-transport-construction")).toEqual([
        expect.objectContaining({ message: expect.stringContaining("WidgetApp") }),
      ]);
    },
  );
});
