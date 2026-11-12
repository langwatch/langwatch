/**
 * The fold's diff against live rows reads a group's sign sum only as live or not: a lagging
 * replica skews the sum, so no write is ever sized by it (trace ADR-003).
 * @see specs/trace/trace-evaluation-analytics.feature
 */
import { describe, expect, it } from "vitest";

import {
  type LiveTraceEvaluationAnalyticsRow,
  type TraceEvaluationAnalyticsRow,
  traceEvaluationRowWrites,
} from "../trace-evaluation-analytics.rules.ts";

const WRITTEN_AT_MS = 1_760_000_000_000;
const NOW_MS = WRITTEN_AT_MS + 60_000;

const current: TraceEvaluationAnalyticsRow = {
  tenantId: "tenant-row-writes",
  traceId: "trace-row-writes",
  evaluationId: "evaluation-1",
  occurredAtMs: WRITTEN_AT_MS - 1_000,
  traceOccurredAtMs: WRITTEN_AT_MS - 2_000,
  evaluatorName: "Faithfulness",
  status: "processed",
  isGuardrail: false,
  passed: true,
  label: null,
  origin: null,
  traceOrigin: "application",
  customerId: null,
  topicId: "topic-billing",
  labels: [],
  metadataTopic: "",
  metadataDocumentType: "",
  metadataLanguage: "",
  metadataTeam: "",
  metadataFlow: "",
  metadataSegment: "",
  metadataPromptVersion: "",
};

function liveGroup({
  row,
  revision,
  signSum,
}: {
  row: TraceEvaluationAnalyticsRow;
  revision: number;
  signSum: number;
}): LiveTraceEvaluationAnalyticsRow {
  return { row, revision, signSum, updatedAtMs: WRITTEN_AT_MS, retentionDays: 30 };
}

function writesFor({
  wanted,
  live,
}: {
  wanted: TraceEvaluationAnalyticsRow;
  live: LiveTraceEvaluationAnalyticsRow[];
}) {
  return traceEvaluationRowWrites({
    wanted: [wanted],
    live,
    updatedAtMs: NOW_MS,
    retentionDays: 30,
  });
}

describe("traceEvaluationRowWrites", () => {
  describe("given the current row live and old content reading as a group summing to -1", () => {
    /** @scenario "A live group whose signs sum to -1 writes no repair +1" */
    it("writes nothing, leaving the -1 to cancel its lagging +1", () => {
      const live = [
        liveGroup({ row: { ...current, topicId: "topic-old" }, revision: 1, signSum: -1 }),
        liveGroup({ row: current, revision: 2, signSum: 1 }),
      ];

      expect(writesFor({ wanted: current, live })).toEqual([]);
    });
  });

  describe("given the current row reading as one group summing to 2", () => {
    const live = [liveGroup({ row: current, revision: 1, signSum: 2 })];

    /** @scenario "A live group whose signs sum to 2 writes no extra -1" */
    it("writes nothing while the row is unchanged", () => {
      expect(writesFor({ wanted: current, live })).toEqual([]);
    });

    /** @scenario "A live group whose signs sum to 2 writes no extra -1" */
    it("retracts it once and writes the new row at the next revision when it changes", () => {
      const changed = { ...current, topicId: "topic-refunds" };

      expect(writesFor({ wanted: changed, live })).toEqual([
        { row: current, sign: -1, revision: 1, updatedAtMs: WRITTEN_AT_MS, retentionDays: 30 },
        { row: changed, sign: 1, revision: 2, updatedAtMs: NOW_MS, retentionDays: 30 },
      ]);
    });
  });
});
