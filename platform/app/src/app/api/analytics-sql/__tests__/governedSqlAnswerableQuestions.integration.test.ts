/**
 * The questions the governed analytics SQL API exists to answer, each asked
 * through the public endpoint against a seed whose answer is known before the
 * query runs.
 *
 * ## What makes a case here evidence
 *
 * **The number, not the status code.** Every case asserts the value the seed
 * implies — this percentile, this rate, this sum — because a 200 with rows in
 * it proves the plumbing and nothing about the answer. A case that could pass
 * against a differently-shaped seed is not testing the question.
 *
 * **Two tenants, and the other one is loud.** The second project holds rows in
 * every window this suite queries, with measures deliberately unlike the
 * asking tenant's: durations multiplied, every trace an error, costs an order
 * of magnitude out. So "only the authenticated tenant contributed" is proven by
 * the asserted number itself rather than by a separate check — a leak of even
 * one foreign row moves every assertion below.
 *
 * **One window per question.** Each question owns a day, and its query filters
 * to it. Without that, one question's fixture would silently become part of
 * another's answer, and the seed would have to be read end to end to know what
 * any single case means.
 *
 * ## The seeds are engineered, not sampled
 *
 * The latency tiers in particular are chosen so that the 50th, 95th and 99th
 * percentile each land strictly inside a tier of equal values. A seed whose
 * tier boundary sat on a percentile index would make the assertion depend on
 * which rounding convention ClickHouse picked, and the case would be pinning
 * the implementation rather than the answer.
 *
 * @see specs/analytics/governed-sql-api.feature
 * @see ~/server/analytics/governed-sql — the service under test
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { projectFactory } from "~/factories/project.factory";
import type { Organization, Project, Team } from "~/generated/prisma/client";
import {
  createGovernedSqlExecutor,
  GovernedSqlService,
  governedTenantCapability,
  setGovernedSqlService,
} from "~/server/analytics/governed-sql";
import {
  type GovernedClickHouseHarness,
  type GovernedPostgresHarness,
  mapPostgresIntoClickHouse,
  postgresTenantSeedStatements,
  startGovernedClickHouse,
  startGovernedPostgres,
} from "~/server/analytics/governed-sql/__tests__/governedClickHouseHarness";
import {
  governedViewSetupStatements,
  SHIPPED_GOVERNED_DEDUP,
} from "~/server/analytics/governed-sql/views";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import {
  type PlanProvider,
  PlanProviderService,
} from "~/server/app-layer/subscription/plan-provider";
import { prisma } from "~/server/db";
import { FREE_PLAN } from "../../../../../ee/licensing/constants";
import { app } from "../[[...route]]/app";

// ---------------------------------------------------------------------------
// The windows. One day per question, so no fixture is part of another answer.
// ---------------------------------------------------------------------------

const DAY = {
  latency: "2026-03-10",
  errorRatePrevious: "2026-03-11",
  errorRateCurrent: "2026-03-12",
  rolling: "2026-03-13",
  cost: "2026-03-14",
  outliers: "2026-03-15",
  evaluations: "2026-03-16",
  spanOrder: "2026-03-17",
  retries: "2026-03-18",
  experiments: "2026-03-19",
  missingBuckets: "2026-03-21",
  unfinishedPeriod: "2026-03-22",
} as const;

/** `2026-03-10 04:00:00.000`, the format ClickHouse reads and writes. */
function at(day: string, hour = 0, second = 0): string {
  const hh = String(hour).padStart(2, "0");
  const ss = String(second).padStart(2, "0");
  return `${day} ${hh}:00:${ss}.000`;
}

/**
 * A quarter-hour inside the rolling-window day.
 *
 * Quarter-hours rather than hours because the question is a *one-hour* rolling
 * window: over hourly buckets that window is one bucket wide and the rolling
 * rate is the bucket's own rate, which would answer the question by not asking
 * it.
 */
function quarterHour(minute: number): string {
  return `${DAY.rolling} 00:${String(minute).padStart(2, "0")}:00.000`;
}

/** Quarter-hours in one hour: the width of the rolling window, in buckets. */
const ROLLING_BUCKETS = [0, 15, 30, 45] as const;

