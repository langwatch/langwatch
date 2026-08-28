/**
 * Mass seed: months of coherent, backdated activity across the platform,
 * through production write paths only.
 *
 * Event-sourced products (scenario simulations, evaluations, experiment runs)
 * are seeded as real commands with backdated occurredAt — the substrate
 * honours it verbatim, the events land in old event-log partitions, and the
 * running worker's projections build the read models exactly as production
 * does. Read models are never written directly.
 *
 * Traces cover the whole window too: the last month ingests through the real
 * /api/collector, and older traces are dispatched as recordSpan pipeline
 * commands with backdated occurredAt — the same seam every other backdated
 * product uses — so the collector's public 31-day age guard stays intact.
 * Metric series go through the real /api/otel/v1/metrics endpoint for the
 * whole window (metrics have no ingest-age guard).
 *
 * Backdated rows are stamped with a retention horizon relative to their DATA
 * time (the dev default is 7 days), so the seeder first upserts an org-scoped
 * RetentionPolicy that outlives the window — otherwise months two and three
 * would be written pre-expired.
 *
 * HAVEN_SEED_MONTHS tunes the window (default 3). Deterministic and
 * idempotent: same window → same ids → re-running upserts the same story.
 */

import { DEMO_PLATFORM_IDS } from "../prisma/demo-platform-ids";
import { seedDemoPlatform } from "../prisma/seed-demo-platform";
import { PrismaClient } from "@langwatch/prisma-client/generated";
import { resetApp } from "../src/server/app-layer/app";
import { initializeDefaultApp } from "../src/server/app-layer/presets";
import { getClickHouseClientForTenant } from "../src/server/clickhouse/clickhouseClient";
import { DEFAULT_PII_REDACTION_LEVEL } from "@langwatch/trace-contract";
import { createPrismaPgAdapter } from "../src/server/prismaPgAdapter";
import { getSuiteSetId } from "@langwatch/suite-contract";
import {
  type CustomMetadata,
  customMetadataSchema,
  type ReservedTraceMetadata,
  reservedTraceMetadataSchema,
  spanValidatorSchema,
} from "@langwatch/trace-contract";
import { CollectorSpanUtils } from "../src/server/traces/collectorSpan.utils";
import { buildMassMetrics, MASS_METRICS_SCOPE } from "./seed-lib/mass-metrics";
import { buildMassTimeline, type MassTimeline } from "./seed-lib/mass-timeline";
import { EXPERIMENT_ROWS, SCENARIO_FIXTURES } from "./seed-lib/platform-fixtures";
import { applySeedRetention, seededRetentionDays } from "./seed-lib/retention";
import {
  assertLocalUrl,
  buildCollectorPayload,
  type CollectorTarget,
  DAY_MS,
  ingestOtlpMetrics,
  ingestTrace,
  TRACE_WINDOW_DAYS,
  type TraceFixture,
} from "./seed-lib/seed-primitives";

const PROJECT_ID = "local-dev-project";
const USER_ID = "local-dev-admin-user";
const ORG_ID = "local-dev-organization";
const target: CollectorTarget = {
  endpoint: process.env.HAVEN_SEED_ENDPOINT ?? "http://localhost:5560",
  apiKey: process.env.HAVEN_SEED_LANGWATCH_API_KEY ?? "sk-lw-local-development-key",
};
const MONTHS = Math.max(1, Number(process.env.HAVEN_SEED_MONTHS ?? 3) || 3);

assertLocalUrl("HAVEN_SEED_ENDPOINT", target.endpoint);
assertLocalUrl("DATABASE_URL", process.env.DATABASE_URL);
assertLocalUrl("CLICKHOUSE_URL", process.env.CLICKHOUSE_URL);

/**
 * Dispatch one trace's spans as recordSpan pipeline commands with backdated
 * occurredAt — the seam for traces older than the collector's public ingest
 * window. Runs the same validation, conversion, and resource building the
 * REST collector route runs, then enqueues through the production producer.
 */
