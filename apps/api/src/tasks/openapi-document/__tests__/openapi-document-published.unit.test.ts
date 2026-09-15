/**
 * The PUBLISHED document — the checked-in artifact `/api/openapi.json` serves —
 * read as an integrator reads it.
 *
 * Every other test in this directory feeds the generator a fixture and asserts
 * what comes out. None of them opens the artifact, which is how the document
 * stayed two days stale while its own checks reported green: the declarations
 * were renamed and the routes were mounted, the source literals agreed with
 * themselves, and the bytes on the wire still carried the old names and no
 * teams family at all. An SDK is generated from these bytes, so these bytes are
 * what has to be asserted.
 *
 * Regenerate with:
 *   pnpm --filter @langwatch/platform-api task openapi-generate \
 *     "$PWD/apps/api/src/features/discovery/openapi-document.json"
 *
 * The path argument is required and is resolved against apps/api, so pass an
 * absolute one. Never hand-edit the artifact: the next regeneration reverts it.
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
 * regeneration and therefore absent from it until this one. Nine operations:
 * apidiff reported all nine as present on main and missing on the branch while
 * the branch was answering every one of them.
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
 * A sample of the operationIds `2ccc43d219` restored, spread across the
 * families it touched. Each expectation is the name main publishes for that
 * same operation, read from `origin/main`'s own document — so a rename that
 * lands without a regeneration fails here, which is the check that did not
 * exist when the renames were made.
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
 * The deprecated `/api/agents` alias. It is still SERVED — the agent module's
 * own `agent-rest-family.integration.test.ts` drives every one of these through
 * the mounted Hono app — but it is no longer PUBLISHED: it answers the
 * successor family's own operations, so documenting it a second time declared
 * five operationIds twice, which OpenAPI forbids and which broke the generated
 * TypeScript client outright (duplicate identifiers). Restoring main's names on
 * the canonical `/api/v1/agents` operations is what made the collision
 * unavoidable; unpublishing the alias is how it is resolved.
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