/** The half-open range a question's query filters on, as SQL. */
function within(column: string, day: string, days = 1): string {
  const end = new Date(`${day}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + days);
  const to = end.toISOString().slice(0, 10);
  return (
    `${column} >= toDateTime64('${at(day)}', 3) ` +
    `AND ${column} < toDateTime64('${at(to)}', 3)`
  );
}

/**
 * Latency tiers for the percentile question.
 *
 * 31 / 17 / 2 over fifty traces: the 50th percentile lands inside the first
 * tier, the 95th inside the second and the 99th inside the third, whichever of
 * the two index conventions ClickHouse uses.
 */
const LATENCY_TIERS = [
  { durationMs: 100, count: 31 },
  { durationMs: 200, count: 17 },
  { durationMs: 5000, count: 2 },
] as const;

/**
 * The prompt id every seeded trace records, and therefore the id the asking
 * tenant's PostgreSQL-resident prompt must carry for a by-name join to match.
 */
const SEEDED_PROMPT_ID = "prompt-checkout";

/**
 * The evaluated traces the seeded annotations are left on.
 *
 * Built from `evaluationSeeds()`' own ids through the same `${tenantId}-`
 * prefix `seedTenant` applies, rather than restated: written out by hand the
 * unprefixed form joins to nothing, and an annotation-to-evaluation join that
 * matches no rows reports an agreement rate over zero comparisons rather than
 * failing.
 */
const annotatedTraceIds = (tenantId: string): string[] =>
  evaluationSeeds().map((seed) => `${tenantId}-${seed.traceId}`);
/**
 * The human verdict on each of those traces, in order.
 *
 * Chosen against `evaluationSeeds()` so agreement is a distinctive fraction
 * rather than all-or-nothing: the evaluator passed the first two of the primary
 * model's three and the last of the second's, and the human agrees on four of
 * the six.
 */
const ANNOTATION_THUMBS = [true, false, false, false, true, true] as const;
/** Agreements over {@link annotatedTraceIds}: evaluator pass matches thumbs. */
const EXPECTED_AGREEMENTS = 4;

/** Scores of the two seeded experiment runs. The comparison's whole point. */
const EXPERIMENT_RUN_SCORES = [0.5, 0.9] as const;

const PRIMARY_MODEL = "gpt-5-mini";
const SECOND_MODEL = "claude-haiku";
const SECOND_MODEL_DURATION_MS = 300;
const SECOND_MODEL_TRACES = 10;

/**
 * What the second tenant's rows are multiplied by.
 *
 * Seven rather than two so that no leaked combination of its rows can land on
 * the asking tenant's expected number by arithmetic accident.
 */
const OTHER_TENANT_FACTOR = 7;

// ---------------------------------------------------------------------------
// Row builders
// ---------------------------------------------------------------------------

interface TraceSeed {
  traceId: string;
  occurredAt: string;
  durationMs: number;
  model?: string;
  error?: boolean;
  cost?: number;
  promptTokens?: number;
  completionTokens?: number;
  promptVersion?: number;
}

function traceRow(
  tenantId: string,
  {
    traceId,
    occurredAt,
    durationMs,
    model = PRIMARY_MODEL,
    error = false,
    cost = 0.01,
    promptTokens = 100,
    completionTokens = 20,
    promptVersion = 1,
  }: TraceSeed,
): Record<string, unknown> {
  return {
    ProjectionId: `${tenantId}/${traceId}`,
    TenantId: tenantId,
    TraceId: traceId,
    Version: "1",
    Attributes: { "gen_ai.request.model": model },
    OccurredAt: occurredAt,
    UpdatedAt: occurredAt,
    ComputedIOSchemaVersion: "1",
    ComputedInput: `input/${traceId}`,
    ComputedOutput: `output/${traceId}`,
    TotalDurationMs: durationMs,
    SpanCount: 1,
    ContainsErrorStatus: error,
    ContainsOKStatus: !error,
    Models: [model],
    TotalCost: cost,
    TokensEstimated: false,
    TotalPromptTokenCount: promptTokens,
    TotalCompletionTokenCount: completionTokens,
    ContainsPrompt: true,
    LastUsedPromptId: SEEDED_PROMPT_ID,
    LastUsedPromptVersionNumber: promptVersion,
    TraceName: "checkout",
  };
}

interface SpanSeed {
  traceId: string;
  spanId: string;
  spanName: string;
  startTime: string;
  durationMs?: number;
  statusCode?: number;
}

function spanRow(
  tenantId: string,
  {
    traceId,
    spanId,
    spanName,
    startTime,
    durationMs = 250,
    statusCode = 1,
  }: SpanSeed,
): Record<string, unknown> {
  return {
    ProjectionId: `${tenantId}/${spanId}`,
    TenantId: tenantId,
    TraceId: traceId,
    SpanId: spanId,
    Sampled: 1,
    StartTime: startTime,
    EndTime: startTime,
    DurationMs: durationMs,
    SpanName: spanName,
    SpanKind: 3,
    StatusCode: statusCode,
    ServiceName: "api",
    ScopeName: "langwatch",
    ResourceAttributes: { "service.name": "api" },
    SpanAttributes: { "gen_ai.request.model": PRIMARY_MODEL },
    Cost: 0.001,
  };
}

interface EvaluationSeed {
  evaluationId: string;
  traceId: string;
  score: number;
  passed: number;
  scheduledAt: string;
}

function evaluationRow(
  tenantId: string,
  { evaluationId, traceId, score, passed, scheduledAt }: EvaluationSeed,
): Record<string, unknown> {
  return {
    ProjectionId: `${tenantId}/${evaluationId}`,
    TenantId: tenantId,
    EvaluationId: evaluationId,
    Version: "1",
    EvaluatorId: "quality",
    EvaluatorType: "llm_judge",
    EvaluatorName: "Quality",
    TraceId: traceId,
    Status: "processed",
    Score: score,
    Passed: passed,
    Details: "scored on rubric",
    Inputs: `evaluation-input/${evaluationId}`,
    ScheduledAt: scheduledAt,
    UpdatedAt: scheduledAt,
    LastProcessedEventId: "seed",
  };
}

interface SimulationSeed {
  runId: string;
  batchRunId: string;
  verdict: string;
  durationMs: number;
  startedAt: string;
}

function simulationRow(
  tenantId: string,
  { runId, batchRunId, verdict, durationMs, startedAt }: SimulationSeed,
): Record<string, unknown> {
  return {
    ProjectionId: `${tenantId}/${runId}`,
    TenantId: tenantId,
    ScenarioRunId: runId,
    ScenarioId: "checkout",
    BatchRunId: batchRunId,
    ScenarioSetId: "default",
    Version: "1",
    Status: "SUCCESS",
    Name: "checkout flow",
    "Messages.Id": ["m1"],
    "Messages.Role": ["assistant"],
    "Messages.Content": ["said something"],
    "Messages.TraceId": [`${tenantId}-sim-trace`],
    "Messages.Rest": ["{}"],
    TraceIds: [`${tenantId}-sim-trace`],
    Verdict: verdict,
    Reasoning: "because",
    MetCriteria: ["completes checkout"],
    UnmetCriteria: [],
    DurationMs: durationMs,
    StartedAt: startedAt,
    CreatedAt: startedAt,
    UpdatedAt: startedAt,
  };
}

// ---------------------------------------------------------------------------
// The seed
// ---------------------------------------------------------------------------

/**
 * Every fixture, for one tenant.
 *
 * `factor` is what makes the second tenant's rows unmistakable: it multiplies
 * every measure, so a leaked row cannot land on the asking tenant's expected
 * value. Its traces are also all errors, which no window of the asking
 * tenant's is.
 */
function traceSeeds(factor: number): TraceSeed[] {
  const scale = (value: number) => value * factor;
  const foreign = factor !== 1;
  const seeds: TraceSeed[] = [];

  // Latency percentiles, in one day, across two models.
  let index = 0;
  for (const tier of LATENCY_TIERS) {
    for (let repeat = 0; repeat < tier.count; repeat += 1, index += 1) {
      seeds.push({
        traceId: `latency-${index}`,
        occurredAt: at(DAY.latency, 4),
        durationMs: scale(tier.durationMs),
        error: foreign,
      });
    }
  }
  for (let repeat = 0; repeat < SECOND_MODEL_TRACES; repeat += 1) {
    seeds.push({
      traceId: `latency-second-${repeat}`,
      occurredAt: at(DAY.latency, 4),
      durationMs: scale(SECOND_MODEL_DURATION_MS),
      model: SECOND_MODEL,
      error: foreign,
    });
  }

  // Error rate: two of ten yesterday, five of ten today. The second tenant is
  // ten of ten in both, so a leak cannot leave either rate unchanged.
  for (const [day, errors] of [
    [DAY.errorRatePrevious, 2],
    [DAY.errorRateCurrent, 5],
  ] as const) {
    for (let trace = 0; trace < 10; trace += 1) {
      seeds.push({
        traceId: `rate-${day}-${trace}`,
        occurredAt: at(day, 6),
        durationMs: scale(100),
        error: foreign || trace < errors,
      });
    }
  }

  // Rolling window: four consecutive quarter-hour buckets, zero to three
  // errors out of five traces each.
  ROLLING_BUCKETS.forEach((minute, bucket) => {
    for (let trace = 0; trace < 5; trace += 1) {
      seeds.push({
        traceId: `rolling-${minute}-${trace}`,
        occurredAt: quarterHour(minute),
        durationMs: scale(100),
        error: foreign || trace < bucket,
      });
    }
  });

  // Cost by model and prompt version.
  for (const spend of [
    { model: PRIMARY_MODEL, promptVersion: 1, cost: 0.1 },
    { model: PRIMARY_MODEL, promptVersion: 2, cost: 0.2 },
    { model: SECOND_MODEL, promptVersion: 1, cost: 0.05 },
  ]) {
    for (let trace = 0; trace < 2; trace += 1) {
      seeds.push({
        traceId: `cost-${spend.model}-v${spend.promptVersion}-${trace}`,
        occurredAt: at(DAY.cost, 8),
        durationMs: scale(100),
        model: spend.model,
        promptVersion: spend.promptVersion,
        cost: scale(spend.cost),
        error: foreign,
      });
    }
  }

  // Outliers: nine ordinary traces and one that costs five hundred times more.
  for (let trace = 0; trace < 9; trace += 1) {
    seeds.push({
      traceId: `outlier-normal-${trace}`,
      occurredAt: at(DAY.outliers, 9),
      durationMs: scale(100),
      cost: scale(0.01),
      promptTokens: scale(100),
      error: foreign,
    });
  }
  seeds.push({
    traceId: "outlier-extreme",
    occurredAt: at(DAY.outliers, 9),
    durationMs: scale(100),
    cost: scale(5),
    promptTokens: scale(50_000),
    error: foreign,
  });

  // Evaluation pass rates: three traces per model, joined to one evaluation
  // each below.
  for (const model of [PRIMARY_MODEL, SECOND_MODEL]) {
    for (let trace = 0; trace < 3; trace += 1) {
      seeds.push({
        traceId: `eval-${model}-${trace}`,
        occurredAt: at(DAY.evaluations, 10),
        durationMs: scale(100),
        model,
        error: foreign,
      });
    }
  }

  // Span ordering, which the fanout case aggregates over. Every trace here
  // carries the same duration, so a fanout multiplies a number the case knows.
  for (const traceId of ["ab", "ba", "a"]) {
    seeds.push({
      traceId: `order-${traceId}`,
      occurredAt: at(DAY.spanOrder, 11),
      durationMs: scale(1000),
      error: foreign,
    });
  }

  // First failure and first retry.
  for (const traceId of ["retry-1", "retry-2"]) {
    seeds.push({
      traceId,
      occurredAt: at(DAY.retries, 12),
      durationMs: scale(100),
      error: true,
    });
  }

  // A bucketed day with an hour missing from the middle of it.
  for (const hour of [0, 1, 3]) {
    seeds.push({
      traceId: `gap-${hour}`,
      occurredAt: at(DAY.missingBuckets, hour),
      durationMs: scale(100),
      error: foreign,
    });
  }

  // Three hourly buckets whose newest one is still filling at the instant the
  // unfinished-period case injects.
  for (const hour of [10, 11, 12]) {
    seeds.push({
      traceId: `filling-${hour}`,
      occurredAt: at(DAY.unfinishedPeriod, hour),
      durationMs: scale(100),
      error: foreign,
    });
  }

  return seeds;
}

function spanSeeds(): SpanSeed[] {
  return [
    // Retrieval before generation: the only trace that answers "A then B".
    {
      traceId: "order-ab",
      spanId: "ab-retrieve",
      spanName: "retrieve",
      startTime: at(DAY.spanOrder, 11, 0),
    },
    {
      traceId: "order-ab",
      spanId: "ab-generate",
      spanName: "generate",
      startTime: at(DAY.spanOrder, 11, 5),
    },
    // The same two operations the other way round.
    {
      traceId: "order-ba",
      spanId: "ba-generate",
      spanName: "generate",
      startTime: at(DAY.spanOrder, 11, 0),
    },
    {
      traceId: "order-ba",
      spanId: "ba-retrieve",
      spanName: "retrieve",
      startTime: at(DAY.spanOrder, 11, 5),
    },
    // One operation only: never an ordered pair.
    {
      traceId: "order-a",
      spanId: "a-retrieve",
      spanName: "retrieve",
      startTime: at(DAY.spanOrder, 11, 0),
    },
    // Two failures, then the retry that followed them.
    {
      traceId: "retry-1",
      spanId: "retry-1-call-1",
      spanName: "http.call",
      startTime: at(DAY.retries, 12, 1),
      statusCode: 2,
    },
    {
      traceId: "retry-1",
      spanId: "retry-1-call-2",
      spanName: "http.call",
      startTime: at(DAY.retries, 12, 2),
      statusCode: 2,
    },
    {
      traceId: "retry-1",
      spanId: "retry-1-retry",
      spanName: "http.retry",
      startTime: at(DAY.retries, 12, 3),
    },
    {
      traceId: "retry-2",
      spanId: "retry-2-call",
      spanName: "http.call",
      startTime: at(DAY.retries, 12, 10),
      statusCode: 2,
    },
    {
      traceId: "retry-2",
      spanId: "retry-2-retry",
      spanName: "http.retry",
      startTime: at(DAY.retries, 12, 20),
    },
  ];
}

/** Two of three pass for the first model, one of three for the second. */
function evaluationSeeds(): EvaluationSeed[] {
  return [
    { model: PRIMARY_MODEL, scores: [0.9, 0.8, 0.2], passed: [1, 1, 0] },
    { model: SECOND_MODEL, scores: [0.1, 0.2, 0.9], passed: [0, 0, 1] },
  ].flatMap(({ model, scores, passed }) =>
    scores.map((score, index) => ({
      evaluationId: `eval-${model}-${index}`,
      traceId: `eval-${model}-${index}`,
      score,
      passed: passed[index]!,
      scheduledAt: at(DAY.evaluations, 10),
    })),
  );
}

/** One batch that half-passed, one that passed outright. */
function simulationSeeds(): SimulationSeed[] {
  return [
    {
      runId: "run-1",
      batchRunId: "batch-1",
      verdict: "success",
      durationMs: 1000,
    },
    {
      runId: "run-2",
      batchRunId: "batch-1",
      verdict: "failure",
      durationMs: 2000,
    },
    {
      runId: "run-3",
      batchRunId: "batch-2",
      verdict: "success",
      durationMs: 500,
    },
    {
      runId: "run-4",
      batchRunId: "batch-2",
      verdict: "success",
      durationMs: 700,
    },
  ].map((run) => ({ ...run, startedAt: at(DAY.experiments, 13) }));
}

async function seedTenant({
  admin,
  database,
  tenantId,
  factor,
}: {
  admin: ClickHouseClient;
  database: string;
  tenantId: string;
  factor: number;
}): Promise<void> {
  const prefixed = (id: string) => `${tenantId}-${id}`;

  await admin.insert({
    table: `${database}.trace_summaries`,
    format: "JSONEachRow",
    values: traceSeeds(factor).map((seed) =>
      traceRow(tenantId, { ...seed, traceId: prefixed(seed.traceId) }),
    ),
  });
  await admin.insert({
    table: `${database}.stored_spans`,
    format: "JSONEachRow",
    values: spanSeeds().map((seed) =>
      spanRow(tenantId, {
        ...seed,
        traceId: prefixed(seed.traceId),
        spanId: prefixed(seed.spanId),
      }),
    ),
  });
  await admin.insert({
    table: `${database}.evaluation_runs`,
    format: "JSONEachRow",
    values: evaluationSeeds().map((seed) =>
      evaluationRow(tenantId, {
        ...seed,
        evaluationId: prefixed(seed.evaluationId),
        traceId: prefixed(seed.traceId),
        // The other tenant's evaluations invert every outcome, so a leak moves
        // both pass rates.
        passed: factor === 1 ? seed.passed : 1 - seed.passed,
        score: factor === 1 ? seed.score : 1 - seed.score,
      }),
    ),
  });
  await admin.insert({
    table: `${database}.simulation_runs`,
    format: "JSONEachRow",
    values: simulationSeeds().map((seed) =>
      simulationRow(tenantId, {
        ...seed,
        runId: prefixed(seed.runId),
        batchRunId: seed.batchRunId,
        verdict: factor === 1 ? seed.verdict : "failure",
        durationMs: seed.durationMs * factor,
      }),
    ),
  });
}

// ---------------------------------------------------------------------------

describe("given the governed analytics SQL API and a seed with known answers", () => {
  let harness: GovernedClickHouseHarness;
  let postgres: GovernedPostgresHarness;
  let organization: Organization;
  let team: Team;
  /** The authenticated tenant. Every asserted number is this project's. */
  let asking: Project;
  /** Seeded in every window, and contributes to no answer. */
  let other: Project;
  let database: string;
  let facts: string;

  const shippedService = () =>
    new GovernedSqlService({
      executor: createGovernedSqlExecutor({
        ...harness.restrictedConnection(),
        database,
        tenantSetting: harness.names.tenantSetting,
      }),
      database,
    });

  /** Runs SQL through the real endpoint, asserting it answered. */
  const ask = async (sql: string) => {
    const response = await app.request(
      `/api/v1/projects/${asking.id}/analytics/query/clickhouse`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Auth-Token": asking.apiKey,
        },
        body: JSON.stringify({ sql }),
      },
    );
    const body = (await response.json()) as Record<string, any>;
    expect(response.status, `query failed: ${JSON.stringify(body)}`).toBe(200);
    return body;
  };

  const codes = (body: Record<string, any>): string[] =>
    body.diagnostics.map((diagnostic: any) => diagnostic.code);

  const diagnostic = (body: Record<string, any>, code: string) =>
    body.diagnostics.find((entry: any) => entry.code === code);

  /**
   * Row count the second tenant holds in a window, read as the administrator.
   *
   * Every "only this tenant contributed" claim leans on those rows existing;
   * against an empty second tenant the asserted numbers would be right for the
   * wrong reason.
   */
  const foreignRowCount = async (
    table: string,
    timeColumn: string,
    day: string,
  ) => {
    const result = await harness.admin.query({
      query:
        `SELECT count() AS value FROM ${facts}.${table} ` +
        `WHERE TenantId = '${other.id}' AND ${within(timeColumn, day)}`,
      format: "JSONEachRow",
    });
    const [row] = await result.json<{ value: string }>();
    return Number(row!.value);
  };

  beforeAll(async () => {
    // The surface ships behind the experimental feature switch, off by
    // default; the suite runs with it on via the flag's own env override.
    process.env.RELEASE_GOVERNED_SQL_WORKBENCH = "1";
    // Three of the questions below are answered from PostgreSQL-resident
    // datasets, and every governed view over that half reads an engine table
    // that has to exist before the view can be created.
    postgres = await startGovernedPostgres();
    harness = await startGovernedClickHouse({
      suite: "questions",
      facts: "migrated",
    });
    database = harness.names.database;
    facts = harness.factDatabase;
    await mapPostgresIntoClickHouse({ harness, postgres });
    await harness.applyAsAdmin(
      governedViewSetupStatements({
        names: harness.names,
        sourceDatabase: facts,
        dedup: SHIPPED_GOVERNED_DEDUP,
      }),
    );

    await resetApp();
    globalForApp.__langwatch_app = createTestApp({
      planProvider: PlanProviderService.create({
        getActivePlan: vi
          .fn()
          .mockResolvedValue(FREE_PLAN) as PlanProvider["getActivePlan"],
      }),
      usageLimits: {
        notifyPlanLimitReached: vi.fn().mockResolvedValue(undefined),
        checkAndSendWarning: vi.fn().mockResolvedValue(undefined),
      } as any,
    });

    organization = await prisma.organization.create({
      data: { name: "Governed SQL Questions", slug: `governed-q-${nanoid()}` },
    });
    team = await prisma.team.create({
      data: {
        name: "Governed SQL Questions",
        slug: `governed-q-${nanoid()}`,
        organizationId: organization.id,
      },
    });
    asking = await prisma.project.create({
      data: {
        ...projectFactory.build({ slug: `asking-${nanoid()}` }),
        teamId: team.id,
        personalFeatures: {},
      },
    });
    other = await prisma.project.create({
      data: {
        ...projectFactory.build({ slug: `other-${nanoid()}` }),
        teamId: team.id,
        personalFeatures: {},
      },
    });

    await harness.admin.insert({
      table: `${database}.${harness.names.keyMapTable}`,
      format: "JSONEachRow",
      values: [asking, other].map((project) => ({
        KeyHash: governedTenantCapability({ secret: project.governedSqlKey }),
        TenantId: project.id,
      })),
    });

    await seedTenant({
      admin: harness.admin,
      database: facts,
      tenantId: asking.id,
      factor: 1,
    });
    await seedTenant({
      admin: harness.admin,
      database: facts,
      tenantId: other.id,
      factor: OTHER_TENANT_FACTOR,
    });

    // The PostgreSQL-resident half, under the same two real project ids. Both
    // tenants everywhere, so the isolation half of each answer below has
    // something it could have got wrong.
    for (const [project, promptId] of [
      // The asking tenant's prompt carries the id its traces record, so the
      // by-name join has both sides. A prompt id is a primary key, so the other
      // tenant gets its own — which is what a second project would really have.
      [asking, SEEDED_PROMPT_ID],
      [other, `${other.id}-prompt`],
    ] as const) {
      for (const statement of postgresTenantSeedStatements({
        tenantId: project.id,
        traceIds: annotatedTraceIds(project.id),
        thumbsUp: ANNOTATION_THUMBS,
        scores: EXPERIMENT_RUN_SCORES,
        promptId,
      })) {
        const result = await postgres.asAdmin(statement);
        expect(result.exitCode, result.stderr).toBe(0);
      }
    }

    setGovernedSqlService(shippedService());
  }, 600_000);

  afterAll(async () => {
    delete process.env.RELEASE_GOVERNED_SQL_WORKBENCH;
    setGovernedSqlService(null);
    // Guarded on the identifier each statement actually uses: `team` gates
    // everything keyed by teamId, while `organization.delete` gets its own
    // guard so a team-creation failure never leaves the organization behind
    // — and never turns an undefined teamId into a `deleteMany` that matches
    // every project in the database.
    if (team) {
      await prisma.project.deleteMany({ where: { teamId: team.id } });
      await prisma.team.delete({ where: { id: team.id } });
    }
    if (organization) {
      await prisma.organization.delete({ where: { id: organization.id } });
    }
    await harness?.stop();
    await postgres?.stop();
  });

  describe("when the second tenant's rows are counted", () => {
    it("finds them in every window the questions below query", async () => {
      for (const [table, timeColumn, day] of [
        ["trace_summaries", "OccurredAt", DAY.latency],
        ["trace_summaries", "OccurredAt", DAY.errorRateCurrent],
        ["trace_summaries", "OccurredAt", DAY.cost],
        ["stored_spans", "StartTime", DAY.spanOrder],
        ["evaluation_runs", "ScheduledAt", DAY.evaluations],
        ["simulation_runs", "StartedAt", DAY.experiments],
      ] as const) {
        expect(
          await foreignRowCount(table, timeColumn, day),
          `${table} holds no foreign rows on ${day} — every answer below would be right for the wrong reason`,
        ).toBeGreaterThan(0);
      }
    });
  });

  describe("when latency percentiles by model in time buckets are asked for", () => {
    /** @scenario "Latency percentiles by model in time buckets" */
    it("answers the seeded 50th, 95th and 99th percentile for each model", async () => {
      const body = await ask(
        `SELECT toStartOfDay(OccurredAt) AS bucket,
                arrayJoin(Models) AS model,
                quantileExact(0.5)(TotalDurationMs) AS p50,
                quantileExact(0.95)(TotalDurationMs) AS p95,
                quantileExact(0.99)(TotalDurationMs) AS p99,
                count() AS traces
         FROM ${database}.traces
         WHERE ${within("OccurredAt", DAY.latency)}
         GROUP BY bucket, model
         ORDER BY model`,
      );

      // Written out rather than derived from the seed constants: an expectation
      // computed from the fixture it checks agrees with any fixture, and a
      // changed seed would leave this case green while it answered something
      // else. The percentiles are `Int64`, which this response format quotes,
      // so the comparison reads them as numbers rather than pinning the
      // encoding.
      expect(
        body.rows.map((row: any) => [
          row.model,
          Number(row.p50),
          Number(row.p95),
          Number(row.p99),
          Number(row.traces),
        ]),
      ).toEqual([
        [SECOND_MODEL, 300, 300, 300, 10],
        [PRIMARY_MODEL, 100, 200, 5000, 50],
      ]);
      expect(codes(body)).toEqual([]);
    });
  });

  describe("when the error rate is compared with the previous equivalent period", () => {
    /** @scenario "Error rate versus the previous equivalent period" */
    it("answers both rates from the asking tenant's traces only", async () => {
      const current = `OccurredAt >= toDateTime64('${at(DAY.errorRateCurrent)}', 3)`;
      const body = await ask(
        `SELECT countIf(${current}) AS current_traces,
                countIf(${current} AND ContainsErrorStatus) AS current_errors,
                countIf(NOT (${current})) AS previous_traces,
                countIf(NOT (${current}) AND ContainsErrorStatus) AS previous_errors,
                round(current_errors / current_traces, 4) AS current_error_rate,
                round(previous_errors / previous_traces, 4) AS previous_error_rate
         FROM ${database}.traces
         WHERE ${within("OccurredAt", DAY.errorRatePrevious, 2)}`,
      );

      expect(body.rows).toHaveLength(1);
      expect(body.rows[0]).toMatchObject({
        current_error_rate: 0.5,
        previous_error_rate: 0.2,
      });
      expect(Number(body.rows[0].current_traces)).toBe(10);
      expect(Number(body.rows[0].previous_traces)).toBe(10);
      expect(codes(body)).toEqual([]);
    });
  });

  describe("when a rolling window over trace metrics is asked for", () => {
    /** @scenario "Rolling windows over trace metrics" */
    it("answers a one-hour rolling error rate over quarter-hour buckets", async () => {
      const oneHour = "ROWS BETWEEN 3 PRECEDING AND CURRENT ROW";
      const body = await ask(
        `SELECT bucket,
                errors,
                traces,
                round(
                  sum(errors) OVER (ORDER BY bucket ${oneHour})
                  / sum(traces) OVER (ORDER BY bucket ${oneHour}),
                  4
                ) AS rolling_error_rate
         FROM (
           SELECT toStartOfFifteenMinutes(OccurredAt) AS bucket,
                  countIf(ContainsErrorStatus) AS errors,
                  count() AS traces
           FROM ${database}.traces
           WHERE ${within("OccurredAt", DAY.rolling)}
           GROUP BY bucket
         )
         ORDER BY bucket`,
      );

      // Seeded errors per bucket are 0, 1, 2, 3 out of five traces each, so the
      // rolling rate walks 0/5, 1/10, 3/15 and 6/20 as the window fills.
      expect(body.rows.map((row: any) => row.rolling_error_rate)).toEqual([
        0, 0.1, 0.2, 0.3,
      ]);
      expect(body.rows.map((row: any) => Number(row.traces))).toEqual([
        5, 5, 5, 5,
      ]);
      expect(codes(body)).toEqual([]);
    });
  });

  describe("when cost is aggregated by model and prompt version", () => {
    /** @scenario "Cost by project, model, and prompt version" */
    it("answers the seeded spend for each model and prompt version of the asking project", async () => {
      const body = await ask(
        `SELECT TenantId AS project,
                arrayJoin(Models) AS model,
                LastUsedPromptVersionNumber AS prompt_version,
                round(sum(TotalCost), 6) AS spend
         FROM ${database}.traces
         WHERE ${within("OccurredAt", DAY.cost)}
         GROUP BY project, model, prompt_version
         ORDER BY model, prompt_version`,
      );

      expect(
        body.rows.map((row: any) => [
          row.model,
          Number(row.prompt_version),
          row.spend,
        ]),
      ).toEqual([
        [SECOND_MODEL, 1, 0.1],
        [PRIMARY_MODEL, 1, 0.2],
        [PRIMARY_MODEL, 2, 0.4],
      ]);
      // The project dimension is the tenant itself, and it is the asking one.
      expect(new Set(body.rows.map((row: any) => row.project))).toEqual(
        new Set([asking.id]),
      );
      expect(codes(body)).toEqual([]);
    });

    /**
     * The same question asked for names rather than identifiers, which is what
     * needs the PostgreSQL-resident dimensions: the project's display name and
     * the prompt's, joined through the mapping. The model is already a name on
     * the fact table, so nothing is mapped to resolve it.
     */
    /** @scenario "Cost attributed to dimension names rather than identifiers" */
    it("answers the same spend attributed to project, model, and prompt names", async () => {
      const body = await ask(
        `SELECT p.ProjectName AS project,
                arrayJoin(t.Models) AS model,
                pr.PromptName AS prompt,
                pv.VersionNumber AS prompt_version,
                round(sum(t.TotalCost), 6) AS spend
         FROM ${database}.traces AS t
         INNER JOIN ${database}.projects AS p ON p.TenantId = t.TenantId
         INNER JOIN ${database}.prompts AS pr ON pr.PromptId = t.LastUsedPromptId
         INNER JOIN ${database}.prompt_versions AS pv
                 ON pv.PromptId = pr.PromptId
                AND pv.VersionNumber = t.LastUsedPromptVersionNumber
         WHERE ${within("t.OccurredAt", DAY.cost)}
         GROUP BY project, model, prompt, prompt_version
         ORDER BY model, prompt_version`,
      );

      // The identical numbers the identifier-shaped question above returns,
      // now carrying the names a report would print.
      expect(
        body.rows.map((row: any) => [
          row.project,
          row.model,
          row.prompt,
          Number(row.prompt_version),
          row.spend,
        ]),
      ).toEqual([
        [`Project ${asking.id}`, SECOND_MODEL, `Prompt ${asking.id}`, 1, 0.1],
        [`Project ${asking.id}`, PRIMARY_MODEL, `Prompt ${asking.id}`, 1, 0.2],
        [`Project ${asking.id}`, PRIMARY_MODEL, `Prompt ${asking.id}`, 2, 0.4],
      ]);
      // Diagnostics are deliberately not pinned here. A star-shaped dimension
      // join earns several advisory notes that are all true — each dimension is
      // read without a range on its own time column, and each dimension row is
      // repeated once per fact row — and none of them bears on whether the
      // answer above is right. See the report accompanying this change for the
      // noise this raises on healthy dimension joins.
      expect(
        codes(body).every((code: string) => code !== "RESULT_TRUNCATED"),
      ).toBe(true);
    });
  });

  describe("when token and cost outliers are asked for", () => {
    /** @scenario "Token and cost outliers" */
    it("returns the one seeded trace that costs far more than the median", async () => {
      const window = within("OccurredAt", DAY.outliers);
      const body = await ask(
        `SELECT TraceId,
                round(TotalCost, 4) AS cost,
                TotalPromptTokenCount AS prompt_tokens
         FROM ${database}.traces
         WHERE ${window}
           AND TotalCost > 10 * (
             SELECT quantileExact(0.5)(TotalCost)
             FROM ${database}.traces
             WHERE ${window}
           )
         ORDER BY cost DESC`,
      );

      expect(body.rows).toHaveLength(1);
      expect(body.rows[0]).toMatchObject({
        TraceId: `${asking.id}-outlier-extreme`,
        cost: 5,
      });
      expect(Number(body.rows[0].prompt_tokens)).toBe(50_000);
      expect(codes(body)).toEqual([]);
    });
  });

  describe("when evaluation score distributions and pass rates are asked for", () => {
    /** @scenario "Evaluation score distributions and pass rates by model and prompt version" */
    it("answers the seeded pass rate and mean score for each model and prompt version", async () => {
      // The pass rate is written as a ratio of two counts rather than with an
      // If-suffixed average: an aggregate's If suffix refuses a nullable
      // condition, and an evaluation that produced no verdict has none.
      const body = await ask(
        `SELECT arrayJoin(t.Models) AS model,
                t.LastUsedPromptVersionNumber AS prompt_version,
                count() AS evaluations,
                round(avg(e.Score), 4) AS mean_score,
                round(countIf(ifNull(e.Passed, 0) = 1) / count(), 4) AS pass_rate
         FROM ${database}.evaluations AS e
         INNER JOIN ${database}.traces AS t ON t.TraceId = e.TraceId
         WHERE ${within("e.ScheduledAt", DAY.evaluations)}
           AND ${within("t.OccurredAt", DAY.evaluations)}
         GROUP BY model, prompt_version
         ORDER BY model`,
      );

      expect(
        body.rows.map((row: any) => [
          row.model,
          Number(row.evaluations),
          row.mean_score,
          row.pass_rate,
        ]),
      ).toEqual([
        [SECOND_MODEL, 3, 0.4, 0.3333],
        [PRIMARY_MODEL, 3, 0.6333, 0.6667],
      ]);

      // Advisory, and correct: a trace can carry several evaluations, so a
      // *trace* measure aggregated here would be counted once per evaluation.
      // The evaluation measures asserted above are the fine grain and are not
      // multiplied — which is exactly the judgement the diagnostic leaves to
      // the reader rather than making itself.
      expect(codes(body)).toEqual(["POSSIBLE_FANOUT"]);
      expect(diagnostic(body, "POSSIBLE_FANOUT").meta).toMatchObject({
        dataset: `${database}.traces`,
        multipliedBy: `${database}.evaluations`,
      });
    });
  });

  describe("when traces containing one operation before another are asked for", () => {
    /** @scenario "Traces containing operation A then operation B" */
    it("returns only the trace whose retrieval preceded its generation", async () => {
      const body = await ask(
        `SELECT TraceId
         FROM ${database}.spans
         WHERE ${within("StartTime", DAY.spanOrder)}
         GROUP BY TraceId
         HAVING countIf(SpanName = 'retrieve') > 0
            AND countIf(SpanName = 'generate') > 0
            AND minIf(StartTime, SpanName = 'retrieve') < minIf(StartTime, SpanName = 'generate')
         ORDER BY TraceId`,
      );

      expect(body.rows.map((row: any) => row.TraceId)).toEqual([
        `${asking.id}-order-ab`,
      ]);
      expect(codes(body)).toEqual([]);
    });
  });

  describe("when the elapsed time between two events in a trace is asked for", () => {
    /** @scenario "Time between two events in a trace" */
    it("answers the seeded five seconds, and its negative for the reversed trace", async () => {
      const body = await ask(
        `SELECT TraceId,
                dateDiff('second',
                  minIf(StartTime, SpanName = 'retrieve'),
                  minIf(StartTime, SpanName = 'generate')
                ) AS retrieval_to_generation_seconds
         FROM ${database}.spans
         WHERE ${within("StartTime", DAY.spanOrder)}
         GROUP BY TraceId
         HAVING countIf(SpanName = 'retrieve') > 0
            AND countIf(SpanName = 'generate') > 0
         ORDER BY TraceId`,
      );

      expect(
        body.rows.map((row: any) => [
          row.TraceId,
          Number(row.retrieval_to_generation_seconds),
        ]),
      ).toEqual([
        [`${asking.id}-order-ab`, 5],
        [`${asking.id}-order-ba`, -5],
      ]);
      expect(codes(body)).toEqual([]);
    });
  });

  describe("when the first failure and first retry per trace are asked for", () => {
    /** @scenario "First failure and first retry per trace" */
    it("names the earliest failing operation and the retry that followed it", async () => {
      const body = await ask(
        `SELECT TraceId,
                argMinIf(SpanName, StartTime, ifNull(StatusCode, 0) = 2) AS first_failure,
                minIf(StartTime, ifNull(StatusCode, 0) = 2) AS first_failure_at,
                argMinIf(SpanName, StartTime, SpanName = 'http.retry') AS first_retry,
                minIf(StartTime, SpanName = 'http.retry') AS first_retry_at
         FROM ${database}.spans
         WHERE ${within("StartTime", DAY.retries)}
         GROUP BY TraceId
         ORDER BY TraceId`,
      );

      expect(
        body.rows.map((row: any) => [
          row.TraceId,
          row.first_failure,
          row.first_failure_at,
          row.first_retry,
          row.first_retry_at,
        ]),
      ).toEqual([
        [
          `${asking.id}-retry-1`,
          "http.call",
          at(DAY.retries, 12, 1),
          "http.retry",
          at(DAY.retries, 12, 3),
        ],
        [
          `${asking.id}-retry-2`,
          "http.call",
          at(DAY.retries, 12, 10),
          "http.retry",
          at(DAY.retries, 12, 20),
        ],
      ]);
      expect(codes(body)).toEqual([]);
    });
  });

  describe("when metrics are compared across runs", () => {
    /**
     * Simulation batches are the run grouping ClickHouse holds. The
     * experiment-shaped comparison, by an experiment's name, is the case below.
     */
    /** @scenario "Run comparisons across simulation batches" */
    it("answers the seeded success rate and mean duration for each batch", async () => {
      const body = await ask(
        `SELECT BatchRunId AS batch,
                count() AS runs,
                round(countIf(ifNull(Verdict, '') = 'success') / count(), 4) AS success_rate,
                round(avg(DurationMs), 1) AS mean_duration_ms
         FROM ${database}.simulations
         WHERE ${within("StartedAt", DAY.experiments)}
         GROUP BY batch
         ORDER BY batch`,
      );

      expect(
        body.rows.map((row: any) => [
          row.batch,
          Number(row.runs),
          row.success_rate,
          row.mean_duration_ms,
        ]),
      ).toEqual([
        ["batch-1", 2, 0.5, 1500],
        ["batch-2", 2, 1, 600],
      ]);
      expect(codes(body)).toEqual([]);
    });

    /**
     * The experiment-shaped comparison: runs joined to the experiment that
     * names them, both PostgreSQL-resident and reached through the mapping.
     */
    /** @scenario "Experiment run comparisons" */
    it("compares each run's score against the others under the experiment's name", async () => {
      const body = await ask(
        `SELECT e.ExperimentName AS experiment,
                r.ExperimentRunId AS run,
                r.Score AS score,
                r.Passed AS passed,
                round(r.Score - avg(r.Score) OVER (PARTITION BY e.ExperimentId), 4) AS score_vs_experiment_mean
         FROM ${database}.experiment_runs AS r
         INNER JOIN ${database}.experiments AS e ON e.ExperimentId = r.ExperimentId
         ORDER BY run`,
      );

      const [lower, higher] = EXPERIMENT_RUN_SCORES;
      const mean = (lower! + higher!) / 2;
      expect(
        body.rows.map((row: any) => [
          row.experiment,
          Number(row.score),
          Boolean(row.passed),
          Number(row.score_vs_experiment_mean),
        ]),
      ).toEqual([
        [
          `Experiment ${asking.id}`,
          lower,
          false,
          Number((lower! - mean).toFixed(4)),
        ],
        [
          `Experiment ${asking.id}`,
          higher,
          true,
          Number((higher! - mean).toFixed(4)),
        ],
      ]);
      // The other tenant's experiment and runs exist and contributed nothing.
      expect(
        body.rows.every((row: any) => !String(row.run).startsWith(other.id)),
      ).toBe(true);

      // The grain the PostgreSQL-resident entries declare reaches the
      // diagnostics engine: an experiment row really is repeated once per run,
      // and the fanout rule says so without anything being written for it.
      const fanout = diagnostic(body, "POSSIBLE_FANOUT");
      expect(fanout, JSON.stringify(codes(body))).toBeDefined();
      expect(fanout.meta.dataset).toBe(`${database}.experiments`);
      expect(fanout.meta.multipliedBy).toBe(`${database}.experiment_runs`);
      expect(fanout.meta.unmatchedGrainColumns).toEqual(["ExperimentRunId"]);
    });
  });

  describe("when human annotations are compared against evaluator verdicts", () => {
    /** @scenario "Annotation-versus-evaluation agreement" */
    it("answers how often the human thumbs matched the evaluator's pass", async () => {
      const body = await ask(
        `SELECT count() AS compared,
                countIf(a.IsThumbsUp = e.Passed) AS agreed,
                round(countIf(a.IsThumbsUp = e.Passed) / count(), 4) AS agreement_rate
         FROM ${database}.annotations AS a
         INNER JOIN ${database}.evaluations AS e ON e.TraceId = a.TraceId
         WHERE ${within("e.ScheduledAt", DAY.evaluations)}`,
      );

      const [row] = body.rows;
      expect(
        Number(row.compared),
        "no annotation joined an evaluation — the agreement rate below would be over nothing",
      ).toBe(annotatedTraceIds(asking.id).length);
      expect(Number(row.agreed)).toBe(EXPECTED_AGREEMENTS);
      expect(Number(row.agreement_rate)).toBe(
        Number(
          (EXPECTED_AGREEMENTS / annotatedTraceIds(asking.id).length).toFixed(
            4,
          ),
        ),
      );
    });

    /**
     * The isolation half, stated separately because the aggregate above would
     * have the same shape if the other tenant's annotations had joined in.
     */
    /** @scenario "Annotation-versus-evaluation agreement" */
    it("counts only the asking tenant's annotations", async () => {
      const foreign = await postgres.asAdmin(
        `SELECT count(*) FROM public."Annotation" WHERE "projectId" = '${other.id}'`,
      );
      expect(
        Number(foreign.stdout.trim()),
        "the other tenant has no annotations — the isolation claim below is vacuous",
      ).toBeGreaterThan(0);

      const body = await ask(
        `SELECT DISTINCT TenantId FROM ${database}.annotations`,
      );
      expect(body.rows.map((row: any) => row.TenantId)).toEqual([asking.id]);
    });
  });

  describe("when a trace-grain aggregate is taken after joining spans", () => {
    /** @scenario "Fanout warning on a trace-to-span join" */
    it("carries a fanout diagnostic naming the repeated dataset, and the numbers show it was right", async () => {
      const body = await ask(
        `SELECT t.TraceId AS trace,
                sum(t.TotalDurationMs) AS summed_trace_duration_ms,
                count() AS joined_rows
         FROM ${database}.traces AS t
         INNER JOIN ${database}.spans AS s ON s.TraceId = t.TraceId
         WHERE ${within("t.OccurredAt", DAY.spanOrder)}
           AND ${within("s.StartTime", DAY.spanOrder)}
         GROUP BY trace
         ORDER BY trace`,
      );

      const fanout = diagnostic(body, "POSSIBLE_FANOUT");
      expect(codes(body)).toEqual(["POSSIBLE_FANOUT"]);
      expect(fanout.meta).toMatchObject({
        dataset: `${database}.traces`,
        multipliedBy: `${database}.spans`,
        unmatchedGrainColumns: ["SpanId"],
        aggregated: true,
      });
      expect(fanout.meta.affectedColumns).toContain("TotalDurationMs");
      expect(fanout.message).toContain("SpanId");

      // The evidence the diagnostic is not crying wolf: every seeded trace is
      // 1000 ms, and the join multiplies that by its span count.
      expect(
        body.rows.map((row: any) => [
          row.trace,
          Number(row.summed_trace_duration_ms),
          Number(row.joined_rows),
        ]),
      ).toEqual([
        [`${asking.id}-order-a`, 1000, 1],
        [`${asking.id}-order-ab`, 2000, 2],
        [`${asking.id}-order-ba`, 2000, 2],
      ]);
    });
  });

  describe("when a time-bucketed answer has an empty bucket inside its range", () => {
    /** @scenario "Missing time buckets diagnostic fires" */
    it("says how many buckets are missing and where the gap is", async () => {
      const body = await ask(
        `SELECT toStartOfHour(OccurredAt) AS bucket, count() AS traces
         FROM ${database}.traces
         WHERE ${within("OccurredAt", DAY.missingBuckets)}
         GROUP BY bucket
         ORDER BY bucket`,
      );

      expect(body.rows.map((row: any) => Number(row.traces))).toEqual([
        1, 1, 1,
      ]);
      expect(codes(body)).toEqual(["MISSING_TIME_BUCKETS"]);
      expect(diagnostic(body, "MISSING_TIME_BUCKETS").meta).toMatchObject({
        timeColumn: "bucket",
        missingBucketCount: 1,
        gapsAfter: [`${DAY.missingBuckets}T01:00:00.000Z`],
      });
    });

    it("says nothing about the same shape over a range with no gap in it", async () => {
      const body = await ask(
        `SELECT toStartOfFifteenMinutes(OccurredAt) AS bucket, count() AS traces
         FROM ${database}.traces
         WHERE ${within("OccurredAt", DAY.rolling)}
         GROUP BY bucket
         ORDER BY bucket`,
      );

      // Four contiguous buckets, so the rule has a series to find holes in and
      // finds none — the control is not passing for want of an axis.
      expect(body.rows).toHaveLength(4);
      expect(codes(body)).toEqual([]);
    });
  });

  describe("when the newest period of a comparison has not finished", () => {
    /** @scenario "Incomplete or misaligned comparison period diagnostic fires" */
    it("reports the comparison as unequal while that period is still filling", async () => {
      const sql = `SELECT toStartOfHour(OccurredAt) AS bucket, count() AS traces
         FROM ${database}.traces
         WHERE ${within("OccurredAt", DAY.unfinishedPeriod)}
         GROUP BY bucket
         ORDER BY bucket`;

      // Half an hour into the newest seeded bucket. Injected rather than waited
      // for: the claim is about the relationship between the result and the
      // instant, and a wall clock would make it true only once.
      setGovernedSqlService(
        new GovernedSqlService({
          executor: createGovernedSqlExecutor({
            ...harness.restrictedConnection(),
            database,
            tenantSetting: harness.names.tenantSetting,
          }),
          database,
          now: () => new Date(`${DAY.unfinishedPeriod}T12:30:00Z`),
        }),
      );
      try {
        const body = await ask(sql);

        expect(body.rows).toHaveLength(3);
        expect(codes(body)).toEqual(["INCOMPLETE_COMPARISON_PERIOD"]);
        expect(
          diagnostic(body, "INCOMPLETE_COMPARISON_PERIOD").meta,
        ).toMatchObject({
          reason: "unfinished_newest_period",
          newestPeriodStart: `${DAY.unfinishedPeriod}T12:00:00.000Z`,
        });
      } finally {
        setGovernedSqlService(shippedService());
      }

      // The same query once that period has closed: the seed and the SQL are
      // unchanged, so the diagnostic is about the instant and nothing else.
      expect(codes(await ask(sql))).toEqual([]);
    });
  });

  describe("when a dataset is read with no condition on its time column", () => {
    /** @scenario "An unbounded read is reported as covering the whole history" */
    it("answers, says the read covered the whole history, and stays quiet once it is bounded", async () => {
      const body = await ask(`SELECT count() AS value FROM ${database}.traces`);

      expect(Number(body.rows[0].value)).toBeGreaterThan(0);
      expect(codes(body)).toEqual(["UNBOUNDED_TIME_RANGE"]);
      expect(diagnostic(body, "UNBOUNDED_TIME_RANGE").meta).toEqual({
        dataset: `${database}.traces`,
        timeColumn: "OccurredAt",
      });

      // The same question with the condition the diagnostic asked for.
      const bounded = await ask(
        `SELECT count() AS value FROM ${database}.traces ` +
          `WHERE ${within("OccurredAt", DAY.latency)}`,
      );
      expect(Number(bounded.rows[0].value)).toBeGreaterThan(0);
      expect(codes(bounded)).toEqual([]);
    });
  });
});
