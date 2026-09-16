/**
 * The PUBLISHED document, read as an integrator reads it — unlike every other
 * test here, which feeds the generator a fixture. Regenerate with `pnpm
 * --filter @langwatch/platform-api task openapi-generate <absolute-path>`.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { FROZEN_DOCUMENT_PATH } from "../openapi-document.checker.ts";
import type { OpenApiDocument } from "../openapi-document.generator.ts";

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;

/** `METHOD /published/path` to the operationId the document publishes for it. */
async function publishedOperationIds(): Promise<Map<string, string>> {
  const document = JSON.parse(await readFile(FROZEN_DOCUMENT_PATH, "utf8")) as OpenApiDocument;
  const byOperation = new Map<string, string>();

  for (const [routePath, item] of Object.entries(document.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const operationId = (item[method] as { operationId?: string } | undefined)?.operationId;

      if (operationId) byOperation.set(`${method.toUpperCase()} ${routePath}`, operationId);
    }
  }

  return byOperation;
}

/**
 * The teams family, mounted by `560f409863` after the document's previous
 * regeneration, so absent from it until this one. apidiff flagged these nine
 * as present on main but missing from a branch that answered all of them.
 */
const TEAM_OPERATIONS = [
  "GET /api/v1/teams",
  "POST /api/v1/teams",
  "GET /api/v1/teams/{id}",
  "PATCH /api/v1/teams/{id}",
  "DELETE /api/v1/teams/{id}",
  "GET /api/v1/teams/{id}/members",
  "POST /api/v1/teams/{id}/members",
  "DELETE /api/v1/teams/{id}/members/{userId}",
  "GET /api/v1/teams/{id}/projects",
] as const;

/**
 * A sample of the operationIds `2ccc43d219` restored, read from
 * `origin/main`'s own document. A rename landing without a regeneration
 * fails here — the check that did not exist when the renames were made.
 */
const RESTORED_OPERATION_IDS: Readonly<Record<string, string>> = {
  "GET /api/v1/prompts": "getApiPrompts",
  "POST /api/v1/prompts": "postApiPrompts",
  "GET /api/v1/groups": "getApiGroups",
  "GET /api/v1/groups/{id}": "getApiGroupsById",
  "GET /api/v1/secrets": "getApiSecrets",
  "POST /api/v1/secrets": "postApiSecrets",
  "GET /api/v1/simulation-runs": "getApiSimulationRuns",
  "GET /api/v1/triggers": "getApiTriggers",
  "GET /api/v1/scenarios": "getApiScenarios",
  "GET /api/v1/workflows": "getApiWorkflows",
  "GET /api/v1/dashboards": "getApiDashboards",
  "POST /api/v1/analytics/timeseries": "postApiAnalyticsTimeseries",
  "GET /api/v1/agents": "listAgents",
  "GET /api/v1/api-keys": "listApiKeys",
};

/**
 * The deprecated `/api/agents` alias — still SERVED, no longer PUBLISHED: it
 * answers the successor family's operations, so documenting both declared
 * duplicate operationIds, which OpenAPI forbids and broke the generated client.
 */
const UNPUBLISHED_LEGACY_AGENT_OPERATIONS = [
  "GET /api/agents",
  "POST /api/agents",
  "GET /api/agents/{id}",
  "PATCH /api/agents/{id}",
  "DELETE /api/agents/{id}",
] as const;

/**
 * What the document carried before this regeneration. A floor, not a target: a
 * regeneration that truncates the document passes every "is X present" check
 * and still breaks every SDK, so the total is asserted too.
 */
const OPERATIONS_BEFORE_REGENERATION = 268;

describe("given the published OpenAPI document", () => {
  describe("when the teams family is read back", () => {
    it("publishes all nine team operations", async () => {
      const published = await publishedOperationIds();

      expect(TEAM_OPERATIONS.filter((operation) => published.has(operation))).toEqual([
        ...TEAM_OPERATIONS,
      ]);
    });
  });

  describe("when the restored operationIds are read back", () => {
    it("names every sampled operation the way main names it", async () => {
      const published = await publishedOperationIds();

      expect(
        Object.fromEntries(
          Object.keys(RESTORED_OPERATION_IDS).map((operation) => [
            operation,
            published.get(operation),
          ]),
        ),
      ).toEqual(RESTORED_OPERATION_IDS);
    });
  });

  describe("when every operationId is counted", () => {
    it("names each one exactly once", async () => {
      const published = await publishedOperationIds();
      const seen = new Map<string, string[]>();

      for (const [operation, operationId] of published) {
        seen.set(operationId, [...(seen.get(operationId) ?? []), operation]);
      }

      expect(
        Object.fromEntries([...seen].filter(([, addresses]) => addresses.length > 1)),
      ).toEqual({});
    });
  });

  describe("when the deprecated /api/agents alias is read back", () => {
    it("publishes none of it, because the successor family owns those operations", async () => {
      const published = await publishedOperationIds();

      expect(
        UNPUBLISHED_LEGACY_AGENT_OPERATIONS.filter((operation) => published.has(operation)),
      ).toEqual([]);
    });
  });

  describe("when the whole document is counted", () => {
    it("describes at least as many operations as the document it replaced", async () => {
      const published = await publishedOperationIds();

      expect(published.size).toBeGreaterThanOrEqual(OPERATIONS_BEFORE_REGENERATION);
    });
  });
});
