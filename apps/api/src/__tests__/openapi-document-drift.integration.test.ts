/**
 * The committed OpenAPI document against the routes the composed API answers.
 * @vitest-environment node
 * @see specs/api-reference/openapi-document-drift.feature
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { RestIdentity } from "@langwatch/api/hosting";
import { RestHost } from "@langwatch/api/rest";
import { processModules } from "@langwatch/installed-server-modules";
import { composeApiApplication } from "@langwatch/process";
import { describe, expect, it } from "vitest";

import { bootApi } from "./api-installation.fixture.ts";

const REPOSITORY_ROOT = join(import.meta.dirname, "../../../..");
const DOCUMENT_PATH = "specs/api-reference/openapi-document.json";
const BASELINE_PATH = "specs/api-reference/openapi-unserved-baseline.json";
const METHODS = ["get", "post", "put", "patch", "delete"] as const;
/** The dated and `latest` twins of a canonical address are one operation, not three. */
const VERSION_SELECTOR = /\/(latest|preview|20\d{2}-\d{2}-\d{2})(\/|$)/;

type Operation = `${Uppercase<(typeof METHODS)[number]>} ${string}`;
type BaselineEntry = { operation: Operation; reason: string };
type OpenApiDocument = { paths?: Record<string, Partial<Record<string, unknown>>> };
type DriftReport = {
  removed: Operation[];
  baselined: Operation[];
  staleBaseline: Operation[];
  added: Operation[];
};

/** `{id}` and `:id` (with or without a hono pattern) are one parameter slot. */
function addressOf(path: string): string {
  const normalized = path.replace(/\{[^}]+\}/g, "{}").replace(/:[A-Za-z_]\w*(\{[^}]*\})?/g, "{}");
  return normalized.length > 1 ? normalized.replace(/\/$/, "") : normalized;
}

function documentedOperations(document: OpenApiDocument): Operation[] {
  return Object.entries(document.paths ?? {}).flatMap(([path, item]) =>
    METHODS.filter((method) => item[method] !== void 0).map(
      (method) => `${method.toUpperCase()} ${addressOf(path)}` as Operation,
    ),
  );
}

function servedOperations(routes: readonly { method: string; path: string }[]): Set<Operation> {
  return new Set(
    routes
      .filter(({ method, path }) => method !== "ALL" && !path.includes("*"))
      .map(({ method, path }) => `${method} ${addressOf(path)}` as Operation),
  );
}

/** Only a documented operation no route answers fails; an undocumented one is reported. */
function compareDocument({
  documented,
  served,
  baseline,
}: {
  documented: readonly Operation[];
  served: ReadonlySet<Operation>;
  baseline: readonly BaselineEntry[];
}): DriftReport {
  const accepted = new Set(baseline.map(({ operation }) => operation));
  const unserved = [...new Set(documented)].filter((operation) => !served.has(operation));
  const documentedSet = new Set(documented);

  return {
    removed: unserved.filter((operation) => !accepted.has(operation)).toSorted(),
    baselined: unserved.filter((operation) => accepted.has(operation)).toSorted(),
    staleBaseline: [...accepted]
      .filter((operation) => served.has(operation) || !documentedSet.has(operation))
      .toSorted(),
    added: [...served]
      .filter((operation) => operation.includes(" /api/v1/") && !VERSION_SELECTOR.test(operation))
      .filter((operation) => !documentedSet.has(operation))
      .toSorted(),
  };
}

function renderReport(report: DriftReport): string {
  const lines = [
    `removed: ${report.removed.length}, baselined: ${report.baselined.length}, ` +
      `stale baseline: ${report.staleBaseline.length}, served and undocumented: ${report.added.length}`,
  ];
  if (report.removed.length > 0) {
    lines.push(
      `${DOCUMENT_PATH} lists operations no route of the API answers:`,
      ...report.removed.map((operation) => `  - ${operation}`),
      "Restore the route, or remove the operation from the document and regenerate the",
      "clients from it (make sync-all-openapi prints the commands).",
    );
  }
  if (report.staleBaseline.length > 0) {
    lines.push(
      `${BASELINE_PATH} names operations that are now served or no longer documented:`,
      ...report.staleBaseline.map((operation) => `  - ${operation}`),
      "Delete those entries.",
    );
  }
  return lines.join("\n");
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(join(REPOSITORY_ROOT, path), "utf8")) as T;
}

/** Describing the routes needs no credential, so every door refuses and every fact throws. */
async function composedRoutes() {
  const refuse = () => {
    throw new Error("the drift check describes routes and answers no request");
  };
  const closed: RestIdentity = {
    authenticate: refuse,
    identify: refuse,
    identifyOptional: refuse,
    authorize: refuse,
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
  try {
    return composeApiApplication({ rest }).routes;
  } finally {
    await runtime.stop();
  }
}

describe("the OpenAPI document drift check", () => {
  const served = servedOperations([
    { method: "GET", path: "/api/v1/widgets" },
    { method: "GET", path: "/api/v1/widgets/:widgetId" },
    { method: "POST", path: "/api/v1/gadgets" },
    { method: "ALL", path: "/api/v1/sprockets" },
  ]);

  /** @scenario "A documented operation with no declaration behind it is reported as removed" */
  it("reports a documented operation no route answers as removed", () => {
    const report = compareDocument({
      documented: ["GET /api/v1/widgets/{}", "DELETE /api/v1/widgets/{}", "GET /api/v1/sprockets"],
      served,
      baseline: [],
    });

    expect(report.removed).toEqual(["DELETE /api/v1/widgets/{}", "GET /api/v1/sprockets"]);
  });

  /** @scenario "A removal already at the baseline is inherited, not caused" */
  it("reports a baselined removal as baselined, and a baseline entry now served as stale", () => {
    const report = compareDocument({
      documented: ["DELETE /api/v1/widgets/{}", "GET /api/v1/widgets"],
      served,
      baseline: [
        { operation: "DELETE /api/v1/widgets/{}", reason: "moved" },
        { operation: "GET /api/v1/widgets", reason: "restored since" },
      ],
    });

    expect(report).toMatchObject({
      removed: [],
      baselined: ["DELETE /api/v1/widgets/{}"],
      staleBaseline: ["GET /api/v1/widgets"],
    });
  });

  /** @scenario "A declared operation the document omits is reported and does not fail" */
  it("reports a served operation the document omits as added, never as removed", () => {
    const report = compareDocument({ documented: ["GET /api/v1/widgets"], served, baseline: [] });

    expect(report).toMatchObject({
      removed: [],
      added: ["GET /api/v1/widgets/{}", "POST /api/v1/gadgets"],
    });
  });

  /** @scenario "The rendered report names every operation the run would fail on" */
  it("names every removed operation in the rendered report", () => {
    const rendered = renderReport({
      removed: ["DELETE /api/v1/widgets/{}"],
      baselined: [],
      staleBaseline: [],
      added: [],
    });

    expect(rendered).toContain("DELETE /api/v1/widgets/{}");
  });

  /** @scenario "Every operation the committed document lists is answered by the composed API" */
  it("finds a route for every operation the committed document lists", async () => {
    const report = compareDocument({
      documented: documentedOperations(readJson<OpenApiDocument>(DOCUMENT_PATH)),
      served: servedOperations(await composedRoutes()),
      baseline: readJson<BaselineEntry[]>(BASELINE_PATH),
    });
    const rendered = renderReport(report);

    expect(report.removed, rendered).toEqual([]);
    expect(report.staleBaseline, rendered).toEqual([]);
  }, 180_000);
});