async function dispatchDeepTrace({
  app,
  trace,
}: {
  app: ReturnType<typeof initializeDefaultApp>;
  trace: TraceFixture;
}): Promise<void> {
  const payload = buildCollectorPayload({
    trace,
    fallbackFinishedAt: trace.finishedAtMs ?? Date.now(),
  });
  const reservedTraceMetadata: ReservedTraceMetadata = Object.fromEntries(
    Object.entries(reservedTraceMetadataSchema.parse(payload.metadata)).filter(
      ([, value]) => value !== null && value !== undefined,
    ),
  );
  const remainingMetadata = Object.fromEntries(
    Object.entries(payload.metadata).filter(([key]) => !(key in reservedTraceMetadataSchema.shape)),
  );
  const customMetadata: CustomMetadata = customMetadataSchema.parse(remainingMetadata);
  const resource = CollectorSpanUtils.buildResource({
    reservedTraceMetadata,
    customMetadata,
  });
  for (const rawSpan of payload.spans) {
    const span = spanValidatorSchema.parse(rawSpan);
    await app.traces.recordSpan({
      tenantId: PROJECT_ID,
      span: CollectorSpanUtils.convertSpanToOtlp(span),
      resource,
      instrumentationScope: { name: MASS_METRICS_SCOPE },
      piiRedactionLevel: DEFAULT_PII_REDACTION_LEVEL,
      occurredAt: span.timestamps.started_at,
    });
  }
}

async function dispatchTimeline({
  app,
  timeline,
}: {
  app: ReturnType<typeof initializeDefaultApp>;
  timeline: MassTimeline;
}): Promise<void> {
  // Dispatch only — Haven's running worker consumes the queue and projects.
  const suiteSetId = getSuiteSetId(DEMO_PLATFORM_IDS.suite);

  for (const run of timeline.scenarioRuns) {
    const scenario = SCENARIO_FIXTURES[run.scenarioIndex]!;
    const variant = run.passed ? "improved" : "baseline";
    await app.simulations.startRun({
      tenantId: PROJECT_ID,
      occurredAt: run.startedAt,
      scenarioRunId: run.runId,
      scenarioId: scenario.scenarioId,
      batchRunId: run.batchRunId,
      scenarioSetId: suiteSetId,
      name: scenario.name,
      description: "Support Regression Suite — scheduled history",
      metadata: {
        suiteId: DEMO_PLATFORM_IDS.suite,
        variant,
        model: run.passed ? "gpt-5-mini" : "gpt-4.1-mini",
      },
    });
    await app.simulations.messageSnapshot({
      tenantId: PROJECT_ID,
      occurredAt: run.startedAt + 1_000,
      scenarioRunId: run.runId,
      messages: [
        { id: `${run.runId}-user`, role: "user", content: scenario.user },
        {
          id: `${run.runId}-assistant`,
          role: "assistant",
          content: scenario[variant],
          trace_id: run.trace.traceId,
        },
      ],
      traceIds: [run.trace.traceId],
      status: "IN_PROGRESS",
    });
    await app.simulations.finishRun({
      tenantId: PROJECT_ID,
      occurredAt: run.startedAt + run.latencyMs,
      scenarioRunId: run.runId,
      durationMs: run.latencyMs,
      status: run.passed ? "SUCCESS" : "FAILURE",
      results: {
        verdict: run.passed ? "success" : "failure",
        reasoning: run.passed
          ? "The response stayed within policy and supplied a safe next step."
          : "The response made an unsupported promise or invented a fact.",
        metCriteria: run.passed ? [...scenario.criteria] : [scenario.criteria[0]],
        unmetCriteria: run.passed ? [] : scenario.criteria.slice(1),
      },
    });
    await app.evaluations.reportEvaluation({
      tenantId: PROJECT_ID,
      occurredAt: run.startedAt + run.latencyMs + 500,
      evaluationId: `mass-eval-${run.runId}`,
      evaluatorId:
        run.scenarioIndex === 1
          ? DEMO_PLATFORM_IDS.evaluators.groundedness
          : DEMO_PLATFORM_IDS.evaluators.quality,
      evaluatorType: run.scenarioIndex === 1 ? "ragas/faithfulness" : "langevals/llm_score",
      evaluatorName:
        run.scenarioIndex === 1 ? "Documentation Groundedness" : "Support Answer Quality",
      traceId: run.trace.traceId,
      status: "processed",
      score: run.score,
      passed: run.passed,
      label: run.passed ? "acceptable" : "needs work",
      details: `Scheduled history evaluation scored ${Math.round(run.score * 100)}%.`,
    });
  }

  for (const exp of timeline.experimentRuns) {
    await app.experimentRuns.startExperimentRun({
      tenantId: PROJECT_ID,
      occurredAt: exp.startedAt,
      runId: exp.runId,
      experimentId: DEMO_PLATFORM_IDS.experiment,
      total: EXPERIMENT_ROWS.length,
      targets: [
        {
          id: "demo-target-support-agent",
          name: "Support Copilot",
          type: "agent",
          agentId: DEMO_PLATFORM_IDS.agents.support,
          model: exp.variant === "baseline" ? "gpt-4.1-mini" : "gpt-5-mini",
          metadata: { release: exp.variant },
        },
      ],
    });
    for (const [index, row] of EXPERIMENT_ROWS.entries()) {
      const occurredAt = exp.startedAt + (index + 1) * 60_000;
      await app.experimentRuns.recordTargetResult({
        tenantId: PROJECT_ID,
        occurredAt,
        runId: exp.runId,
        experimentId: DEMO_PLATFORM_IDS.experiment,
        index,
        targetId: "demo-target-support-agent",
        entry: { input: row.input, expected_output: row.expected },
        predicted: { output: exp.outputs[index]! },
        cost: 0.003,
        duration: 1_400 + index * 120,
      });
      const score = exp.scores[index]!;
      await app.experimentRuns.recordEvaluatorResult({
        tenantId: PROJECT_ID,
        occurredAt: occurredAt + 500,
        runId: exp.runId,
        experimentId: DEMO_PLATFORM_IDS.experiment,
        index,
        targetId: "demo-target-support-agent",
        evaluatorId: DEMO_PLATFORM_IDS.evaluators.quality,
        evaluatorName: "Support Answer Quality",
        status: "processed",
        score,
        passed: score >= 0.7,
        label: score >= 0.85 ? "excellent" : score >= 0.7 ? "acceptable" : "needs work",
        details: `Weekly regression scored ${Math.round(score * 100)}%.`,
        duration: 420 + index * 35,
        cost: 0.0008,
      });
    }
    await app.experimentRuns.completeExperimentRun({
      tenantId: PROJECT_ID,
      occurredAt: exp.startedAt + 9 * 60_000,
      runId: exp.runId,
      experimentId: DEMO_PLATFORM_IDS.experiment,
      finishedAt: exp.startedAt + 9 * 60_000,
    });
  }
}

