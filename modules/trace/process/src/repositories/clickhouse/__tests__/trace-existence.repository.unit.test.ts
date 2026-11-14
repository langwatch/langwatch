/**
 * Which candidate trace ids a project holds, once trace's id index is ready.
 * Spec: specs/clickhouse/id-index-reads.feature
 */
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import {
  readyIdIndexedClientDouble,
  type ScriptedStatements,
} from "@langwatch/clickhouse-client/testing";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it, vi } from "vitest";

import { TRACE_ID_INDEXES } from "../clickhouse.trace-id-indexes.database.ts";
import { ClickHouseTraceExistenceRepository } from "../trace-existence.repository.ts";

/** A ready index answering `indexed` rows for every lookup; the source holds `t1`. */
async function existenceOver({ indexed }: { indexed: number }) {
  const sourceReads: string[] = [];
  const execute = vi.fn<ScriptedStatements["execute"]>(async (request) => {
    if (request.sql.includes("count() AS n")) {
      return { rows: [{ n: String(indexed), fromMs: "1000", toMs: "2000" }] };
    }
    sourceReads.push(request.sql);
    return { rows: [{ TraceId: "t1" }] };
  });
  const client = await readyIdIndexedClientDouble({
    indexes: TRACE_ID_INDEXES,
    driver: { execute },
  });
  const repository = ClickHouseTraceExistenceRepository.create({ clickhouse: client });
  return { repository, sourceReads };
}

describe("ClickHouseTraceExistenceRepository.findExistingTraceIds", () => {
  describe("given trace ids the ready index has never seen", () => {
    /** @scenario "an id the index has never seen reads nothing when the read asks for nothing" */
    it("answers none of them without reading the source", async () => {
      const { repository, sourceReads } = await existenceOver({ indexed: 0 });

      const found = await repository.findExistingTraceIds({
        projectId: "project-1",
        traceIds: ["t1", "t2"],
      });

      expect(found).toEqual([]);
      expect(sourceReads).toEqual([]);
    });
  });

  describe("given trace ids the ready index holds", () => {
    it("confirms them on the source, bounded by the index's range", async () => {
      const { repository, sourceReads } = await existenceOver({ indexed: 1 });

      const found = await repository.findExistingTraceIds({
        projectId: "project-1",
        traceIds: ["t1", "t2"],
      });

      expect(found).toEqual(["t1"]);
      expect(sourceReads).toHaveLength(1);
      expect(sourceReads[0]).toContain("OccurredAt >= ");
    });
  });
});

type ReadRequest = Parameters<ClickHouseQueryClient["read"]>[0];

describe("ClickHouseTraceExistenceRepository built reads", () => {
  describe("when trace costs and usage counts are read", () => {
    it("reads each project on the reader identity, scoped to that project alone", async () => {
      const statements: ReadRequest["statement"][] = [];
      const repository = ClickHouseTraceExistenceRepository.create({
        clickhouse: clickHouseQueryClientDouble({
          async read({ statement }: ReadRequest) {
            statements.push(statement);
            return { rows: [] };
          },
        }),
      });

      await repository.findTraceCosts({
        projectId: "project-1",
        traceIds: ["t1"],
        occurredAt: { from: 1_000, to: 2_000 },
      });
      await repository.countUsage({ projectIds: ["project-1", "project-2"], since: 1_000 });

      expect(statements).toHaveLength(5);
      const tenantIds = statements.map((statement) => {
        if (statement.kind !== "tenant") throw new Error(`a ${statement.kind} statement`);
        expect(statement).toMatchObject({ identity: "reader", tenantIds: undefined });
        expect(statement.sql).toContain("WHERE TenantId = {tenantId:String}");
        expect(statement.settings).toMatchObject({ SQL_langwatch_tenant_ids: statement.tenantId });
        return statement.tenantId;
      });
      expect(tenantIds).toEqual(["project-1", "project-1", "project-1", "project-2", "project-2"]);
      // The cost read elects each trace's latest version inside the caller's window.
      expect(statements[0]?.sql).toMatch(/\(TenantId, TraceId, UpdatedAt\) IN \(SELECT/);
      expect(statements[0]?.sql).toContain("OccurredAt <= fromUnixTimestamp64Milli");
    });
  });
});
