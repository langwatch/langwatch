/**
 * ADR-177 block C: summary, analytics read-back and evaluation summaries read through the
 * proof. Tenants share trace ids, so a leak hands back a row named after an uncovered project.
 * Spec: specs/governance/aggregate-project.feature, section C.
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { beforeAll, describe, expect, it } from "vitest";

import {
  aggregateProof,
  ownProof,
} from "../../../__tests__/support/authorization-proofs.fixture.ts";
import type { TraceAnalyticsRow } from "../../../eventing/trace-derived.projection.ts";
import { ClickHouseTraceEvaluationRunsRepository } from "../trace-evaluation-runs.repository.ts";
import { TraceAnalyticsClickHouseRepository } from "../trace-metrics-analytics.repository.ts";
import { TraceSummaryClickHouseRepository } from "../trace-summary.repository.ts";
import { authorizedClickHouseFor } from "./support/authorized-clickhouse.support.ts";
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
 * The clock every proof and row is minted against. Taken once the containers
 * are up, not at import: a proof expires AUTHORIZATION_MAX_AGE_MS after its
 * `now`, and a cold shard can spend longer than that starting ClickHouse.
 */
let NOW: number;
let TODAY: number;
let YESTERDAY: number;
/** The evaluation summaries read is bounded below like the list window is. */
let SINCE: number;

function takeClock(): void {
  NOW = Date.now();
  TODAY = NOW - 60 * 60 * 1000;
  YESTERDAY = TODAY - DAY_MS;
  SINCE = YESTERDAY - DAY_MS;
}

let ch: ClickHouseClient;
let summaries: TraceSummaryClickHouseRepository;
let analytics: TraceAnalyticsClickHouseRepository;
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

function analyticsRow({
  tenantId,
  traceId,
  occurredAtMs,
}: {
  tenantId: string;
  traceId: string;
  occurredAtMs: number;
}): TraceAnalyticsRow {
  return {
    tenantId,
    traceId,
    version: "2026-06-20",
    hasSignal: true,
    occurredAtMs,
    createdAtMs: occurredAtMs,
    updatedAtMs: occurredAtMs,
    traceName: `trace-of-${tenantId}`,
    topicId: null,
    subTopicId: null,
    userId: null,
    conversationId: null,
    customerId: null,
    origin: "sdk",
    models: [`model-of-${tenantId}`],
    labels: [],
    totalCost: 0.1,
    nonBilledCost: null,
    unpricedSpanCount: 0,
    unpricedModels: [],
    totalDurationMs: 100,
    timeToFirstTokenMs: null,
    tokensPerSecond: null,
    promptTokens: 10,
    completionTokens: 5,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    reasoningTokens: null,
    hasError: false,
    hasAnnotation: null,
    attributes: {},
    spanCount: 1,
    annotationIds: [],
    rootSpanStartTimeMs: occurredAtMs,
    traceNameFromFallback: false,
    rootMetadataFromFallback: false,
    traceNameUserOverridden: false,
    lastEventOccurredAt: occurredAtMs,
    earliestSpanStartMs: occurredAtMs,
  };
}

