/**
 * Dual-read-path integration proof for custom-graph threshold alerts.
 *
 * Seeds EQUIVALENT data into the legacy tables (trace_summaries +
 * evaluation_runs) AND the new ADR-034 analytics tables (trace_analytics +
 * evaluation_analytics_rollup) for one tenant, then runs the SAME graph
 * alert through the REAL `AnalyticsService.getTimeseries` twice:
 *
 *   - legacy path: `release_event_sourced_analytics_read` forced OFF via the
 *     per-flag env override (`RELEASE_EVENT_SOURCED_ANALYTICS_READ=0`) —
 *     reads trace_summaries / evaluation_runs through the legacy shim;
 *   - new-table path: flag forced ON (`=1`) — `pickAnalyticsTable` routes
 *     trace reads to trace_analytics (slim) and unkeyed eval reads to
 *     evaluation_analytics_rollup. Keyed eval series are pinned to stay on
 *     evaluation_runs even when the flag is ON (no EvaluatorId column on
 *     the fast-path tables).
 *
 * Covers BOTH trigger mechanisms:
 *   - the event-sourced evaluator (`evaluateGraphTrigger`) with
 *     `deps.getTimeseries` wired to the real service against a real
 *     ClickHouse testcontainer;
 *   - the cron evaluator (`processCustomGraphTrigger`) whose
 *     `calculateCurrentValue` seam runs against the same real timeseries
 *     result (prisma + notification hops mocked; analytics real).
 *
 * Pins the buildSeriesName fix: stored trigger identifiers use
 * `{index}/{key|metric}/{aggregation}` (see seriesIdentifier.ts) while
 * result buckets are keyed `{queryIndex}/{metric}/{agg}[/{key}]` — the
 * trace-count trigger watches index 1 of a two-series graph and the eval
 * trigger stores the evaluator ID as its key segment, the two shapes that
 * used to silently read 0.
 */

import type { CustomGraph, Project, Trigger } from "@prisma/client";
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type {
  AnalyticsBackend,
  TimeseriesResult,
} from "~/server/analytics/types";
import type { TimeseriesInputType } from "~/server/analytics/registry";
import { AnalyticsService } from "~/server/app-layer/analytics/analytics.service";
import {
  createEvalRollupReadRepo,
  createEvalSlimReadRepo,
  createTraceRollupReadRepo,
  createTraceSlimReadRepo,
  type AnalyticsTimeseriesReadRepository,
} from "~/server/app-layer/analytics/repositories/analyticsTimeseriesRead.repository";
import { ClickHouseLegacyAnalyticsShim } from "~/server/app-layer/analytics/repositories/legacy.shim";
import { EvaluationAnalyticsRollupClickHouseRepository } from "~/server/app-layer/evaluations/repositories/evaluation-analytics-rollup.clickhouse.repository";
import { TraceAnalyticsClickHouseRepository } from "~/server/app-layer/traces/repositories/trace-analytics.clickhouse.repository";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import {
  TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
  type TraceAnalyticsRow,
} from "~/server/event-sourcing/pipelines/trace-processing/projections/traceAnalytics.foldProjection";
import type { EvaluationAnalyticsRollupRow } from "~/server/event-sourcing/pipelines/evaluation-processing/projections/evaluationAnalyticsRollup.mapProjection";
import type {
  GraphAlertDispatchInput,
  GraphAlertDispatchResult,
} from "~/server/event-sourcing/pipelines/shared/graphAlertActionDispatch";
import { processCustomGraphTrigger } from "~/pages/api/cron/triggers/customGraphTrigger";
import {
  evaluateGraphTrigger,
  type EvaluateGraphTriggerResult,
  type GraphTriggerEvaluationDeps,
} from "../graph-trigger-evaluation.service";
import type {
  GraphTriggerSentRepository,
  OpenGraphTriggerSent,
} from "../repositories/trigger.repository";

// ─────────────────────────────────────────────────────────────────────
// Hoisted state shared with module mocks
// ─────────────────────────────────────────────────────────────────────

const hoisted = vi.hoisted(() => ({
  serviceRef: { current: null as unknown },
  cronGraphs: new Map<string, unknown>(),
}));

