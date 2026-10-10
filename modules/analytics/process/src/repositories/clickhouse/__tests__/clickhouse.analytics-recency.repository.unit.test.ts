import type { QueryRequest } from "@langwatch/clickhouse-client";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { ClickHouseAnalyticsRecencyRepository } from "../clickhouse.analytics-recency.repository.ts";

const SINCE = Temporal.Instant.from("2026-09-24T12:00:00Z");

function createRepository(rows: unknown[]) {
  const queries: QueryRequest[] = [];
  const clickhouse = clickHouseQueryClientDouble({
    async query(request: QueryRequest): Promise<{ rows: unknown[] }> {
      queries.push(request);
      return { rows };
    },
  });
  return { queries, repository: ClickHouseAnalyticsRecencyRepository.create(clickhouse) };
}

describe("ClickHouseAnalyticsRecencyRepository", () => {
  describe("given a trace-sourced recency read", () => {
    it("reads trace_analytics scoped to the tenant, from the bound onwards", async () => {
      const { queries, repository } = createRepository([{ lastMs: null }]);

      await repository.findLastOccurredAt({
        projectId: "project-1",
        source: "trace",
        since: SINCE,
      });

      expect(queries).toHaveLength(1);
      expect(queries[0]?.tenantId).toBe("project-1");
      expect(queries[0]?.sql).toContain("FROM trace_analytics");
      expect(queries[0]?.sql).toContain("TraceId");
      expect(queries[0]?.params).toEqual({
        tenantId: "project-1",
        startMs: SINCE.epochMilliseconds,
      });
    });
  });

  describe("given an evaluation-sourced recency read", () => {
    it("reads evaluation_analytics keyed by EvaluationId", async () => {
      const { queries, repository } = createRepository([{ lastMs: null }]);

      await repository.findLastOccurredAt({
        projectId: "project-1",
        source: "evaluation",
        since: SINCE,
      });

      expect(queries[0]?.sql).toContain("FROM evaluation_analytics");
      expect(queries[0]?.sql).toContain("EvaluationId");
      expect(queries[0]?.sql).not.toContain("trace_analytics");
    });
  });

  describe("when the newest row is returned as a string", () => {
    it("answers that instant", async () => {
      const { repository } = createRepository([{ lastMs: "1790000000000" }]);

      const found = await repository.findLastOccurredAt({
        projectId: "project-1",
        source: "trace",
        since: SINCE,
      });

      expect(found.map((instant) => instant.epochMilliseconds)).toEqual([1790000000000]);
    });
  });

  describe("when the project has no row in the window", () => {
    it.each([[[]], [[{ lastMs: null }]], [[{ lastMs: 0 }]], [[{ lastMs: "0" }]]])(
      "answers empty for %j",
      async (rows) => {
        const { repository } = createRepository(rows);

        const found = await repository.findLastOccurredAt({
          projectId: "project-1",
          source: "trace",
          since: SINCE,
        });

        expect(found).toEqual([]);
      },
    );
  });
});
