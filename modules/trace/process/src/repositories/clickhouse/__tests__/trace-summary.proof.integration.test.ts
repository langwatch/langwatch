/**
 * ADR-175: the trace summary and a trace's and a page's evaluations read through the proof, on
 * real ClickHouse behind the production tenant guard. Several tenants share one trace id; the
 * fence keeps an outsider's out. Spec: specs/governance/aggregate-project.feature, section C.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { aggregateProof, ownProof } from "@langwatch/authorization/testing";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ClickHouseTraceEvaluationRunsRepository } from "../trace-evaluation-runs.repository.ts";
import { TraceSummaryClickHouseRepository } from "../trace-summary.repository.ts";
import { authorizedReadsOver } from "./support/authorized-reads.support.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "./support/clickhouse-endpoint.support.ts";

const clickHouseConfigured = testClickHouseConfigured();

const run = nanoid();
const AGGREGATE = `summary-proof-aggregate-${run}`;
const MEMBER_A = `summary-proof-member-a-${run}`;
const MEMBER_B = `summary-proof-member-b-${run}`;
const OUTSIDER = `summary-proof-outsider-${run}`;
const PLAIN = `summary-proof-plain-${run}`;
const TENANTS = [AGGREGATE, MEMBER_A, MEMBER_B, OUTSIDER, PLAIN];

/** One trace id the aggregate, a member and the outsider all write under. */
const SHARED_TRACE = `shared-trace-${run}`;
/** A trace only member A holds; the outsider holds an evaluation on it. */
const A_TRACE = `a-trace-${run}`;
/** A trace only the outsider holds. */
const OUTSIDER_TRACE = `outsider-trace-${run}`;
/** Member B's traces either side of its grant's from date. */
const B_YESTERDAY_TRACE = `b-yesterday-trace-${run}`;
const B_TODAY_TRACE = `b-today-trace-${run}`;
const PLAIN_TRACE = `plain-trace-${run}`;

const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * The clock every proof and row is minted against, taken once ClickHouse is up and migrated:
 * a proof expires minutes after its `now`, and a cold migration can take longer than that.
 */
let NOW: number;
let TODAY: number;
let YESTERDAY: number;
/** The evaluation summaries read is bounded below like the list window is. */
let SINCE: number;

let ch: ClickHouseClient;
let summaries: TraceSummaryClickHouseRepository;
let evaluations: ClickHouseTraceEvaluationRunsRepository;

function summaryRow({
  tenantId,
  traceId,
  occurredAtMs,
}: {
  tenantId: string;
  traceId: string;
  occurredAtMs: number;
}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    TraceId: traceId,
    Version: "v1",
    Attributes: {},
    OccurredAt: new Date(occurredAtMs),
    CreatedAt: new Date(occurredAtMs),
    UpdatedAt: new Date(occurredAtMs),
    ComputedIOSchemaVersion: "v1",
    ComputedInput: `input-of-${tenantId}`,
    ComputedOutput: `output-of-${tenantId}`,
    TimeToFirstTokenMs: null,
    TimeToLastTokenMs: null,
    TotalDurationMs: 100,
    TokensPerSecond: null,
    SpanCount: 1,
    ContainsErrorStatus: false,
    ContainsOKStatus: true,
    ErrorMessage: null,
    Models: [],
    TotalCost: null,
    TokensEstimated: false,
    TotalPromptTokenCount: null,
    TotalCompletionTokenCount: null,
    OutputFromRootSpan: false,
    OutputSpanEndTimeMs: 0,
    BlockedByGuardrail: false,
    TraceName: `trace-of-${tenantId}`,
    RootSpanType: "",
    ContainsAi: false,
    ContainsPrompt: false,
    AnnotationIds: [],
    LastEventOccurredAt: new Date(occurredAtMs),
    TopicId: null,
    SubTopicId: null,
  };
}