// The cron reads its analytics service through the barrel singleton; point
// it at the SAME instrumented real-service instance the event-sourced runs
// use so both mechanisms exercise identical CH reads.
vi.mock("~/server/app-layer/analytics", async (importOriginal) => {
  const orig =
    await importOriginal<typeof import("~/server/app-layer/analytics")>();
  return {
    ...orig,
    getAnalyticsService: () => hoisted.serviceRef.current,
  };
});

// The cron persists its graph + dedup rows via prisma (no Postgres in this
// harness) — persistence is faked, the calculation seam stays real.
vi.mock("~/server/db", () => ({
  prisma: {
    customGraph: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        return hoisted.cronGraphs.get(where.id) ?? null;
      }),
    },
    triggerSent: {
      findFirst: vi.fn(async () => null),
      update: vi.fn(async () => ({})),
    },
  },
}));

vi.mock("~/pages/api/cron/triggers/utils", async (importOriginal) => {
  const orig =
    await importOriginal<
      typeof import("~/pages/api/cron/triggers/utils")
    >();
  return {
    ...orig,
    addTriggersSent: vi.fn(async () => {}),
    updateAlert: vi.fn(async () => {}),
  };
});

vi.mock("~/pages/api/cron/triggers/actions/sendEmail", () => ({
  handleSendEmail: vi.fn(async () => {}),
}));
vi.mock("~/pages/api/cron/triggers/actions/sendSlackMessage", () => ({
  handleSendSlackMessage: vi.fn(async () => {}),
}));

// ─────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────

const tenantId = `test-graph-trigger-${nanoid()}`;

const EVALUATOR_MAIN = `check-main-${nanoid()}`;
const EVALUATOR_DECOY = `check-decoy-${nanoid()}`;

// Real wall-clock anchored: the cron path calls `new Date()` internally, so
// seeds must sit inside a window ending "now".
const nowBase = new Date();
const seedTime = new Date(nowBase.getTime() - 30 * 60 * 1000);
const seedMs = seedTime.getTime();

const TIME_PERIOD_MINUTES = 24 * 60;

// Seeded expectations (identical across both table families):
//   - 3 distinct traces                          → trace count = 3
//   - main evaluator scores 0.8 + 0.6            → keyed avg   = 0.7
//   - decoy evaluator score 0.0                  → unkeyed avg = 1.4 / 3
const EXPECTED_TRACE_COUNT = 3;
const EXPECTED_KEYED_AVG = 0.7;
const EXPECTED_UNKEYED_AVG = (0.8 + 0.6 + 0.0) / 3;

const TRACE_IDS = [
  `trace-a-${nanoid()}`,
  `trace-b-${nanoid()}`,
  `trace-c-${nanoid()}`,
] as const;

type RoutingMode = "legacy" | "routed";

function forceRouting(mode: RoutingMode): void {
  // Per-flag env override resolves BEFORE the postgres store / PostHog, so
  // routing is deterministic per call with no external flag backend.
  process.env.RELEASE_EVENT_SOURCED_ANALYTICS_READ =
    mode === "routed" ? "1" : "0";
  process.env.RELEASE_EVENT_SOURCED_ANALYTICS_READ_TRIPWIRE = "0";
}

const savedEnv = {
  read: process.env.RELEASE_EVENT_SOURCED_ANALYTICS_READ,
  tripwire: process.env.RELEASE_EVENT_SOURCED_ANALYTICS_READ_TRIPWIRE,
};

// Which repository actually served each getTimeseries call.
type RouteTarget =
  | "legacy_shim"
  | "trace_analytics"
  | "trace_analytics_rollup"
  | "evaluation_analytics"
  | "evaluation_analytics_rollup";
let routeLog: RouteTarget[] = [];

function recordingRepo(
  repo: AnalyticsTimeseriesReadRepository,
  label: RouteTarget,
): AnalyticsTimeseriesReadRepository {
  return {
    run: async (params) => {
      routeLog.push(label);
      return repo.run(params);
    },
  };
}

