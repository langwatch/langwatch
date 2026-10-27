/**
 * The OpenAPI document generated from the installed declarations, against the api that serves it.
 * @vitest-environment node
 * @see specs/api-reference/openapi-document-generation.feature
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { RestIdentity } from "@langwatch/api/hosting";
import {
  basePathOf,
  DASHBOARDS_API_VERSION,
  RestHost,
  type RestTransportDeclaration,
} from "@langwatch/api/rest";
import { composeApiApplication } from "@langwatch/process";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";
import type { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  describedRestApplication,
  generateOpenApiDocument,
  writeOpenApiDocument,
} from "../openapi-document.ts";
import { processModules } from "../process-modules.generated.ts";
import { bootApi } from "./api-installation.fixture.ts";

const METHODS = ["get", "head", "post", "put", "patch", "delete"] as const;

type OpenApiDocument = { paths: Record<string, Partial<Record<string, unknown>>> };

/** `{id}` and `:id` (with or without a hono pattern) are one parameter slot. */
function addressOf(path: string): string {
  const normalized = path.replace(/\{[^}]+\}/g, "{}").replace(/:[A-Za-z_]\w*(\{[^}]*\})?/g, "{}");
  return normalized.length > 1 ? normalized.replace(/\/$/, "") : normalized;
}

function routeTable(app: Hono): string[] {
  return [...new Set(app.routes.map(({ method, path }) => `${method} ${path}`))].toSorted();
}

/** Describing routes needs no credential: every door refuses, every middleware context throws. */
async function bootedApi() {
  const refuse = () => {
    throw new Error("the test describes routes and answers no request");
  };
  const closed: RestIdentity = {
    authenticate: refuse,
    identify: refuse,
    identifyOptional: refuse,
    authorize: refuse,
    authorizePlatform: refuse,
  };
  const contexts = new Map<string, { middlewareContext: string; resolve: () => never }>();
  for (const module of processModules) {
    for (const transport of module.transports ?? []) {
      if (transport.protocol !== "rest") continue;
      const declaration = transport.router() as {
        routes: readonly { middleware?: readonly { name: string }[] }[];
      };
      for (const route of declaration.routes) {
        for (const declared of route.middleware ?? []) {
          contexts.set(declared.name, { middlewareContext: declared.name, resolve: refuse });
        }
      }
    }
  }

  let rest: RestHost | undefined;
  const { runtime } = await bootApi({
    surface: () => {
      rest = RestHost.create({
        authz: restTestAuthorization().forRequest(),
        identities: {
          project: closed,
          organization: closed,
          api_key: closed,
          instance_admin: closed,
          browser: closed,
        },
        bearers: () => closed,
        audit: { record: async () => {} },
        idempotency: refuse,
        rateLimiter: { check: refuse },
        middlewareContext: [...contexts.values()] as never,
        entitlements: { holds: refuse },
      });
      const mountNothing = { mount: () => {} };

      return {
        hosts: { rest, trpc: mountNothing, websocket: mountNothing, rawhttp: mountNothing },
        serve: () => void 0,
      } as never;
    },
  });
  if (!rest) throw new Error("the api booted without a REST host");

  return { runtime, rest, application: composeApiApplication({ rest }) };
}

describe("the OpenAPI document generated from the installed declarations", () => {
  let booted: Awaited<ReturnType<typeof bootedApi>>;
  let generated: Record<string, unknown>;

  beforeAll(async () => {
    booted = await bootedApi();
    generated = await generateOpenApiDocument();
  }, 240_000);

  afterAll(async () => {
    await booted?.runtime.stop();
  });

  /** @scenario "The generator mounts exactly the route table the api serves" */
  it("mounts exactly the REST route table the booted api serves", () => {
    expect(routeTable(describedRestApplication())).toEqual(routeTable(booted.rest.app));
  });

  /** @scenario "AC199r Split: the Reports boards answer at /api/v1/analytics/reports" */
  it("serves the Reports boards beside the timeseries query, and no /api/v1/boards", () => {
    const { paths } = generated as OpenApiDocument;
    const operations = (path: string) => METHODS.filter((method) => paths[path]?.[method]);

    expect({
      timeseries: operations("/api/v1/analytics"),
      reports: operations("/api/v1/analytics/reports"),
      reorder: operations("/api/v1/analytics/reports/reorder"),
      report: operations("/api/v1/analytics/reports/{reportId}"),
      dashboards: operations("/api/v1/dashboards"),
      boards: Object.keys(paths).filter((path) => path.startsWith("/api/v1/boards")),
    }).toEqual({
      timeseries: ["post"],
      reports: ["get", "post"],
      reorder: ["put"],
      report: ["get", "patch", "delete"],
      dashboards: ["get", "post"],
      boards: [],
    });
  });

  // Across every family the api installs, not only the host test's own.
  /** @scenario "A header leaves a path the dated family does not serve to the route that does" */
  it("pins X-API-Version only for routes of dated families", () => {
    const sample = (path: string) => path.replace(/:\w+(\{[^}]*\})?|\*/g, "x");
    const literal: string[] = [];
    const dated: string[] = [];
    for (const module of processModules) {
      for (const transport of module.transports ?? []) {
        if (transport.protocol !== "rest") continue;
        const declaration = transport.router() as RestTransportDeclaration<unknown>;
        for (const route of declaration.routes) {
          const asked = (path: string) => ({ method: route.method, path: sample(path) });
          if (declaration.addressing === "literal") literal.push(JSON.stringify(asked(route.path)));
          if (declaration.addressing === "dated" && !declaration.supersededAt) {
            const suffix = route.path === "/" ? "" : route.path;
            dated.push(JSON.stringify(asked(`${basePathOf(declaration)}${suffix}`)));
          }
        }
      }
    }
    const pinned = (each: string) =>
      booted.rest.pinnedAddressOf({ ...JSON.parse(each), header: DASHBOARDS_API_VERSION });

    expect(literal.filter((each) => pinned(each) !== null)).toEqual([]);
    expect(dated.filter((each) => pinned(each) === null)).toEqual([]);
    expect(
      booted.rest.pinnedAddressOf({
        method: "POST",
        path: "/api/v1/analytics/reports",
        header: DASHBOARDS_API_VERSION,
      }),
    ).toBeNull();
  });

  /** @scenario "The api serves the generated document" */
  it("is the document the api answers at /api/openapi.json", async () => {
    const response = await booted.application.request("/api/openapi.json");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(generated);
  });

  /** @scenario "Every documented operation is answered by the api" */
  it("documents only operations a route of the api answers", () => {
    const served = new Set(
      booted.application.routes
        .filter(({ method, path }) => method !== "ALL" && !path.includes("*"))
        .map(({ method, path }) => `${method} ${addressOf(path)}`),
    );
    const documented = Object.entries((generated as OpenApiDocument).paths).flatMap(
      ([path, item]) =>
        METHODS.filter((method) => item[method] !== void 0).map(
          (method) => `${method.toUpperCase()} ${addressOf(path)}`,
        ),
    );

    expect(documented.filter((operation) => !served.has(operation))).toEqual([]);
  });

  /** @scenario "The generator writes only where the caller pointed it" */
  it("writes the document to the path it is given and nowhere else", async () => {
    const directory = mkdtempSync(join(tmpdir(), "openapi-document-"));
    try {
      const target = await writeOpenApiDocument(join(directory, "openapi.json"));

      expect(readdirSync(directory)).toEqual(["openapi.json"]);
      expect(JSON.parse(readFileSync(target, "utf8"))).toEqual(generated);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