interface ProjectionCounts {
  simulations: number;
  evaluations: number;
  experimentRuns: number;
  traces: number;
  metricPoints: number;
}

/** The seeded window, so every count can prune to the partitions it wrote. */
interface SeedWindow {
  fromMs: number;
  toMs: number;
}

/**
 * Counts the rows the seed expects to see projected. Each subquery carries the
 * seeded window on its table's own partition key, so the poll prunes to the
 * weeks the seed actually wrote instead of scanning every partition (including
 * cold ones on S3) — this runs every 2s for up to ten minutes.
 */
async function projectionCounts(window: SeedWindow): Promise<ProjectionCounts> {
  const client = await getClickHouseClientForTenant(PROJECT_ID);
  if (!client) throw new Error("ClickHouse client is unavailable");
  const result = await client.query({
    query: `
      SELECT
        (SELECT uniqExact(ScenarioRunId) FROM simulation_runs WHERE TenantId = {tenantId:String} AND StartedAt BETWEEN {from:DateTime64(3)} AND {to:DateTime64(3)} AND ScenarioRunId LIKE 'mass-scenario-%') AS simulations,
        (SELECT uniqExact(EvaluationId) FROM evaluation_runs WHERE TenantId = {tenantId:String} AND ScheduledAt BETWEEN {from:DateTime64(3)} AND {to:DateTime64(3)} AND EvaluationId LIKE 'mass-eval-%') AS evaluations,
        (SELECT uniqExact(RunId) FROM experiment_runs WHERE TenantId = {tenantId:String} AND StartedAt BETWEEN {from:DateTime64(3)} AND {to:DateTime64(3)} AND RunId LIKE 'mass-exp-%') AS experimentRuns,
        (SELECT uniqExact(TraceId) FROM trace_summaries WHERE TenantId = {tenantId:String} AND OccurredAt BETWEEN {from:DateTime64(3)} AND {to:DateTime64(3)} AND (TraceId LIKE 'mass-trace-%' OR TraceId LIKE 'mass-organic-%')) AS traces,
        (SELECT uniqExact(PointId) FROM metric_data_points WHERE TenantId = {tenantId:String} AND TimeUnixMs BETWEEN {from:DateTime64(3)} AND {to:DateTime64(3)} AND ScopeName = {scopeName:String}) AS metricPoints
    `,
    query_params: {
      tenantId: PROJECT_ID,
      scopeName: MASS_METRICS_SCOPE,
      from: window.fromMs,
      to: window.toMs,
    },
    format: "JSONEachRow",
  });
  const [row] = await result.json<Record<keyof ProjectionCounts, string | number>>();
  if (!row) throw new Error("Projection count query returned no row");
  return {
    simulations: Number(row.simulations),
    evaluations: Number(row.evaluations),
    experimentRuns: Number(row.experimentRuns),
    traces: Number(row.traces),
    metricPoints: Number(row.metricPoints),
  };
}