// Every getTimeseries call gets a UNIQUE `now` so the service's shared
// 30s TTL cache (Redis-backed in this harness) can never alias a
// legacy-path result into a routed-path run or vice versa.
let nowOffsetCounter = 0;
function uniqueNow(): Date {
  nowOffsetCounter += 1;
  return new Date(nowBase.getTime() + nowOffsetCounter * 1000);
}

const TRIGGER_ID = "trig-dual-path";

function makeTrigger(params: {
  seriesName: string;
  threshold: number;
  operator: string;
  customGraphId: string;
}): Trigger {
  return {
    id: TRIGGER_ID,
    projectId: tenantId,
    name: "Dual path alert",
    action: "SEND_EMAIL",
    actionParams: {
      threshold: params.threshold,
      operator: params.operator,
      timePeriod: TIME_PERIOD_MINUTES,
      seriesName: params.seriesName,
      members: ["alerts@example.com"],
    },
    filters: {},
    active: true,
    deleted: false,
    alertType: "WARNING",
    message: null,
    customGraphId: params.customGraphId,
    notificationCadence: "immediate",
    traceDebounceMs: 30_000,
    slackTemplateType: null,
    slackTemplate: null,
    emailSubjectTemplate: null,
    emailBodyTemplate: null,
    lastRunAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Trigger;
}

function makeGraph(params: {
  id: string;
  name: string;
  series: Array<Record<string, unknown>>;
}): CustomGraph {
  return {
    id: params.id,
    projectId: tenantId,
    name: params.name,
    graph: {
      series: params.series,
      groupBy: undefined,
      groupByKey: undefined,
      timeScale: 60,
    },
    filters: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as CustomGraph;
}

const project = {
  id: tenantId,
  name: "Dual Path Project",
  slug: "dual-path",
} as unknown as Project;

// Trace-count graph: the watched series sits at INDEX 1 so the stored
// identifier ("1/metadata.trace_id/cardinality") can NOT accidentally match
// the single-series result bucket key ("0/metadata.trace_id/cardinality") —
// the exact drift the buildSeriesName fix corrects.
const TRACE_GRAPH_ID = "graph-trace-count";
const traceGraph = makeGraph({
  id: TRACE_GRAPH_ID,
  name: "Trace count",
  series: [
    {
      name: "Total cost",
      metric: "performance.total_cost",
      aggregation: "sum",
      colorSet: "orangeTones",
    },
    {
      name: "Trace count",
      metric: "metadata.trace_id",
      aggregation: "cardinality",
      colorSet: "blueTones",
    },
  ],
});
const TRACE_SERIES_NAME = "1/metadata.trace_id/cardinality";

// Keyed eval graph: stored identifier carries the evaluator ID as its key
// segment ("0/<evaluatorId>/avg") — the regression shape that used to read 0
// because no result bucket is ever keyed by the evaluator ID alone.
const KEYED_EVAL_GRAPH_ID = "graph-eval-keyed";
const keyedEvalGraph = makeGraph({
  id: KEYED_EVAL_GRAPH_ID,
  name: "Main evaluator score",
  series: [
    {
      name: "Main evaluator score",
      metric: "evaluations.evaluation_score",
      aggregation: "avg",
      key: EVALUATOR_MAIN,
      colorSet: "greenTones",
    },
  ],
});
const KEYED_EVAL_SERIES_NAME = `0/${EVALUATOR_MAIN}/avg`;

// Unkeyed eval graph: eligible for the evaluation_analytics_rollup fast path
// when the flag is ON.
const UNKEYED_EVAL_GRAPH_ID = "graph-eval-unkeyed";
const unkeyedEvalGraph = makeGraph({
  id: UNKEYED_EVAL_GRAPH_ID,
  name: "All evaluators score",
  series: [
    {
      name: "All evaluators score",
      metric: "evaluations.evaluation_score",
      aggregation: "avg",
      colorSet: "purpleTones",
    },
  ],
});
const UNKEYED_EVAL_SERIES_NAME = "0/evaluations.evaluation_score/avg";

// ─────────────────────────────────────────────────────────────────────
// Harness
// ─────────────────────────────────────────────────────────────────────

let ch: ClickHouseClient;
let analyticsService: AnalyticsService;

class FakeTriggerSentRepo implements GraphTriggerSentRepository {
  openRows: OpenGraphTriggerSent[] = [];
  /** Every incident ever created, open or resolved — the alert's fire
   *  generation, which keys the per-recipient idempotency digest. */
  allRows: OpenGraphTriggerSent[] = [];

  async findOpenForGraphAlert(params: {
    triggerId: string;
    projectId: string;
    customGraphId: string;
  }): Promise<OpenGraphTriggerSent | null> {
    return (
      this.openRows.find(
        (r) =>
          r.triggerId === params.triggerId &&
          r.projectId === params.projectId &&
          r.customGraphId === params.customGraphId,
      ) ?? null
    );
  }

  async findLatestForGraphAlert(params: {
    triggerId: string;
    projectId: string;
    customGraphId: string;
  }): Promise<{ id: string } | null> {
    const matches = this.allRows.filter(
      (r) =>
        r.triggerId === params.triggerId &&
        r.projectId === params.projectId &&
        r.customGraphId === params.customGraphId,
    );
    const latest = matches[matches.length - 1];
    return latest ? { id: latest.id } : null;
  }

  async createOpenForGraphAlert(params: {
    triggerId: string;
    projectId: string;
    customGraphId: string;
  }): Promise<OpenGraphTriggerSent> {
    const row: OpenGraphTriggerSent = {
      id: `sent-${this.allRows.length + 1}`,
      ...params,
    };
    this.openRows.push(row);
    this.allRows.push(row);
    return row;
  }

  async markResolvedById(params: { id: string }): Promise<void> {
    this.openRows = this.openRows.filter((r) => r.id !== params.id);
  }
}

interface EvaluationRun {
  result: EvaluateGraphTriggerResult;
  dispatches: GraphAlertDispatchInput[];
  routes: RouteTarget[];
}

async function runEvaluation(params: {
  mode: RoutingMode;
  trigger: Trigger;
  graph: CustomGraph;
}): Promise<EvaluationRun> {
  forceRouting(params.mode);
  routeLog = [];
  const dispatches: GraphAlertDispatchInput[] = [];
  const deps: GraphTriggerEvaluationDeps = {
    loadTrigger: async () => params.trigger,
    loadCustomGraph: async () => params.graph,
    loadProject: async () => project,
    getTimeseries: (input: TimeseriesInputType): Promise<TimeseriesResult> =>
      analyticsService.getTimeseries(input),
    triggerSent: new FakeTriggerSentRepo(),
    updateLastRunAt: async () => {},
    notifier: {
      dispatch: async (
        input: GraphAlertDispatchInput,
      ): Promise<GraphAlertDispatchResult> => {
        dispatches.push(input);
        return {
          channel: "email",
          didSend: true,
          missingVariables: [],
          renderErrors: [],
        };
      },
    },
    baseHost: "https://app.langwatch.test",
    now: uniqueNow,
  };
  const result = await evaluateGraphTrigger({
    deps,
    triggerId: params.trigger.id,
    projectId: tenantId,
    reason: "real-time",
  });
  return { result, dispatches, routes: [...routeLog] };
}

async function runCron(params: {
  mode: RoutingMode;
  trigger: Trigger;
}): Promise<{ result: Awaited<ReturnType<typeof processCustomGraphTrigger>>; routes: RouteTarget[] }> {
  forceRouting(params.mode);
  routeLog = [];
  // The cron derives its window from the real clock; a short stagger keeps
  // every call's cache key unique (30s shared TTL cache).
  await new Promise((resolve) => setTimeout(resolve, 5));
  const result = await processCustomGraphTrigger(params.trigger, [project]);
  return { result, routes: [...routeLog] };
}

function makeSlimTraceRow(traceId: string): TraceAnalyticsRow {
  return {
    tenantId,
    traceId,
    version: TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
    occurredAtMs: seedMs,
    createdAtMs: seedMs,
    updatedAtMs: seedMs,
    traceName: "dual path trace",
    topicId: null,
    subTopicId: null,
    userId: null,
    conversationId: null,
    customerId: null,
    origin: "",
    models: [],
    labels: [],
    totalCost: 0,
    nonBilledCost: 0,
    totalDurationMs: 100,
    timeToFirstTokenMs: null,
    tokensPerSecond: null,
    promptTokens: null,
    completionTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    reasoningTokens: null,
    hasError: false,
    hasAnnotation: null,
    attributes: {},
  };
}

function makeEvalRollupRow(params: {
  score: number;
  passed: boolean;
}): EvaluationAnalyticsRollupRow {
  return {
    tenantId,
    bucketStart: seedTime,
    evaluatorType: "langevals/test",
    status: "processed",
    evalCount: 1,
    passCount: params.passed ? 1 : 0,
    failCount: params.passed ? 0 : 1,
    errorCount: 0,
    skippedCount: 0,
    scoreSum: params.score,
    scoreCount: 1,
    durationSum: 0,
    costSum: 0,
    nonBilledCostSum: 0,
  };
}

function legacyTraceSummaryRow(traceId: string): Record<string, unknown> {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    TraceId: traceId,
    Version: "v1",
    Attributes: {},
    OccurredAt: seedTime,
    CreatedAt: seedTime,
    UpdatedAt: seedTime,
    ComputedIOSchemaVersion: "",
    ComputedInput: "in",
    ComputedOutput: "out",
    TotalDurationMs: 100,
    SpanCount: 1,
    ContainsErrorStatus: 0,
    ContainsOKStatus: 1,
    Models: [],
    TotalCost: 0,
    TokensEstimated: false,
  };
}

function legacyEvaluationRunRow(params: {
  traceId: string;
  evaluatorId: string;
  score: number;
  passed: boolean;
}): Record<string, unknown> {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    EvaluationId: `eval-${nanoid()}`,
    Version: "v1",
    EvaluatorId: params.evaluatorId,
    EvaluatorType: "langevals/test",
    EvaluatorName: "Judge",
    TraceId: params.traceId,
    IsGuardrail: 0,
    Status: "processed",
    Score: params.score,
    Passed: params.passed ? 1 : 0,
    CreatedAt: seedTime,
    UpdatedAt: seedTime,
    ScheduledAt: seedTime,
    StartedAt: seedTime,
    CompletedAt: seedTime,
    LastProcessedEventId: "",
  };
}

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;

  const resolveClient = async () => ch;

  analyticsService = new AnalyticsService({
    rollupRepository: recordingRepo(
      createTraceRollupReadRepo(resolveClient),
      "trace_analytics_rollup",
    ),
    slimRepository: recordingRepo(
      createTraceSlimReadRepo(resolveClient),
      "trace_analytics",
    ),
    evalRollupRepository: recordingRepo(
      createEvalRollupReadRepo(resolveClient),
      "evaluation_analytics_rollup",
    ),
    evalSlimRepository: recordingRepo(
      createEvalSlimReadRepo(resolveClient),
      "evaluation_analytics",
    ),
    legacyShim: {
      run: async (input: TimeseriesInputType) => {
        routeLog.push("legacy_shim");
        return new ClickHouseLegacyAnalyticsShim(resolveClient).run(input);
      },
    },
    legacyBackend: {} as AnalyticsBackend,
  });
  hoisted.serviceRef.current = analyticsService;

  hoisted.cronGraphs.set(TRACE_GRAPH_ID, traceGraph);
  hoisted.cronGraphs.set(KEYED_EVAL_GRAPH_ID, keyedEvalGraph);
  hoisted.cronGraphs.set(UNKEYED_EVAL_GRAPH_ID, unkeyedEvalGraph);

  // ── Seed the LEGACY tables ──────────────────────────────────────────
  await ch.insert({
    table: "trace_summaries",
    values: TRACE_IDS.map((traceId) => legacyTraceSummaryRow(traceId)),
    format: "JSONEachRow",
  });
  await ch.insert({
    table: "evaluation_runs",
    values: [
      legacyEvaluationRunRow({
        traceId: TRACE_IDS[0],
        evaluatorId: EVALUATOR_MAIN,
        score: 0.8,
        passed: true,
      }),
      legacyEvaluationRunRow({
        traceId: TRACE_IDS[1],
        evaluatorId: EVALUATOR_MAIN,
        score: 0.6,
        passed: true,
      }),
      legacyEvaluationRunRow({
        traceId: TRACE_IDS[2],
        evaluatorId: EVALUATOR_DECOY,
        score: 0.0,
        passed: false,
      }),
    ],
    format: "JSONEachRow",
  });

  // ── Seed the NEW analytics tables with EQUIVALENT data ──────────────
  const slimRepo = new TraceAnalyticsClickHouseRepository(async () => ch);
  await slimRepo.upsertBatch(
    TRACE_IDS.map((traceId) => ({ row: makeSlimTraceRow(traceId) })),
  );

  const evalRollupRepo = new EvaluationAnalyticsRollupClickHouseRepository(
    async () => ch,
  );
  await evalRollupRepo.insertRows([
    makeEvalRollupRow({ score: 0.8, passed: true }),
    makeEvalRollupRow({ score: 0.6, passed: true }),
    makeEvalRollupRow({ score: 0.0, passed: false }),
  ]);

  await ch.exec({ query: "SYSTEM FLUSH ASYNC INSERT QUEUE" });
  await ch.exec({ query: "SYSTEM FLUSH LOGS" });
}, 180_000);

