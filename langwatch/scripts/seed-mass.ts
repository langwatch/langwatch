/**
 * Mass seed: months of coherent, backdated activity across the platform,
 * through production write paths only.
 *
 * Event-sourced products (scenario simulations, evaluations, experiment runs)
 * are seeded as real commands with backdated occurredAt — the substrate
 * honours it verbatim, the events land in old event-log partitions, and the
 * running worker's projections build the read models exactly as production
 * does. Read models are never written directly. Traces ingest through
 * /api/collector inside its 31-day window (older spans are refused by design;
 * the deep history lives in the event-sourced products).
 *
 * HAVEN_SEED_MONTHS tunes the window (default 3). Deterministic and
 * idempotent: same window → same ids → re-running upserts the same story.
 */
import { PrismaClient } from "@prisma/client";
import { resetApp } from "../src/server/app-layer/app";
import { initializeDefaultApp } from "../src/server/app-layer/presets";
import { getClickHouseClientForProject } from "../src/server/clickhouse/clickhouseClient";
import { getSuiteSetId } from "../src/server/suites/suite-set-id";
import { seedDemoPlatform } from "../prisma/seed-demo-platform";
import { DEMO_PLATFORM_IDS } from "../prisma/demo-platform-ids";
import {
  assertLocalUrl,
  ingestTrace,
  type CollectorTarget,
} from "./seed-lib/seed-primitives";
import {
  EXPERIMENT_ROWS,
  SCENARIO_FIXTURES,
} from "./seed-lib/platform-fixtures";
import {
  buildMassTimeline,
  type MassTimeline,
} from "./seed-lib/mass-timeline";

const PROJECT_ID = "local-dev-project";
const USER_ID = "local-dev-admin-user";
const target: CollectorTarget = {
  endpoint: process.env.HAVEN_SEED_ENDPOINT ?? "http://localhost:5560",
  apiKey:
    process.env.HAVEN_SEED_LANGWATCH_API_KEY ?? "sk-lw-local-development-key",
};
const MONTHS = Math.max(1, Number(process.env.HAVEN_SEED_MONTHS ?? 3) || 3);

assertLocalUrl("HAVEN_SEED_ENDPOINT", target.endpoint);
assertLocalUrl("DATABASE_URL", process.env.DATABASE_URL);
assertLocalUrl("CLICKHOUSE_URL", process.env.CLICKHOUSE_URL);

async function dispatchTimeline(timeline: MassTimeline): Promise<void> {
  // Dispatch only — Haven's running worker consumes the queue and projects.
  const app = initializeDefaultApp({ processRole: "web" });
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
          ...(run.trace ? { trace_id: run.trace.traceId } : {}),
        },
      ],
      traceIds: run.trace ? [run.trace.traceId] : [],
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
        metCriteria: run.passed
          ? [...scenario.criteria]
          : [scenario.criteria[0]],
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
      evaluatorType:
        run.scenarioIndex === 1 ? "ragas/faithfulness" : "langevals/llm_score",
      evaluatorName:
        run.scenarioIndex === 1
          ? "Documentation Groundedness"
          : "Support Answer Quality",
      ...(run.trace ? { traceId: run.trace.traceId } : {}),
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
        label:
          score >= 0.85
            ? "excellent"
            : score >= 0.7
              ? "acceptable"
              : "needs work",
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
}

async function projectionCounts(): Promise<ProjectionCounts> {
  const client = await getClickHouseClientForProject(PROJECT_ID);
  if (!client) throw new Error("ClickHouse client is unavailable");
  const result = await client.query({
    query: `
      SELECT
        (SELECT uniqExact(ScenarioRunId) FROM simulation_runs WHERE TenantId = {tenantId:String} AND ScenarioRunId LIKE 'mass-scenario-%') AS simulations,
        (SELECT uniqExact(EvaluationId) FROM evaluation_runs WHERE TenantId = {tenantId:String} AND EvaluationId LIKE 'mass-eval-%') AS evaluations,
        (SELECT uniqExact(RunId) FROM experiment_runs WHERE TenantId = {tenantId:String} AND RunId LIKE 'mass-exp-%') AS experimentRuns,
        (SELECT uniqExact(TraceId) FROM trace_summaries WHERE TenantId = {tenantId:String} AND (TraceId LIKE 'mass-trace-%' OR TraceId LIKE 'mass-organic-%')) AS traces
    `,
    query_params: { tenantId: PROJECT_ID },
    format: "JSONEachRow",
  });
  const [row] =
    await result.json<Record<keyof ProjectionCounts, string | number>>();
  if (!row) throw new Error("Projection count query returned no row");
  return {
    simulations: Number(row.simulations),
    evaluations: Number(row.evaluations),
    experimentRuns: Number(row.experimentRuns),
    traces: Number(row.traces),
  };
}

async function waitForProjections(expected: ProjectionCounts): Promise<ProjectionCounts> {
  const deadline = Date.now() + 180_000;
  const ready = (counts: ProjectionCounts) =>
    counts.simulations >= expected.simulations &&
    counts.evaluations >= expected.evaluations &&
    counts.experimentRuns >= expected.experimentRuns &&
    counts.traces >= expected.traces;
  let counts = await projectionCounts();
  while (!ready(counts) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    counts = await projectionCounts();
  }
  if (!ready(counts)) {
    throw new Error(
      `Timed out waiting for mass projections: got ${JSON.stringify(counts)}, want at least ${JSON.stringify(expected)}`,
    );
  }
  return counts;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await seedDemoPlatform({ prisma, projectId: PROJECT_ID, userId: USER_ID });
    const timeline = buildMassTimeline({ months: MONTHS, now: Date.now() });
    const runTraces = timeline.scenarioRuns.flatMap((run) =>
      run.trace ? [run.trace] : [],
    );
    const traces = [...runTraces, ...timeline.organicTraces];
    console.log(
      `🌱 Mass seed: ${timeline.days} days — ${timeline.scenarioRuns.length} scenario runs, ${timeline.experimentRuns.length} experiment runs, ${traces.length} traces in the collector window`,
    );
    for (const trace of traces) {
      await ingestTrace(target, trace, Date.now());
    }
    console.log(`   traces ingested through ${target.endpoint}`);

    await dispatchTimeline(timeline);
    console.log("   lifecycles dispatched — waiting for projections…");
    const counts = await waitForProjections({
      simulations: timeline.scenarioRuns.length,
      evaluations: timeline.scenarioRuns.length,
      experimentRuns: timeline.experimentRuns.length,
      traces: traces.length,
    });
    console.log(
      `✅ Mass projections ready: ${counts.simulations} scenario runs, ${counts.evaluations} evaluations, ${counts.experimentRuns} experiment runs, ${counts.traces} traces`,
    );
  } finally {
    await prisma.$disconnect();
    // Bounded cleanup, same rationale as the realistic seeder: a successful
    // one-shot seed must not hold Haven open on queue-producer shutdown.
    await Promise.race([
      resetApp(),
      new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
    ]);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
