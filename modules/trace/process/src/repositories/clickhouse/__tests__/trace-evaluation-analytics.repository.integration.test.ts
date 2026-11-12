/**
 * @vitest-environment node
 * @integration
 * The live read of trace_evaluation_analytics over unmerged parts: a -1 group and a doubled
 * row come back with their sign sums, and the fold writes nothing for either (trace ADR-003).
 * @see specs/trace/trace-evaluation-analytics.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ownProof } from "../../../__tests__/support/authorization-proofs.fixture.ts";
import {
  LIVE_ROW_LOOKBACK_MS,
  type TraceEvaluationAnalyticsRow,
  type TraceEvaluationAnalyticsWrite,
  traceEvaluationRowWrites,
} from "../../../rules/trace-evaluation-analytics.rules.ts";
import { TraceEvaluationAnalyticsClickHouseRepository } from "../trace-evaluation-analytics.repository.ts";
import {
  authorizedClickHouseFor,
  traceResolverFor,
} from "./support/authorized-clickhouse.support.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "./support/clickhouse-endpoint.support.ts";

const clickHouseConfigured = testClickHouseConfigured();

const TABLE = "trace_evaluation_analytics";
const tag = nanoid();
const tenantId = `${tag}-project`;
const traceId = `${tag}-trace`;
const baseMs = Date.now();

const current: TraceEvaluationAnalyticsRow = {
  tenantId,
  traceId,
  evaluationId: `${tag}-evaluation`,
  occurredAtMs: baseMs,
  traceOccurredAtMs: baseMs - 1_000,
  evaluatorName: "Faithfulness",
  status: "processed",
  isGuardrail: false,
  passed: true,
  label: null,
  origin: null,
  traceOrigin: "application",
  customerId: "customer-1",
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
const stale: TraceEvaluationAnalyticsRow = { ...current, topicId: "topic-old" };

const write = ({
  row,
  sign,
  revision,
}: {
  row: TraceEvaluationAnalyticsRow;
  sign: 1 | -1;
  revision: number;
}): TraceEvaluationAnalyticsWrite => ({
  row,
  sign,
  revision,
  updatedAtMs: baseMs,
  retentionDays: 30,
});

let ch: ClickHouseClient;
let repo: TraceEvaluationAnalyticsClickHouseRepository;

beforeAll(async () => {
  if (!clickHouseConfigured) return;
  ch = await startMigratedTraceClickHouse();
  repo = TraceEvaluationAnalyticsClickHouseRepository.create({
    resolveClient: traceResolverFor(ch),
    clickhouse: authorizedClickHouseFor(ch),
  });
  // Unmerged parts are the case under test: a merge would collapse the pairs before the read.
  await ch.exec({ query: `SYSTEM STOP MERGES ${TABLE}` });
}, 60_000);

afterAll(async () => {
  if (!ch) return;
  await ch.exec({ query: `SYSTEM START MERGES ${TABLE}` });
  await ch.exec({
    query: `ALTER TABLE ${TABLE} DELETE WHERE TenantId = {tenantId:String}`,
    query_params: { tenantId },
  });
});

describe.skipIf(!clickHouseConfigured)("trace_evaluation_analytics live read", () => {
  describe("given an orphan -1 group of old content and the current content stored twice at +1", () => {
    /** @scenario "A live group whose signs sum to -1 writes no repair +1" */
    /** @scenario "A live group whose signs sum to 2 writes no extra -1" */
    it("reads both groups with their sign sums and writes nothing for either", async () => {
      await repo.insertRows({ writes: [write({ row: stale, sign: -1, revision: 1 })] });
      await repo.insertRows({ writes: [write({ row: current, sign: 1, revision: 2 })] });
      await repo.insertRows({ writes: [write({ row: current, sign: 1, revision: 2 })] });
      const read = () =>
        repo.findLiveRows({
          authorization: ownProof({ projectId: tenantId }),
          traceIds: [traceId],
          occurredAtFromMs: baseMs - LIVE_ROW_LOOKBACK_MS,
        });

      const live = await read();

      expect(
        live.map(({ row, signSum }) => ({ topicId: row.topicId, signSum })).toSorted(byTopic),
      ).toEqual([
        { topicId: "topic-billing", signSum: 2 },
        { topicId: "topic-old", signSum: -1 },
      ]);

      expect(
        traceEvaluationRowWrites({
          wanted: [current],
          live,
          updatedAtMs: baseMs + 1_000,
          retentionDays: 30,
        }),
      ).toEqual([]);
    });
  });
});

function byTopic(a: { topicId: string | null }, b: { topicId: string | null }): number {
  return (a.topicId ?? "").localeCompare(b.topicId ?? "");
}
