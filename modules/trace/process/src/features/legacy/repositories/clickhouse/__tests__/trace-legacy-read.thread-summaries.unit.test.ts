/**
 * The thread read a content-free caller makes: the traces' summaries, with no span scan behind
 * them.
 * Spec: modules/trace/specs/trace-read-service.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { TraceCanonicalisationService } from "#features/derivation/services/trace-canonicalisation.service";

import { ownProof } from "../../../../../__tests__/support/authorization-proofs.fixture.ts";
import { traceSummaryRow } from "../../../../../repositories/clickhouse/__tests__/support/trace-summary-row.support.ts";
import type { TraceClickHouseClient } from "../../../../../repositories/clickhouse/clickhouse.trace-member-client.repository.ts";
import { mappedLegacyRead } from "./support/legacy-trace-mapping.support.ts";

const PROJECT_ID = "project-1";
const PROTECTIONS = { canSeeCosts: true, canSeeCapturedInput: true, canSeeCapturedOutput: true };

type Statement = { query: string };

function harness() {
  const query = vi.fn(async (statement: Statement) => ({
    json: async (): Promise<unknown[]> => {
      if (statement.query.includes("SELECT DISTINCT TraceId")) return [{ TraceId: "trace-1" }];
      if (statement.query.includes("ts_SpanCount")) {
        return [traceSummaryRow({ ts_OccurredAt: String(Date.now() - 60_000) })];
      }
      return [];
    },
  }));
  const read = mappedLegacyRead({
    resolveClickHouseClient: async () => createApiFixture<TraceClickHouseClient>({ query }),
    traceCanonicalisation: TraceCanonicalisationService.create(),
  });
  const spanReads = () =>
    query.mock.calls.filter(([statement]) => statement.query.includes("stored_spans"));
  return { read, spanReads };
}

describe("TraceLegacyReadClickHouseRepository thread reads", () => {
  describe("when a thread's traces are read without their spans", () => {
    /** @scenario "A thread read without spans reads only the traces' summaries" */
    it("answers the summary with no spans and reads no span", async () => {
      const { read, spanReads } = harness();

      const traces = await read.findTracesWithSpansByThreadIds({
        authorization: ownProof({ projectId: PROJECT_ID }),
        projectId: PROJECT_ID,
        threadIds: ["thread-1"],
        protections: PROTECTIONS,
        opts: { withSpans: false },
      });

      expect(traces).toHaveLength(1);
      expect(traces[0]?.spans).toEqual([]);
      expect(spanReads()).toHaveLength(0);
    });
  });

  describe("when a thread's traces are read with their spans", () => {
    it("reads the spans behind the summaries", async () => {
      const { read, spanReads } = harness();

      await read.findTracesWithSpansByThreadIds({
        authorization: ownProof({ projectId: PROJECT_ID }),
        projectId: PROJECT_ID,
        threadIds: ["thread-1"],
        protections: PROTECTIONS,
      });

      expect(spanReads().length).toBeGreaterThan(0);
    });
  });
});
