/**
 * Which candidate trace ids a project holds, once trace's id index is ready.
 * Spec: specs/clickhouse/id-index-reads.feature
 */
import {
  readyIdIndexedClientDouble,
  type ScriptedStatements,
} from "@langwatch/clickhouse-client/testing";
import { describe, expect, it, vi } from "vitest";

import { TRACE_ID_INDEXES } from "../clickhouse.trace-id-indexes.database.ts";
import { MemberTraceClickHouseClientRepository } from "../clickhouse.trace-member-client.repository.ts";
import { ClickHouseTraceExistenceRepository } from "../trace-existence.repository.ts";

/** A ready index answering `indexed` rows for every lookup; the source holds `t1` in project-1. */
async function existenceOver({ indexed }: { indexed: number }) {
  const sourceReads: string[] = [];
  const execute = vi.fn<ScriptedStatements["execute"]>(async (request) => {
    if (request.sql.includes("count() AS n")) {
      return { rows: [{ n: String(indexed), fromMs: "1000", toMs: "2000" }] };
    }
    sourceReads.push(request.sql);
    return { rows: [{ TraceId: "t1", TenantId: "project-1" }] };
  });
  const client = await readyIdIndexedClientDouble({
    indexes: TRACE_ID_INDEXES,
    driver: { execute },
  });
  const repository = ClickHouseTraceExistenceRepository.create({
    resolveClient: MemberTraceClickHouseClientRepository.resolverFor(client),
    clickhouse: client,
  });
  execute.mockClear();
  return { repository, sourceReads, execute };
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

describe("ClickHouseTraceExistenceRepository.findProjectsHoldingTrace", () => {
  const projectIds = Array.from({ length: 100 }, (_, index) => `project-${index}`);

  describe("given a trace id the ready index has never seen in any project", () => {
    it("reads each table's index once over the whole project set and no source", async () => {
      const { repository, sourceReads, execute } = await existenceOver({ indexed: 0 });

      const holding = await repository.findProjectsHoldingTrace({ projectIds, traceId: "t9" });

      expect(holding).toEqual([]);
      expect(execute).toHaveBeenCalledTimes(2);
      expect(sourceReads).toEqual([]);
    });
  });

  describe("given a trace id the index holds", () => {
    it("confirms it with one source read per table, bound to the declared set", async () => {
      const { repository, sourceReads, execute } = await existenceOver({ indexed: 1 });

      const holding = await repository.findProjectsHoldingTrace({ projectIds, traceId: "t1" });

      expect(holding).toEqual(["project-1"]);
      expect(execute).toHaveBeenCalledTimes(4);
      expect(sourceReads).toHaveLength(2);
      expect(
        sourceReads.every((sql) => sql.includes("TenantId IN ({tenantIds:Array(String)})")),
      ).toBe(true);
    });
  });
});