afterAll(async () => {
  process.env.RELEASE_EVENT_SOURCED_ANALYTICS_READ = savedEnv.read;
  process.env.RELEASE_EVENT_SOURCED_ANALYTICS_READ_TRIPWIRE = savedEnv.tripwire;
  if (savedEnv.read === undefined) {
    delete process.env.RELEASE_EVENT_SOURCED_ANALYTICS_READ;
  }
  if (savedEnv.tripwire === undefined) {
    delete process.env.RELEASE_EVENT_SOURCED_ANALYTICS_READ_TRIPWIRE;
  }

  if (ch) {
    for (const table of [
      "trace_summaries",
      "evaluation_runs",
      "trace_analytics",
      "trace_analytics_rollup",
      "evaluation_analytics",
      "evaluation_analytics_rollup",
    ]) {
      await ch.exec({
        query: `ALTER TABLE ${table} DELETE WHERE TenantId = {tenantId:String}`,
        query_params: { tenantId },
      });
    }
  }
  await stopTestContainers();
});

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

describe("graph alert dual read paths (legacy tables vs analytics tables)", () => {
  describe("given a trace-count alert watching series index 1 (stored id ≠ bucket key)", () => {
    const trigger = makeTrigger({
      seriesName: TRACE_SERIES_NAME,
      threshold: 2,
      operator: "gt",
      customGraphId: TRACE_GRAPH_ID,
    });

    describe("when the event-sourced evaluator runs on both read paths", () => {
      let legacy: EvaluationRun;
      let routed: EvaluationRun;

      beforeAll(async () => {
        legacy = await runEvaluation({ mode: "legacy", trigger, graph: traceGraph });
        routed = await runEvaluation({ mode: "routed", trigger, graph: traceGraph });
      });

      it("fires on the legacy path reading trace_summaries via the shim", () => {
        expect(legacy.result.status).toBe("fired");
        expect(legacy.result.value).toBe(EXPECTED_TRACE_COUNT);
        expect(legacy.routes).toEqual(["legacy_shim"]);
      });

      it("fires on the new-table path reading trace_analytics (slim)", () => {
        expect(routed.result.status).toBe("fired");
        expect(routed.result.value).toBe(EXPECTED_TRACE_COUNT);
        expect(routed.routes).toEqual(["trace_analytics"]);
      });

      it("returns numerically identical current values on both paths", () => {
        expect(routed.result.value).toBeCloseTo(legacy.result.value!, 6);
      });

      it("dispatches a notification whose context carries the seeded value on both paths", () => {
        expect(legacy.dispatches).toHaveLength(1);
        expect(routed.dispatches).toHaveLength(1);
        expect(legacy.dispatches[0]!.context.currentValue).toBe(
          EXPECTED_TRACE_COUNT,
        );
        expect(routed.dispatches[0]!.context.currentValue).toBe(
          EXPECTED_TRACE_COUNT,
        );
      });
    });

    describe("when the threshold sits above the seeded value (control)", () => {
      it("stays not_breached on the legacy path and dispatches nothing", async () => {
        const control = makeTrigger({
          seriesName: TRACE_SERIES_NAME,
          threshold: 100,
          operator: "gt",
          customGraphId: TRACE_GRAPH_ID,
        });
        const run = await runEvaluation({
          mode: "legacy",
          trigger: control,
          graph: traceGraph,
        });
        expect(run.result.status).toBe("not_breached");
        expect(run.result.value).toBe(EXPECTED_TRACE_COUNT);
        expect(run.dispatches).toHaveLength(0);
      });

      it("stays not_breached on the new-table path and dispatches nothing", async () => {
        const control = makeTrigger({
          seriesName: TRACE_SERIES_NAME,
          threshold: 100,
          operator: "gt",
          customGraphId: TRACE_GRAPH_ID,
        });
        const run = await runEvaluation({
          mode: "routed",
          trigger: control,
          graph: traceGraph,
        });
        expect(run.result.status).toBe("not_breached");
        expect(run.result.value).toBe(EXPECTED_TRACE_COUNT);
        expect(run.routes).toEqual(["trace_analytics"]);
        expect(run.dispatches).toHaveLength(0);
      });
    });
  });

  describe("given a keyed eval-score alert (stored id carries the evaluator ID)", () => {
    const trigger = makeTrigger({
      seriesName: KEYED_EVAL_SERIES_NAME,
      threshold: 0.5,
      operator: "gt",
      customGraphId: KEYED_EVAL_GRAPH_ID,
    });

    describe("when the event-sourced evaluator runs on both read paths", () => {
      let legacy: EvaluationRun;
      let routed: EvaluationRun;

      beforeAll(async () => {
        legacy = await runEvaluation({
          mode: "legacy",
          trigger,
          graph: keyedEvalGraph,
        });
        routed = await runEvaluation({
          mode: "routed",
          trigger,
          graph: keyedEvalGraph,
        });
      });

      it("fires with the key-filtered average on the legacy path", () => {
        // 0.7 > 0.5 fires ONLY if the evaluator-ID predicate applied — the
        // unfiltered average (0.4667) would not breach.
        expect(legacy.result.status).toBe("fired");
        expect(legacy.result.value).toBeCloseTo(EXPECTED_KEYED_AVG, 6);
        expect(legacy.routes).toEqual(["legacy_shim"]);
      });

      it("fires with the same value when the analytics-read flag is ON", () => {
        expect(routed.result.status).toBe("fired");
        expect(routed.result.value).toBeCloseTo(EXPECTED_KEYED_AVG, 6);
      });

      it("keeps keyed eval series on evaluation_runs even when the flag is ON", () => {
        // Neither fast-path eval table carries EvaluatorId — routing a keyed
        // series anywhere else would silently blend evaluators.
        expect(routed.routes).toEqual(["legacy_shim"]);
      });

      it("dispatches with the keyed average in the template context on both paths", () => {
        expect(legacy.dispatches[0]!.context.currentValue).toBeCloseTo(
          EXPECTED_KEYED_AVG,
          6,
        );
        expect(routed.dispatches[0]!.context.currentValue).toBeCloseTo(
          EXPECTED_KEYED_AVG,
          6,
        );
      });
    });

    describe("when the threshold sits above the keyed average (control)", () => {
      it("stays not_breached on both paths", async () => {
        const control = makeTrigger({
          seriesName: KEYED_EVAL_SERIES_NAME,
          threshold: 0.9,
          operator: "gt",
          customGraphId: KEYED_EVAL_GRAPH_ID,
        });
        const legacy = await runEvaluation({
          mode: "legacy",
          trigger: control,
          graph: keyedEvalGraph,
        });
        const routed = await runEvaluation({
          mode: "routed",
          trigger: control,
          graph: keyedEvalGraph,
        });
        expect(legacy.result.status).toBe("not_breached");
        expect(routed.result.status).toBe("not_breached");
        expect(legacy.result.value).toBeCloseTo(EXPECTED_KEYED_AVG, 6);
        expect(routed.result.value).toBeCloseTo(EXPECTED_KEYED_AVG, 6);
      });
    });
  });

  describe("given an unkeyed eval-score alert (eligible for the eval rollup fast path)", () => {
    const trigger = makeTrigger({
      seriesName: UNKEYED_EVAL_SERIES_NAME,
      threshold: 0.4,
      operator: "gt",
      customGraphId: UNKEYED_EVAL_GRAPH_ID,
    });

    describe("when the event-sourced evaluator runs on both read paths", () => {
      let legacy: EvaluationRun;
      let routed: EvaluationRun;

      beforeAll(async () => {
        legacy = await runEvaluation({
          mode: "legacy",
          trigger,
          graph: unkeyedEvalGraph,
        });
        routed = await runEvaluation({
          mode: "routed",
          trigger,
          graph: unkeyedEvalGraph,
        });
      });

      it("fires on the legacy path reading evaluation_runs via the shim", () => {
        expect(legacy.result.status).toBe("fired");
        expect(legacy.result.value).toBeCloseTo(EXPECTED_UNKEYED_AVG, 6);
        expect(legacy.routes).toEqual(["legacy_shim"]);
      });

      it("fires on the new-table path reading evaluation_analytics_rollup", () => {
        expect(routed.result.status).toBe("fired");
        expect(routed.result.value).toBeCloseTo(EXPECTED_UNKEYED_AVG, 6);
        expect(routed.routes).toEqual(["evaluation_analytics_rollup"]);
      });

      it("returns numerically identical current values on both paths", () => {
        expect(routed.result.value).toBeCloseTo(legacy.result.value!, 6);
      });
    });
  });

  describe("given the cron evaluator (processCustomGraphTrigger)", () => {
    describe("when it processes the trace-count alert on the legacy path", () => {
      it("triggers with the seeded trace count", async () => {
        const { result, routes } = await runCron({
          mode: "legacy",
          trigger: makeTrigger({
            seriesName: TRACE_SERIES_NAME,
            threshold: 2,
            operator: "gt",
            customGraphId: TRACE_GRAPH_ID,
          }),
        });
        expect(result.status).toBe("triggered");
        expect(result.value).toBe(EXPECTED_TRACE_COUNT);
        expect(routes).toEqual(["legacy_shim"]);
      });

      it("does not trigger when the threshold is above the seeded value (control)", async () => {
        const { result } = await runCron({
          mode: "legacy",
          trigger: makeTrigger({
            seriesName: TRACE_SERIES_NAME,
            threshold: 100,
            operator: "gt",
            customGraphId: TRACE_GRAPH_ID,
          }),
        });
        expect(result.status).toBe("not_triggered");
        expect(result.value).toBe(EXPECTED_TRACE_COUNT);
      });
    });

    describe("when it processes the keyed eval-score alert on the legacy path", () => {
      it("triggers with the key-filtered average (regression shape)", async () => {
        const { result, routes } = await runCron({
          mode: "legacy",
          trigger: makeTrigger({
            seriesName: KEYED_EVAL_SERIES_NAME,
            threshold: 0.5,
            operator: "gt",
            customGraphId: KEYED_EVAL_GRAPH_ID,
          }),
        });
        expect(result.status).toBe("triggered");
        expect(result.value).toBeCloseTo(EXPECTED_KEYED_AVG, 6);
        expect(routes).toEqual(["legacy_shim"]);
      });
    });

    describe("when it processes the trace-count alert with the analytics-read flag ON", () => {
      it("triggers with the same value from trace_analytics", async () => {
        const { result, routes } = await runCron({
          mode: "routed",
          trigger: makeTrigger({
            seriesName: TRACE_SERIES_NAME,
            threshold: 2,
            operator: "gt",
            customGraphId: TRACE_GRAPH_ID,
          }),
        });
        expect(result.status).toBe("triggered");
        expect(result.value).toBe(EXPECTED_TRACE_COUNT);
        expect(routes).toEqual(["trace_analytics"]);
      });
    });
  });
});