function evaluationRow({ tenantId, traceId }: { tenantId: string; traceId: string }) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    EvaluationId: `eval-${tenantId}-${traceId}`,
    Version: "v1",
    EvaluatorId: "evaluator-1",
    EvaluatorType: "test/evaluator",
    EvaluatorName: `evaluator-of-${tenantId}`,
    TraceId: traceId,
    IsGuardrail: 0,
    Status: "processed",
    Score: 1,
    Passed: 1,
    Label: null,
    Details: null,
    Error: null,
    ErrorDetails: null,
    LastProcessedEventId: `evt-${nanoid()}`,
    ScheduledAt: new Date(TODAY),
    StartedAt: new Date(TODAY),
    CompletedAt: new Date(TODAY),
    CreatedAt: new Date(TODAY),
    UpdatedAt: new Date(TODAY),
    LastEventOccurredAt: new Date(TODAY),
  };
}

const aggregateReadsAandB = () =>
  aggregateProof({
    projectId: AGGREGATE,
    members: [
      { projectId: MEMBER_A, from: 0 },
      { projectId: MEMBER_B, from: TODAY },
    ],
    now: NOW,
  });

describe.skipIf(!clickHouseConfigured)("trace summary and evaluations through the proof", () => {
  beforeAll(async () => {
    ch = await startMigratedTraceClickHouse();
    NOW = Date.now();
    TODAY = NOW - 60 * 60 * 1000;
    YESTERDAY = TODAY - DAY_MS;
    SINCE = YESTERDAY - DAY_MS;
    const reads = authorizedReadsOver(ch);
    summaries = TraceSummaryClickHouseRepository.create({ resolveClient: async () => ch, reads });
    evaluations = ClickHouseTraceEvaluationRunsRepository.create({ reads });

    const settings = { async_insert: 0, wait_for_async_insert: 0 } as const;
    await ch.insert({
      table: "trace_summaries",
      values: [
        summaryRow({ tenantId: AGGREGATE, traceId: SHARED_TRACE, occurredAtMs: TODAY }),
        summaryRow({ tenantId: MEMBER_A, traceId: SHARED_TRACE, occurredAtMs: TODAY + 1 }),
        summaryRow({ tenantId: OUTSIDER, traceId: SHARED_TRACE, occurredAtMs: TODAY + 2 }),
        summaryRow({ tenantId: OUTSIDER, traceId: OUTSIDER_TRACE, occurredAtMs: TODAY + 3 }),
        summaryRow({ tenantId: MEMBER_A, traceId: A_TRACE, occurredAtMs: TODAY }),
        summaryRow({ tenantId: MEMBER_B, traceId: B_YESTERDAY_TRACE, occurredAtMs: YESTERDAY }),
        summaryRow({ tenantId: MEMBER_B, traceId: B_TODAY_TRACE, occurredAtMs: TODAY + 5 }),
        summaryRow({ tenantId: PLAIN, traceId: PLAIN_TRACE, occurredAtMs: TODAY }),
      ],
      format: "JSONEachRow",
      clickhouse_settings: settings,
    });
    await ch.insert({
      table: "evaluation_runs",
      values: [
        evaluationRow({ tenantId: MEMBER_A, traceId: A_TRACE }),
        evaluationRow({ tenantId: OUTSIDER, traceId: A_TRACE }),
        evaluationRow({ tenantId: OUTSIDER, traceId: OUTSIDER_TRACE }),
        evaluationRow({ tenantId: AGGREGATE, traceId: SHARED_TRACE }),
        evaluationRow({ tenantId: PLAIN, traceId: PLAIN_TRACE }),
      ],
      format: "JSONEachRow",
      clickhouse_settings: settings,
    });
  }, 180_000);

  afterAll(async () => {
    if (!ch) return;
    for (const table of ["trace_summaries", "evaluation_runs"]) {
      await ch.exec({
        query: `ALTER TABLE ${table} DELETE WHERE TenantId IN {tenants:Array(String)}`,
        query_params: { tenants: TENANTS },
      });
    }
  });

  describe("given a proof with own grant on the aggregate and shared grants on members A and B", () => {
    describe("when a fourth project holds rows under the same trace ids", () => {
      /** @scenario "A project outside the proof contributes nothing" */
      it("reads the aggregate's and the members' summaries and never the outsider's", async () => {
        const authorization = aggregateReadsAandB();

        // A trace only the outsider holds is absent, on the hinted read and
        // on the hint-less read that resolves the trace's time first.
        expect(
          await summaries.findByTraceId({
            authorization,
            traceId: OUTSIDER_TRACE,
            occurredAtMs: TODAY,
          }),
        ).toBeNull();
        expect(
          await summaries.findByTraceId({ authorization, traceId: OUTSIDER_TRACE }),
        ).toBeNull();

        const memberTrace = await summaries.findByTraceId({ authorization, traceId: A_TRACE });
        expect(memberTrace?.traceName).toBe(`trace-of-${MEMBER_A}`);
        expect(memberTrace?.tenantId).toBe(MEMBER_A);

        const sharedTrace = await summaries.findByTraceId({
          authorization,
          traceId: SHARED_TRACE,
          occurredAtMs: TODAY,
        });
        expect([`trace-of-${AGGREGATE}`, `trace-of-${MEMBER_A}`]).toContain(sharedTrace?.traceName);
        // The winners are ordered by tenant, so every read picks the same one.
        expect(sharedTrace?.tenantId).toBe([AGGREGATE, MEMBER_A].toSorted()[0]);
      });

      /** @scenario "A project outside the proof contributes nothing" */
      it("decorates listed traces with the members' evaluations and never the outsider's", async () => {
        const authorization = aggregateReadsAandB();

        const byTrace = await evaluations.findSummariesByTraceIds({
          authorization,
          traceIds: [A_TRACE, OUTSIDER_TRACE, SHARED_TRACE],
          since: SINCE,
        });

        expect(Object.keys(byTrace).toSorted()).toEqual([A_TRACE, SHARED_TRACE].toSorted());
        const names = Object.values(byTrace)
          .flat()
          .map((summary) => summary.evaluatorName);
        expect(names).not.toContain(`evaluator-of-${OUTSIDER}`);
        // The outsider's evaluation on the member's trace id is not the member's.
        expect(byTrace[A_TRACE]?.map((summary) => summary.evaluatorName)).toEqual([
          `evaluator-of-${MEMBER_A}`,
        ]);
      });

      it("reads a trace's runs and evaluations from the members and never the outsider", async () => {
        const authorization = aggregateReadsAandB();

        const runs = await evaluations.findRunsByTraceId({ authorization, traceId: A_TRACE });
        const detail = await evaluations.findTraceEvaluations({
          authorization,
          traceIds: [A_TRACE, OUTSIDER_TRACE],
        });

        expect(runs.map((run) => run.evaluatorName)).toEqual([`evaluator-of-${MEMBER_A}`]);
        expect(detail[A_TRACE]?.map((evaluation) => evaluation.evaluatorName)).toEqual([
          `evaluator-of-${MEMBER_A}`,
        ]);
        expect(detail[OUTSIDER_TRACE]).toEqual([]);
      });
    });
  });

  describe("given a member grant whose from date is today", () => {
    describe("when the aggregate reads the member's traces", () => {
      /** @scenario "A trace written before the grant's from date is not shared" */
      it("returns today's summary and not yesterday's", async () => {
        const authorization = aggregateReadsAandB();

        expect(
          await summaries.findByTraceId({
            authorization,
            traceId: B_YESTERDAY_TRACE,
            occurredAtMs: YESTERDAY,
          }),
        ).toBeNull();
        expect(
          await summaries.findByTraceId({ authorization, traceId: B_YESTERDAY_TRACE }),
        ).toBeNull();

        const today = await summaries.findByTraceId({ authorization, traceId: B_TODAY_TRACE });
        expect(today?.traceName).toBe(`trace-of-${MEMBER_B}`);
      });
    });
  });

  describe("given a member grant with an end as well as a start", () => {
    describe("when the aggregate reads a member trace inside that window", () => {
      it("returns it, the window applied to the stored time and not its projected alias", async () => {
        const bounded = aggregateProof({
          projectId: AGGREGATE,
          members: [{ projectId: MEMBER_B, from: TODAY - 60_000, until: TODAY + 60_000 }],
          now: NOW,
        });

        const inside = await summaries.findByTraceId({
          authorization: bounded,
          traceId: B_TODAY_TRACE,
        });
        const hinted = await summaries.findByTraceId({
          authorization: bounded,
          traceId: B_TODAY_TRACE,
          occurredAtMs: TODAY,
        });

        expect(inside?.tenantId).toBe(MEMBER_B);
        expect(hinted?.tenantId).toBe(MEMBER_B);
        expect(
          await summaries.findByTraceId({ authorization: bounded, traceId: B_YESTERDAY_TRACE }),
        ).toBeNull();
      });

      it("reads a member's runs inside the window though the select projects ScheduledAt", async () => {
        const bounded = aggregateProof({
          projectId: AGGREGATE,
          members: [{ projectId: MEMBER_A, from: TODAY - 60_000, until: TODAY + 60_000 }],
          now: NOW,
        });

        const runs = await evaluations.findRunsByTraceId({
          authorization: bounded,
          traceId: A_TRACE,
        });
        const detail = await evaluations.findTraceEvaluations({
          authorization: bounded,
          traceIds: [A_TRACE],
        });

        expect(runs.map((run) => run.evaluatorName)).toEqual([`evaluator-of-${MEMBER_A}`]);
        expect(detail[A_TRACE]).toHaveLength(1);
      });
    });
  });

  describe("given a plain project with no shared grants", () => {
    describe("when it reads its rows through an own-only proof", () => {
      /** @scenario "A plain project reads the same rows as before" */
      it("returns the same summary and evaluations as a direct tenant query", async () => {
        const authorization = ownProof({ projectId: PLAIN, now: NOW });

        const summary = await summaries.findByTraceId({ authorization, traceId: PLAIN_TRACE });
        const directSummary = await ch.query({
          query: `
              SELECT TraceId, ComputedInput, TraceName
              FROM trace_summaries
              WHERE TenantId = {tenantId:String}
                AND TraceId = {traceId:String}
            `,
          query_params: { tenantId: PLAIN, traceId: PLAIN_TRACE },
          format: "JSONEachRow",
        });
        const [summaryRowDirect] = await directSummary.json<{
          TraceId: string;
          ComputedInput: string;
          TraceName: string;
        }>();
        expect(summary).toMatchObject({
          traceId: summaryRowDirect?.TraceId,
          computedInput: summaryRowDirect?.ComputedInput,
          traceName: summaryRowDirect?.TraceName,
        });

        const byTrace = await evaluations.findSummariesByTraceIds({
          authorization,
          traceIds: [PLAIN_TRACE],
          since: SINCE,
        });
        const directEvaluations = await ch.query({
          query: `
              SELECT EvaluationId
              FROM evaluation_runs
              WHERE TenantId = {tenantId:String}
                AND TraceId = {traceId:String}
            `,
          query_params: { tenantId: PLAIN, traceId: PLAIN_TRACE },
          format: "JSONEachRow",
        });
        const directIds = (await directEvaluations.json<{ EvaluationId: string }>()).map(
          (row) => row.EvaluationId,
        );
        expect(directIds).toHaveLength(1);
        expect(byTrace[PLAIN_TRACE]?.map((summary) => summary.evaluationId)).toEqual(directIds);
      });
    });
  });
});
