import type { ReaderReadStatement } from "@langwatch/clickhouse-client/builder";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { ClickHouseAnalyticsRecencyRepository } from "../clickhouse.analytics-recency.repository.ts";

const SINCE = Temporal.Instant.from("2026-09-24T12:00:00Z");

function createRepository(rows: unknown[]) {
  const statements: ReaderReadStatement[] = [];
  const clickhouse = {
    read: async ({ statement }: { statement: ReaderReadStatement }) => {
      statements.push(statement);
      return { rows };
    },
  } as never;
  return { statements, repository: ClickHouseAnalyticsRecencyRepository.create(clickhouse) };
}

/** The values a statement binds, without the tenant the scope binds itself. */
const boundValues = (statement: ReaderReadStatement | undefined) =>
  Object.entries(statement?.params ?? {})
    .filter(([name]) => name !== "tenantId")
    .map(([, value]) => value);

describe("ClickHouseAnalyticsRecencyRepository", () => {
  describe("given a trace-sourced recency read", () => {
    it("reads trace_analytics as the reader for the one tenant, from the bound onwards", async () => {
      const { statements, repository } = createRepository([{ lastMs: null }]);

      await repository.findLastOccurredAt({
        projectId: "project-1",
        source: "trace",
        since: SINCE,
      });

      expect(statements).toHaveLength(1);
      expect(statements[0]).toMatchObject({
        identity: "reader",
        kind: "tenant",
        tenantId: "project-1",
      });
      expect(statements[0]?.settings).toMatchObject({ SQL_langwatch_tenant_ids: "project-1" });
      expect(statements[0]?.sql).toContain("FROM trace_analytics");
      expect(statements[0]?.sql).toContain("GROUP BY TenantId, TraceId");
      expect(boundValues(statements[0])).toEqual([SINCE.epochMilliseconds]);
    });
  });

  describe("given a trace-sourced recency read that leaves origins out", () => {
    it("leaves those origins out of the newest versions, bound as a parameter", async () => {
      const { statements, repository } = createRepository([{ lastMs: null }]);

      await repository.findLastOccurredAt({
        projectId: "project-1",
        source: "trace",
        since: SINCE,
        excludeOrigins: ["langy"],
      });

      const sql = statements[0]?.sql ?? "";
      const election = sql.slice(sql.indexOf("IN (SELECT"));
      expect(sql).toMatch(/NOT \(Origin IN \(\{v\d+:Array\(String\)\}\)\)/);
      expect(election).not.toContain("Origin");
      expect(boundValues(statements[0])).toEqual([SINCE.epochMilliseconds, ["langy"]]);
    });

    it("leaves no origin out of an evaluation read", async () => {
      const { statements, repository } = createRepository([{ lastMs: null }]);

      await repository.findLastOccurredAt({
        projectId: "project-1",
        source: "evaluation",
        since: SINCE,
        excludeOrigins: ["langy"],
      });

      expect(statements[0]?.sql).not.toContain("Origin");
      expect(boundValues(statements[0])).toEqual([SINCE.epochMilliseconds]);
    });
  });

  describe("given an evaluation-sourced recency read", () => {
    it("reads evaluation_analytics keyed by EvaluationId, as the reader for the one tenant", async () => {
      const { statements, repository } = createRepository([{ lastMs: null }]);

      await repository.findLastOccurredAt({
        projectId: "project-1",
        source: "evaluation",
        since: SINCE,
      });

      expect(statements[0]).toMatchObject({
        identity: "reader",
        kind: "tenant",
        tenantId: "project-1",
      });
      expect(statements[0]?.settings).toMatchObject({ SQL_langwatch_tenant_ids: "project-1" });
      expect(statements[0]?.sql).toContain("FROM evaluation_analytics");
      expect(statements[0]?.sql).toContain("GROUP BY TenantId, EvaluationId");
      expect(statements[0]?.sql).not.toContain("trace_analytics");
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
