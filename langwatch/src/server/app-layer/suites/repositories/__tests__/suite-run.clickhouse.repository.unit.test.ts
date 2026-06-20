import { describe, expect, it, vi } from "vitest";
import { SuiteRunClickHouseRepository } from "../suite-run.clickhouse.repository";

const repoCapturingQuery = () => {
  const query = vi
    .fn()
    .mockResolvedValue({ json: async () => [] as unknown[] });
  const resolveClient = (async () => ({
    query,
  })) as unknown as ConstructorParameters<
    typeof SuiteRunClickHouseRepository
  >[0];
  const repo = new SuiteRunClickHouseRepository(resolveClient);
  return { repo, query };
};

const capturedQuery = (query: ReturnType<typeof vi.fn>) =>
  query.mock.calls[0]![0] as {
    query: string;
    query_params: Record<string, unknown>;
  };

describe("SuiteRunClickHouseRepository.getBatchHistory", () => {
  describe("given the ScenarioSet has multiple BatchRunIds each with multiple unmerged versions", () => {
    it("emits an IN-tuple dedup on (TenantId, ScenarioSetId, BatchRunId, UpdatedAt) so the LIMIT page can't fill with duplicate BatchRunIds", async () => {
      // Regression test for the duplicate-BatchRunId bug. Prior to the dedup
      // fix, the LIMIT 50 page could fill with multiple unmerged versions of
      // the same BatchRunId because ReplacingMergeTree dedup hadn't merged
      // yet. The IN-tuple subquery collapses to one row per BatchRunId.
      const { repo, query } = repoCapturingQuery();

      await repo.getBatchHistory({
        projectId: "project_test",
        scenarioSetId: "set-1",
      });

      const { query: sql } = capturedQuery(query);
      // The IN-tuple has both the outer membership check and the inner
      // GROUP BY + max(UpdatedAt); assert the shape, not the formatting.
      expect(sql).toMatch(
        /\(TenantId, ScenarioSetId, BatchRunId, UpdatedAt\)\s+IN\s+\(\s*SELECT TenantId, ScenarioSetId, BatchRunId, max\(UpdatedAt\)/,
      );
      expect(sql).toContain("GROUP BY TenantId, ScenarioSetId, BatchRunId");
    });

    it("clamps caller-supplied limit to the hard ceiling (100)", async () => {
      const { repo, query } = repoCapturingQuery();
      await repo.getBatchHistory({
        projectId: "project_test",
        scenarioSetId: "set-1",
        limit: 99999,
      });
      const { query_params } = capturedQuery(query);
      expect(query_params.limit).toBe(100);
    });
  });

  describe("given the caller does not pass a limit", () => {
    it("defaults to 50 rows per page", async () => {
      const { repo, query } = repoCapturingQuery();
      await repo.getBatchHistory({
        projectId: "project_test",
        scenarioSetId: "set-1",
      });
      const { query_params } = capturedQuery(query);
      expect(query_params.limit).toBe(50);
    });
  });
});