async function waitForProjections({
  expected,
  window,
}: {
  expected: ProjectionCounts;
  window: SeedWindow;
}): Promise<ProjectionCounts> {
  // Months of history is a lot of projection work for one worker; be patient.
  const deadline = Date.now() + 600_000;
  const ready = (counts: ProjectionCounts) =>
    counts.simulations >= expected.simulations &&
    counts.evaluations >= expected.evaluations &&
    counts.experimentRuns >= expected.experimentRuns &&
    counts.traces >= expected.traces &&
    counts.metricPoints >= expected.metricPoints;
  let counts = await projectionCounts(window);
  while (!ready(counts) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    counts = await projectionCounts(window);
  }
  if (!ready(counts)) {
    throw new Error(
      `Timed out waiting for mass projections: got ${JSON.stringify(counts)}, want at least ${JSON.stringify(expected)}`,
    );
  }
  return counts;
}

/** The demo platform content, bound to the static local-dev identity. */
const seedDemoContent = (prisma: PrismaClient) =>
  seedDemoPlatform({
    prisma,
    projectId: PROJECT_ID,
    organizationId: ORG_ID,
    userId: USER_ID,
  });

async function main(): Promise<void> {
  const prisma = new PrismaClient({
    adapter: createPrismaPgAdapter(process.env.DATABASE_URL ?? ""),
  });
  try {
    await seedDemoContent(prisma);
    const now = Date.now();
    const timeline = buildMassTimeline({ months: MONTHS, now });
    const metrics = buildMassMetrics({ months: MONTHS, now });
    // haven runs seed:retention first, but keep this so a direct `pnpm seed:mass`
    // still pins a horizon that outlives the backdated window (idempotent — a
    // no-op, no wait, when the step already set it).
    await applySeedRetention({
      prisma,
      organizationId: ORG_ID,
      retentionDays: seededRetentionDays(timeline.days),
      shouldWaitForCacheRollover: true,
      log: (message) => console.log(`   ${message}`),
    });

    const traces = [...timeline.scenarioRuns.map((run) => run.trace), ...timeline.organicTraces];
    // A day of margin under the collector's 31-day guard: everything at least
    // that fresh goes through the real collector, the rest rides the pipeline
    // command seam with backdated occurredAt.
    const collectorCutoff = now - TRACE_WINDOW_DAYS * DAY_MS;
    const windowed = traces.filter(
      (trace) => (trace.finishedAtMs ?? now) - trace.latencyMs >= collectorCutoff,
    );
    const deep = traces.filter(
      (trace) => (trace.finishedAtMs ?? now) - trace.latencyMs < collectorCutoff,
    );
    console.log(
      `🌱 Mass seed: ${timeline.days} days — ${timeline.scenarioRuns.length} scenario runs, ${timeline.experimentRuns.length} experiment runs, ${traces.length} traces (${windowed.length} via collector, ${deep.length} via pipeline), ${metrics.totalPoints} metric points`,
    );

    for (const trace of windowed) {
      await ingestTrace({ target, trace, fallbackFinishedAt: now });
    }
    console.log(`   recent traces ingested through ${target.endpoint}`);
    for (const batch of metrics.batches) {
      await ingestOtlpMetrics({ target, request: batch.request });
    }
    console.log(`   ${metrics.totalPoints} metric points ingested through /api/otel/v1/metrics`);

    const app = initializeDefaultApp({ processRole: "web" });
    for (const trace of deep) {
      await dispatchDeepTrace({ app, trace });
    }
    console.log("   deep trace history dispatched as pipeline commands");
    await dispatchTimeline({ app, timeline });
    console.log("   lifecycles dispatched — waiting for projections…");
    const counts = await waitForProjections({
      expected: {
        simulations: timeline.scenarioRuns.length,
        evaluations: timeline.scenarioRuns.length,
        experimentRuns: timeline.experimentRuns.length,
        traces: traces.length,
        metricPoints: metrics.totalPoints,
      },
      // A day of slack each side: lifecycles stamp a few hours past their run.
      window: { fromMs: timeline.firstDayStart - DAY_MS, toMs: now + DAY_MS },
    });
    console.log(
      `✅ Mass projections ready: ${counts.simulations} scenario runs, ${counts.evaluations} evaluations, ${counts.experimentRuns} experiment runs, ${counts.traces} traces, ${counts.metricPoints} metric points`,
    );
  } finally {
    await prisma.$disconnect();
    // Bounded cleanup, same rationale as the realistic seeder: a successful
    // one-shot seed must not hold Haven open on queue-producer shutdown.
    await Promise.race([resetApp(), new Promise<void>((resolve) => setTimeout(resolve, 2_000))]);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
