/**
 * @vitest-environment node
 * Runs the shared ClickHouse tenant guard over every statement a free-text
 * trace search issues, as the member client does before ClickHouse sees it.
 * @regression WEB-5300 (free-text trace search answered 500)
 */
import { checkTenantScope } from "@langwatch/clickhouse-client";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { TraceCanonicalisationService } from "#features/derivation/services/trace-canonicalisation.service";

import { ownProof } from "../../../../../__tests__/support/authorization-proofs.fixture.ts";
import type { TraceClickHouseClient } from "../../../../../repositories/clickhouse/clickhouse.trace-member-client.repository.ts";
import { traceQueryTranslation } from "../../../../../services/__tests__/fixtures/trace-query-services.fixtures.ts";
import { TraceLegacyReadClickHouseRepository } from "../trace-legacy-read.repository.ts";

const PROJECT_ID = "project-1";
const PROTECTIONS = { canSeeCosts: true, canSeeCapturedInput: true, canSeeCapturedOutput: true };

describe("TraceLegacyReadClickHouseRepository free-text search", () => {
  describe("given a free-text term, which ORs the captured fields with a scoped span subquery", () => {
    it("issues only statements the tenant guard admits", async () => {
      const query = vi.fn(
        async (_input: { query: string; query_params?: Record<string, unknown> }) => ({
          json: async (): Promise<unknown[]> => [],
        }),
      );
      const repository = new TraceLegacyReadClickHouseRepository({
        resolveClickHouseClient: async () => createApiFixture<TraceClickHouseClient>({ query }),
        traceCanonicalisation: TraceCanonicalisationService.create(),
      });
      const endDate = Date.now();
      const startDate = endDate - 86_400_000;
      const filterWhere = traceQueryTranslation.translateFilter({
        queryText: "hello",
        timeRange: { from: startDate, to: endDate },
      });
      expect(filterWhere).not.toBeNull();

      await repository.listAllTracesForProject(
        { projectId: PROJECT_ID, startDate, endDate, pageSize: 10, filters: {} },
        PROTECTIONS,
        {
          filterWhere: filterWhere ?? undefined,
          authorization: ownProof({ projectId: PROJECT_ID }),
        },
      );

      expect(query).toHaveBeenCalled();
      for (const [statement] of query.mock.calls) {
        expect(
          checkTenantScope({
            sql: statement.query,
            params: statement.query_params,
            tenantId: PROJECT_ID,
          }),
        ).toBeNull();
      }
    });
  });
});
