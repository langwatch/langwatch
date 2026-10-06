/**
 * The OpenAPI document generated from the installed declarations, against the api that serves it.
 * @vitest-environment node
 * @see specs/api-reference/openapi-document-generation.feature
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { RestIdentity } from "@langwatch/api/hosting";
import { RestHost } from "@langwatch/api/rest";
import { composeApiApplication } from "@langwatch/process";
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

/** Describing the routes needs no credential, so every door refuses and every fact throws. */
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
  const facts = new Map<string, { middleware: { name: string }; resolve: () => never }>();
  for (const module of processModules) {
    for (const transport of module.transports ?? []) {
      if (transport.protocol !== "rest") continue;
      const declaration = transport.router() as {
        routes: readonly { middleware?: readonly { name: string }[] }[];
      };
      for (const route of declaration.routes) {
        for (const fact of route.middleware ?? []) {
          facts.set(fact.name, { middleware: fact, resolve: refuse });
        }
      }
    }
  }

  let rest: RestHost | undefined;
  const { runtime } = await bootApi({
    surface: () => {
      rest = RestHost.create({
        identities: {
          project: closed,
          organization: closed,
          api_key: closed,
          scim_token: closed,
          instance_admin: closed,
          browser: closed,
        },
        bearers: () => closed,
        audit: { record: async () => {} },
        idempotency: refuse,
        rateLimiter: { check: refuse },
        facts: [...facts.values()] as never,
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
