/**
 * The legacy read's OccurredAt resolver over a ready trace id index.
 * Spec: specs/clickhouse/id-index-reads.feature
 */
import {
  AuthorizedClickHouse,
  setWindowedReadMetrics,
  type WindowedReadOutcome,
} from "@langwatch/clickhouse-client";
import {
  readyIdIndexedClientDouble,
  type ScriptedStatements,
} from "@langwatch/clickhouse-client/testing";
import type { Protections } from "@langwatch/trace-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TraceCanonicalisationService } from "#features/derivation/services/trace-canonicalisation.service";

import { ownProof } from "../../../../../__tests__/support/authorization-proofs.fixture.ts";
import { TRACE_ID_INDEXES } from "../../../../../repositories/clickhouse/clickhouse.trace-id-indexes.database.ts";
import { mappedLegacyRead } from "./support/legacy-trace-mapping.support.ts";

const protections: Protections = { canSeeCosts: true };

/** ClickHouse's `min`/`max` with no GROUP BY over no rows: one row of zeroes, unless HAVING. */
function aggregateOverNoRows({ sql }: { sql: string }): unknown[] {
  return sql.includes("HAVING count() > 0") ? [] : [{ fromMs: "0", toMs: "0" }];
}

let outcomes: { table: string; outcome: WindowedReadOutcome }[];

beforeEach(() => {
  outcomes = [];
  setWindowedReadMetrics({ record: (entry) => outcomes.push(entry) });
});

describe("TraceLegacyReadClickHouseRepository's OccurredAt resolver", () => {
  describe("given trace ids neither the ready index nor the source holds", () => {
    /** @scenario "an id the index has never seen probes recent data once and stops" */
    it("counts an index miss, never a miss that found rows", async () => {
      const execute = vi.fn<ScriptedStatements["execute"]>(async (request) => {
        if (request.sql.includes("count() AS n")) {
          return { rows: [{ n: "0", fromMs: "0", toMs: "0" }] };
        }
        if (request.sql.includes("min(OccurredAt)")) return { rows: aggregateOverNoRows(request) };
        return { rows: [] };
      });
      const client = await readyIdIndexedClientDouble({
        indexes: TRACE_ID_INDEXES,
        driver: { execute },
      });
      const read = mappedLegacyRead({
        clickhouse: new AuthorizedClickHouse({ resolveClient: async () => client }),
        traceCanonicalisation: TraceCanonicalisationService.create(),
      });

      await read.findTracesWithSpans({
        authorization: ownProof({ projectId: "proj_123" }),
        projectId: "proj_123",
        traceIds: ["trace-0"],
        protections,
      });

      const summaryOutcomes = outcomes.filter((each) => each.table === "trace_summaries");
      expect(summaryOutcomes[0]?.outcome).toBe("index_miss");
      expect(outcomes.map((each) => each.outcome)).not.toContain("index_miss_found");
    });
  });
});