function evaluationRun({ tenantId, traceId }: { tenantId: string; traceId: string }) {
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

beforeAll(async () => {
  if (!clickHouseConfigured) return;
  ch = await startMigratedTraceClickHouse();
  takeClock();
  const resolveClient = async () => ch;
  const clickhouse = authorizedClickHouseFor(ch);
  summaries = TraceSummaryClickHouseRepository.create({
    resolveClient,
    clickhouse,
  });
  analytics = TraceAnalyticsClickHouseRepository.create({
    resolveClient,
    clickhouse,
  });
  evaluations = ClickHouseTraceEvaluationRunsRepository.create({
    resolveClient,
    clickhouse,
  });

  await ch.insert({
    table: "trace_summaries",
    values: [
      summaryRow({
        tenantId: AGGREGATE,
        traceId: SHARED_TRACE,
        occurredAtMs: TODAY,
      }),
      summaryRow({
        tenantId: MEMBER_A,
        traceId: SHARED_TRACE,
        occurredAtMs: TODAY + 1,
      }),
      summaryRow({
        tenantId: OUTSIDER,
        traceId: SHARED_TRACE,
        occurredAtMs: TODAY + 2,
      }),
      summaryRow({
        tenantId: OUTSIDER,
        traceId: OUTSIDER_TRACE,
        occurredAtMs: TODAY + 3,
      }),
      summaryRow({ tenantId: MEMBER_A, traceId: A_TRACE, occurredAtMs: TODAY }),
      summaryRow({
        tenantId: MEMBER_B,
        traceId: B_YESTERDAY_TRACE,
        occurredAtMs: YESTERDAY,
      }),
      summaryRow({
        tenantId: MEMBER_B,
        traceId: B_TODAY_TRACE,
        occurredAtMs: TODAY + 5,
      }),
      summaryRow({
        tenantId: PLAIN,
        traceId: PLAIN_TRACE,
        occurredAtMs: TODAY,
      }),
    ],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });

  for (const [tenantId, traceIds] of [
    [AGGREGATE, [SHARED_TRACE]],
    [MEMBER_A, [SHARED_TRACE, A_TRACE]],
    [OUTSIDER, [SHARED_TRACE, OUTSIDER_TRACE]],
    [PLAIN, [PLAIN_TRACE]],
  ] as const) {
    await analytics.upsertBatch(
      traceIds.map((traceId) => ({
        row: analyticsRow({ tenantId, traceId, occurredAtMs: TODAY }),
        retentionDays: 30,
        appliedEventIds: [],
      })),
    );
  }

  await ch.insert({
    table: "evaluation_runs",
    values: [
      evaluationRun({ tenantId: MEMBER_A, traceId: A_TRACE }),
      evaluationRun({ tenantId: OUTSIDER, traceId: A_TRACE }),
      evaluationRun({ tenantId: OUTSIDER, traceId: OUTSIDER_TRACE }),
      evaluationRun({ tenantId: AGGREGATE, traceId: SHARED_TRACE }),
      evaluationRun({ tenantId: PLAIN, traceId: PLAIN_TRACE }),
    ],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}, 120_000);

describe.skipIf(!clickHouseConfigured)(
  "trace summary, analytics and evaluation summaries through the proof",
  () => {
    describe("given a proof with own grant on the aggregate and shared grants on members A and B", () => {
      describe("when a fourth project holds rows under the same trace ids", () => {
        it("finds the tenant that holds a trace with the light seek, the same one the heavy read picks", async () => {
          const authorization = aggregateReadsAandB();

          expect(
            await summaries.findTenantIdsByTraceId({
              authorization,
              traceId: A_TRACE,
            }),
          ).toEqual([MEMBER_A]);
          expect(
            await summaries.findTenantIdsByTraceId({
              authorization,
              traceId: OUTSIDER_TRACE,
            }),
          ).toEqual([]);
          const heavy = await summaries.findByTraceId({
            authorization,
            traceId: SHARED_TRACE,
          });
          expect(
            (
              await summaries.findTenantIdsByTraceId({
                authorization,
                traceId: SHARED_TRACE,
              })
            )[0],
          ).toBe(heavy?.tenantId);
        });

        // @scenario "A project outside the proof contributes nothing"
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
            await summaries.findByTraceId({
              authorization,
              traceId: OUTSIDER_TRACE,
            }),
          ).toBeNull();

          const memberTrace = await summaries.findByTraceId({
            authorization,
            traceId: A_TRACE,
          });
          expect(memberTrace?.traceName).toBe(`trace-of-${MEMBER_A}`);

          const sharedTrace = await summaries.findByTraceId({
            authorization,
            traceId: SHARED_TRACE,
            occurredAtMs: TODAY,
          });
          expect([`trace-of-${AGGREGATE}`, `trace-of-${MEMBER_A}`]).toContain(
            sharedTrace?.traceName,
          );
        });

        // @scenario "A project outside the proof contributes nothing"
        it("reads the aggregate's and the members' analytics rows and never the outsider's", async () => {
          const authorization = aggregateReadsAandB();
          const window = { fromMs: TODAY - DAY_MS, toMs: TODAY + DAY_MS };

          expect(
            await analytics.findByTraceId({
              authorization,
              traceId: OUTSIDER_TRACE,
              window,
            }),
          ).toBeNull();
          expect(
            await analytics.findByTraceId({
              authorization,
              traceId: OUTSIDER_TRACE,
            }),
          ).toBeNull();

          const memberTrace = await analytics.findByTraceId({
            authorization,
            traceId: A_TRACE,
            window,
          });
          expect(memberTrace?.row.tenantId).toBe(MEMBER_A);

          const sharedTrace = await analytics.findByTraceId({
            authorization,
            traceId: SHARED_TRACE,
            window,
          });
          expect([AGGREGATE, MEMBER_A]).toContain(sharedTrace?.row.tenantId);
        });

        // @scenario "A project outside the proof contributes nothing"
        it("decorates listed traces with the members' evaluations and never the outsider's", async () => {
          const authorization = aggregateReadsAandB();

          const rows = await evaluations.findSummariesByTraceIds({
            authorization,
            traceIds: [A_TRACE, OUTSIDER_TRACE, SHARED_TRACE],
            since: SINCE,
          });

          expect(rows.map((row) => row.tenantId).toSorted()).toEqual(
            [AGGREGATE, MEMBER_A].toSorted(),
          );
          expect(rows.map((row) => row.evaluatorName)).not.toContain(`evaluator-of-${OUTSIDER}`);
          // The outsider's evaluation on the member's trace id is not the
          // member's: the row is keyed by tenant and trace id together.
          const onMemberTrace = rows.filter((row) => row.traceId === A_TRACE);
          expect(onMemberTrace).toHaveLength(1);
          expect(onMemberTrace[0]?.tenantId).toBe(MEMBER_A);
        });
      });
    });

    describe("given a member grant whose from date is today", () => {
      describe("when the aggregate reads the member's traces", () => {
        // @scenario "A trace written before the grant's from date is not shared"
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
            await summaries.findByTraceId({
              authorization,
              traceId: B_YESTERDAY_TRACE,
            }),
          ).toBeNull();

          const today = await summaries.findByTraceId({
            authorization,
            traceId: B_TODAY_TRACE,
          });
          expect(today?.traceName).toBe(`trace-of-${MEMBER_B}`);
        });
      });
    });

    describe("given a member grant with an end as well as a start", () => {
      describe("when the aggregate reads a member trace inside that window", () => {
        it("returns it, the window applied to the stored time and not its projected alias", async () => {
          const bounded = aggregateProof({
            projectId: AGGREGATE,
            members: [
              {
                projectId: MEMBER_B,
                from: TODAY - 60_000,
                until: TODAY + 60_000,
              },
            ],
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
            await summaries.findByTraceId({
              authorization: bounded,
              traceId: B_YESTERDAY_TRACE,
            }),
          ).toBeNull();
        });
      });
    });

    describe("given a plain project with no shared grants", () => {
      describe("when it reads its rows through an own-only proof", () => {
        // @scenario "A plain project reads the same rows as before"
        it("returns the same summary, analytics row and evaluations as a direct tenant query", async () => {
          const authorization = ownProof({ projectId: PLAIN, now: NOW });

          const summary = await summaries.findByTraceId({
            authorization,
            traceId: PLAIN_TRACE,
          });
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

          const analyticsRead = await analytics.findByTraceId({
            authorization,
            traceId: PLAIN_TRACE,
          });
          const directAnalytics = await ch.query({
            query: `
            SELECT TenantId, TraceId, TraceName, Models
            FROM trace_analytics
            WHERE TenantId = {tenantId:String}
              AND TraceId = {traceId:String}
          `,
            query_params: { tenantId: PLAIN, traceId: PLAIN_TRACE },
            format: "JSONEachRow",
          });
          const [analyticsRowDirect] = await directAnalytics.json<{
            TenantId: string;
            TraceId: string;
            TraceName: string;
            Models: string[];
          }>();
          expect(analyticsRead?.row).toMatchObject({
            tenantId: analyticsRowDirect?.TenantId,
            traceId: analyticsRowDirect?.TraceId,
            traceName: analyticsRowDirect?.TraceName,
            models: analyticsRowDirect?.Models,
          });

          const evaluationRows = await evaluations.findSummariesByTraceIds({
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
          expect(evaluationRows.map((row) => row.evaluationId)).toEqual(directIds);
          expect(evaluationRows[0]?.tenantId).toBe(PLAIN);
        });
      });
    });
  },
);
