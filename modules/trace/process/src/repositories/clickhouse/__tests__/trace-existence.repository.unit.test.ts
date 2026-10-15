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
  const repository = ClickHouseTraceExistenceRepository.create({
    resolveClient: MemberTraceClickHouseClientRepository.resolverFor(client),
  });
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
