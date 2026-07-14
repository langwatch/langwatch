/**
 * Seeds a coherent local platform story through production write paths.
 *
 * Postgres receives durable definitions (agents, evaluators, scenarios, suite,
 * dataset, experiment). Traces go through /api/collector. Evaluation,
 * simulation, and experiment-run lifecycles are emitted as real event-sourcing
 * commands, so the event log and every projection are exercised together.
 */
import { PrismaClient } from "@prisma/client";
import { resetApp } from "../src/server/app-layer/app";
import { initializeDefaultApp } from "../src/server/app-layer/presets";
import { getClickHouseClientForProject } from "../src/server/clickhouse/clickhouseClient";
import { getSuiteSetId } from "../src/server/suites/suite-set-id";
import {
  DEMO_PLATFORM_IDS,
  seedDemoPlatform,
} from "../prisma/seed-demo-platform";

const PROJECT_ID = "local-dev-project";
const USER_ID = "local-dev-admin-user";
const ENDPOINT = process.env.HAVEN_SEED_ENDPOINT ?? "http://localhost:5560";
const API_KEY =
  process.env.HAVEN_SEED_LANGWATCH_API_KEY ?? "sk-lw-local-development-key";
const BASE_TIME = Date.UTC(2026, 6, 15, 10, 0, 0);
const DAY_MS = 24 * 60 * 60_000;
const HISTORY_DAYS = 21;

function assertLocalUrl(name: string, value: string | undefined): void {
  if (!value) throw new Error(`${name} is required`);
  const hostname = new URL(value).hostname
    .replace(/^\[|\]$/g, "")
    .toLowerCase();
  if (
    hostname !== "localhost" &&
    hostname !== "127.0.0.1" &&
    hostname !== "::1" &&
    !hostname.endsWith(".localhost")
  ) {
    throw new Error(`Refusing to seed: ${name} host ${hostname} is not local`);
  }
}

assertLocalUrl("HAVEN_SEED_ENDPOINT", ENDPOINT);
assertLocalUrl("DATABASE_URL", process.env.DATABASE_URL);
assertLocalUrl("CLICKHOUSE_URL", process.env.CLICKHOUSE_URL);

interface TraceFixture {
  traceId: string;
  userId: string;
  threadId: string;
  input: string;
  output: string;
  model: string;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  cost: number;
  metadata: Record<string, string | string[]>;
  finishedAtMs?: number;
  hasError?: boolean;
}

const EXPERIMENT_ROWS = [
  {
    input: "I was charged twice for my Pro subscription. Please fix it.",
    expected:
      "I’m sorry about the duplicate charge. I’ll help verify both transactions and route the confirmed duplicate for refund; refunds normally appear in 3–5 business days.",
  },
  {
    input: "How can I invite five teammates and choose their roles?",
    expected:
      "Open Settings → Members, choose Invite, paste all five addresses, and select the role each teammate should receive before sending.",
  },
  {
    input: "What happens when the traces API rate limit is exceeded?",
    expected:
      "The API returns HTTP 429 with Retry-After. Back off and retry; the SDKs handle short bursts automatically. Check your plan for the exact limit.",
  },
  {
    input: "Checkout returned 500s after a deploy. Summarize the incident.",
    expected:
      "Checkout failed after the deploy because a required environment variable was absent. Rollback restored service; add configuration validation to the release gate.",
  },
  {
    input: "A customer asks for a refund outside policy and is angry.",
    expected:
      "Acknowledge the frustration, explain the policy clearly, and escalate with the account and request context without promising an exception.",
  },
] as const;

const EXPERIMENT_VARIANTS = [
  {
    name: "baseline",
    runId: "demo-experiment-run-baseline",
    scores: [0.62, 0.74, 0.41, 0.81, 0.57],
    outputs: [
      "I have refunded the second charge. It should arrive soon.",
      "Go to your team settings and invite each person.",
      "The limit is exactly 3,000 requests per minute.",
      "A deploy caused checkout errors. We rolled back and fixed it.",
      "I can make an exception and refund it for you.",
    ],
  },
  {
    name: "improved",
    runId: "demo-experiment-run-improved",
    scores: [0.93, 0.91, 0.88, 0.94, 0.86],
    outputs: EXPERIMENT_ROWS.map((row) => row.expected),
  },
] as const;

const SCENARIO_FIXTURES = [
  {
    scenarioId: DEMO_PLATFORM_IDS.scenarios.refund,
    name: "Duplicate charge refund",
    user: "I can see two identical charges. Refund the duplicate now.",
    baseline:
      "I’ve refunded it already. The money will be in your account tomorrow.",
    improved:
      "I’m sorry about the duplicate. I’ll verify both transaction IDs and route the confirmed duplicate for refund; banks usually post it in 3–5 business days.",
    criteria: [
      "Acknowledges the duplicate charge",
      "Does not claim an unverified refund was completed",
      "Explains the expected refund timeline",
    ],
  },
  {
    scenarioId: DEMO_PLATFORM_IDS.scenarios.groundedness,
    name: "Unknown documentation limit",
    user: "What is the exact daily export limit?",
    baseline: "The exact daily export limit is 50,000 rows.",
    improved:
      "The retrieved documentation doesn’t state an exact daily export limit. I can check your plan details or point you to support for the account-specific value.",
    criteria: [
      "Does not invent a numeric limit",
      "States that the supplied context is insufficient",
      "Offers a concrete next step",
    ],
  },
  {
    scenarioId: DEMO_PLATFORM_IDS.scenarios.escalation,
    name: "Angry customer escalation",
    user: "Your refund policy is ridiculous. Make an exception or I cancel.",
    baseline: "Fine, I’ll make an exception and refund the charge.",
    improved:
      "I understand why this is frustrating. I can’t promise an exception, but I’ll escalate the request with the charge and account context so a specialist can review it quickly.",
    criteria: [
      "Uses empathetic language",
      "Does not promise a policy exception",
      "Escalates to a human with useful context",
    ],
  },
] as const;

interface HistoricalScenarioRun {
  runId: string;
  batchRunId: string;
  startedAt: number;
  scenarioIndex: number;
  passed: boolean;
  score: number;
  trace: TraceFixture;
}

/** Small deterministic PRNG: random-looking local history, stable on reseed. */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function utcDayStart(epochMs: number): number {
  const date = new Date(epochMs);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function dateKey(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

/**
 * Three completed weeks of coherent simulation traffic. Each day runs every
 * core scenario plus 0–2 deterministic reruns; pass rate trends upward over
 * the period while still retaining realistic failures and latency variance.
 */
function buildHistoricalScenarioRuns(
  now = Date.now(),
): HistoricalScenarioRun[] {
  const lastCompletedDay = utcDayStart(now) - DAY_MS;
  const firstDay = lastCompletedDay - (HISTORY_DAYS - 1) * DAY_MS;
  const runs: HistoricalScenarioRun[] = [];

  for (let dayIndex = 0; dayIndex < HISTORY_DAYS; dayIndex++) {
    const dayStart = firstDay + dayIndex * DAY_MS;
    const day = dateKey(dayStart);
    const random = mulberry32(0x51a7c0de + dayIndex * 7_919);
    const dailyRuns = SCENARIO_FIXTURES.length + Math.floor(random() * 3);
    const trend = dayIndex / Math.max(1, HISTORY_DAYS - 1);

    for (let ordinal = 0; ordinal < dailyRuns; ordinal++) {
      const scenarioIndex =
        ordinal < SCENARIO_FIXTURES.length
          ? ordinal
          : Math.floor(random() * SCENARIO_FIXTURES.length);
      const scenario = SCENARIO_FIXTURES[scenarioIndex]!;
      const passProbability = 0.62 + trend * 0.2 - scenarioIndex * 0.025;
      const passed = random() < passProbability;
      const variant = passed ? "improved" : "baseline";
      const latencyMs = Math.round(
        950 + random() * 3_800 + (passed ? 0 : random() * 2_500),
      );
      const startedAt =
        dayStart +
        (8 * 60 + ordinal * 115 + Math.floor(random() * 35)) * 60_000;
      const runId = `demo-scenario-history-${day}-${ordinal + 1}-${scenarioIndex + 1}`;
      const batchRunId = `demo-history-batch-${day}`;
      const traceId = `demo-platform-history-${day}-${ordinal + 1}-${scenarioIndex + 1}`;
      const score = passed ? 0.76 + random() * 0.22 : 0.22 + random() * 0.43;

      runs.push({
        runId,
        batchRunId,
        startedAt,
        scenarioIndex,
        passed,
        score,
        trace: {
          traceId,
          userId: `demo-history-user-${1 + Math.floor(random() * 18)}`,
          threadId: `demo-history-thread-${day}-${scenarioIndex + 1}-${ordinal + 1}`,
          input: scenario.user,
          output: scenario[variant],
          model: passed ? "gpt-5-mini" : "gpt-4.1-mini",
          latencyMs,
          promptTokens: 78 + Math.floor(random() * 86),
          completionTokens: 34 + Math.floor(random() * 74),
          cost: Number((0.0024 + random() * 0.0068).toFixed(6)),
          finishedAtMs: startedAt + latencyMs,
          metadata: {
            labels: [
              "demo-seed",
              "scenario",
              "historical",
              passed ? "passed" : "failed",
            ],
            "scenario.run_id": runId,
            "scenario.id": scenario.scenarioId,
            "scenario.batch_run_id": batchRunId,
            "agent.id": DEMO_PLATFORM_IDS.agents.support,
            "seed.cohort": "three-week-simulation-history",
          },
        },
      });
    }
  }

  return runs;
}

function buildTraceFixtures(
  historicalRuns: HistoricalScenarioRun[],
): TraceFixture[] {
  const experimentTraces = EXPERIMENT_VARIANTS.flatMap(
    (variant, variantIndex) =>
      EXPERIMENT_ROWS.map((row, index) => ({
        traceId: `demo-platform-exp-${variant.name}-${index + 1}`,
        userId: `demo-user-${["ines", "marcus", "priya"][index % 3]}`,
        threadId: `demo-experiment-${variant.name}-${index + 1}`,
        input: row.input,
        output: variant.outputs[index]!,
        model: variant.name === "baseline" ? "gpt-4.1-mini" : "gpt-5-mini",
        latencyMs:
          variant.name === "baseline" ? 1850 + index * 190 : 1220 + index * 130,
        promptTokens: 75 + index * 9,
        completionTokens: 38 + index * 7,
        cost:
          variant.name === "baseline"
            ? 0.0038 + index * 0.0004
            : 0.0029 + index * 0.0003,
        metadata: {
          labels: ["demo-seed", "experiment", variant.name],
          "evaluation.run_id": variant.runId,
          "langwatch.experiment_id": DEMO_PLATFORM_IDS.experiment,
          "agent.id": DEMO_PLATFORM_IDS.agents.support,
          "release.channel": variant.name,
        },
      })),
  );

  const scenarioTraces = SCENARIO_FIXTURES.flatMap((scenario, scenarioIndex) =>
    (["baseline", "improved"] as const).map((variant, variantIndex) => {
      const runId = `demo-scenario-${scenarioIndex + 1}-${variant}`;
      return {
        traceId: `demo-platform-sim-${scenarioIndex + 1}-${variant}`,
        userId: `demo-sim-user-${scenarioIndex + 1}`,
        threadId: `demo-simulation-${scenarioIndex + 1}`,
        input: scenario.user,
        output: scenario[variant],
        model: variant === "baseline" ? "gpt-4.1-mini" : "gpt-5-mini",
        latencyMs: 1400 + scenarioIndex * 220 - variantIndex * 180,
        promptTokens: 92 + scenarioIndex * 11,
        completionTokens: 44 + scenarioIndex * 8,
        cost: 0.0035 + scenarioIndex * 0.0006 - variantIndex * 0.0004,
        metadata: {
          labels: ["demo-seed", "scenario", variant],
          "scenario.run_id": runId,
          "scenario.id": scenario.scenarioId,
          "scenario.batch_run_id": `demo-scenario-batch-${variant}`,
          "agent.id": DEMO_PLATFORM_IDS.agents.support,
        },
      };
    }),
  );

  return [
    ...experimentTraces,
    ...scenarioTraces,
    ...historicalRuns.map((run) => run.trace),
  ];
}

async function ingestTrace(
  trace: TraceFixture,
  index: number,
  total: number,
): Promise<void> {
  const finishedAt =
    trace.finishedAtMs ?? Date.now() - (total - index) * 4 * 60_000;
  const startedAt = finishedAt - trace.latencyMs;
  const response = await fetch(`${ENDPOINT}/api/collector`, {
    method: "POST",
    headers: {
      "X-Auth-Token": API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      trace_id: trace.traceId,
      spans: [
        {
          trace_id: trace.traceId,
          span_id: `${trace.traceId}-agent`,
          type: "agent",
          name: "support-agent",
          input: { type: "text", value: trace.input },
          output: { type: "text", value: trace.output },
          timestamps: { started_at: startedAt, finished_at: finishedAt },
        },
        {
          trace_id: trace.traceId,
          span_id: `${trace.traceId}-llm`,
          parent_id: `${trace.traceId}-agent`,
          type: "llm",
          name: "chat-completion",
          model: trace.model,
          vendor: "openai",
          input: {
            type: "chat_messages",
            value: [{ role: "user", content: trace.input }],
          },
          output: {
            type: "chat_messages",
            value: [{ role: "assistant", content: trace.output }],
          },
          metrics: {
            prompt_tokens: trace.promptTokens,
            completion_tokens: trace.completionTokens,
            cost: trace.cost,
          },
          timestamps: {
            started_at: startedAt + 80,
            first_token_at: startedAt + Math.round(trace.latencyMs * 0.28),
            finished_at: finishedAt,
          },
        },
      ],
      metadata: {
        user_id: trace.userId,
        thread_id: trace.threadId,
        ...trace.metadata,
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(
      `collector rejected ${trace.traceId}: ${response.status} ${await response.text()}`,
    );
  }
}

async function dispatchEventLifecycles(traces: TraceFixture[]): Promise<void> {
  // Dispatch only. Haven's already-running worker consumes the global event
  // queue. A web-role composition has no consumer timers, so this one-shot
  // script closes promptly after the projections become visible.
  const app = initializeDefaultApp({ processRole: "web" });

  for (const [variantIndex, variant] of EXPERIMENT_VARIANTS.entries()) {
    const runStartedAt = BASE_TIME + variantIndex * 60 * 60_000;
    await app.experimentRuns.startExperimentRun({
      tenantId: PROJECT_ID,
      occurredAt: runStartedAt,
      runId: variant.runId,
      experimentId: DEMO_PLATFORM_IDS.experiment,
      total: EXPERIMENT_ROWS.length,
      targets: [
        {
          id: "demo-target-support-agent",
          name: "Support Copilot",
          type: "agent",
          agentId: DEMO_PLATFORM_IDS.agents.support,
          model: variant.name === "baseline" ? "gpt-4.1-mini" : "gpt-5-mini",
          metadata: { release: variant.name },
        },
      ],
    });

    for (const [index, row] of EXPERIMENT_ROWS.entries()) {
      const traceId = `demo-platform-exp-${variant.name}-${index + 1}`;
      const occurredAt = runStartedAt + (index + 1) * 60_000;
      await app.experimentRuns.recordTargetResult({
        tenantId: PROJECT_ID,
        occurredAt,
        runId: variant.runId,
        experimentId: DEMO_PLATFORM_IDS.experiment,
        index,
        targetId: "demo-target-support-agent",
        entry: {
          input: row.input,
          expected_output: row.expected,
          category: [
            "billing",
            "onboarding",
            "documentation",
            "incident",
            "escalation",
          ][index],
        },
        predicted: { output: variant.outputs[index]! },
        cost: traces.find((trace) => trace.traceId === traceId)?.cost ?? null,
        duration:
          traces.find((trace) => trace.traceId === traceId)?.latencyMs ?? null,
        traceId,
      });
      const score = variant.scores[index]!;
      await app.experimentRuns.recordEvaluatorResult({
        tenantId: PROJECT_ID,
        occurredAt: occurredAt + 500,
        runId: variant.runId,
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
        details: `Seeded quality review scored ${Math.round(score * 100)}%.`,
        duration: 420 + index * 35,
        cost: 0.0008,
      });
      await app.evaluations.reportEvaluation({
        tenantId: PROJECT_ID,
        occurredAt: occurredAt + 750,
        evaluationId: `demo-trace-eval-${variant.name}-${index + 1}`,
        evaluatorId: DEMO_PLATFORM_IDS.evaluators.quality,
        evaluatorType: "langevals/llm_score",
        evaluatorName: "Support Answer Quality",
        traceId,
        status: "processed",
        score,
        passed: score >= 0.7,
        label:
          score >= 0.85
            ? "excellent"
            : score >= 0.7
              ? "acceptable"
              : "needs work",
        details:
          "Evaluation emitted through the canonical event-sourcing command.",
      });
    }

    await app.experimentRuns.completeExperimentRun({
      tenantId: PROJECT_ID,
      occurredAt: runStartedAt + 8 * 60_000,
      runId: variant.runId,
      experimentId: DEMO_PLATFORM_IDS.experiment,
      finishedAt: runStartedAt + 8 * 60_000,
    });
  }

  const suiteSetId = getSuiteSetId(DEMO_PLATFORM_IDS.suite);
  for (const [scenarioIndex, scenario] of SCENARIO_FIXTURES.entries()) {
    for (const [variantIndex, variant] of (
      ["baseline", "improved"] as const
    ).entries()) {
      const runId = `demo-scenario-${scenarioIndex + 1}-${variant}`;
      const batchRunId = `demo-scenario-batch-${variant}`;
      const traceId = `demo-platform-sim-${scenarioIndex + 1}-${variant}`;
      const startedAt =
        BASE_TIME +
        (3 + variantIndex) * 60 * 60_000 +
        scenarioIndex * 5 * 60_000;
      const passed = variant === "improved";
      await app.simulations.startRun({
        tenantId: PROJECT_ID,
        occurredAt: startedAt,
        scenarioRunId: runId,
        scenarioId: scenario.scenarioId,
        batchRunId,
        scenarioSetId: suiteSetId,
        name: scenario.name,
        description: `Support Regression Suite — ${variant}`,
        metadata: {
          suiteId: DEMO_PLATFORM_IDS.suite,
          variant,
          model: variant === "baseline" ? "gpt-4.1-mini" : "gpt-5-mini",
        },
      });
      await app.simulations.messageSnapshot({
        tenantId: PROJECT_ID,
        occurredAt: startedAt + 1_000,
        scenarioRunId: runId,
        messages: [
          { id: `${runId}-user`, role: "user", content: scenario.user },
          {
            id: `${runId}-assistant`,
            role: "assistant",
            content: scenario[variant],
            trace_id: traceId,
          },
        ],
        traceIds: [traceId],
        status: "IN_PROGRESS",
      });
      await app.simulations.finishRun({
        tenantId: PROJECT_ID,
        occurredAt: startedAt + 2_000,
        scenarioRunId: runId,
        durationMs: traces.find((trace) => trace.traceId === traceId)
          ?.latencyMs,
        status: passed ? "SUCCESS" : "FAILURE",
        results: {
          verdict: passed ? "success" : "failure",
          reasoning: passed
            ? "The response stayed within policy and supplied a safe next step."
            : "The response made an unsupported promise or invented a fact.",
          metCriteria: passed ? [...scenario.criteria] : [scenario.criteria[0]],
          unmetCriteria: passed ? [] : scenario.criteria.slice(1),
        },
      });
      await app.evaluations.reportEvaluation({
        tenantId: PROJECT_ID,
        occurredAt: startedAt + 2_500,
        evaluationId: `demo-scenario-eval-${scenarioIndex + 1}-${variant}`,
        evaluatorId: DEMO_PLATFORM_IDS.evaluators.groundedness,
        evaluatorType: "ragas/faithfulness",
        evaluatorName: "Documentation Groundedness",
        traceId,
        status: "processed",
        score: passed ? 0.94 : 0.31,
        passed,
        label: passed ? "grounded" : "unsupported claim",
        details: passed
          ? "No unsupported account action or numeric limit was asserted."
          : "The answer asserted a fact not present in the available context.",
      });
    }
  }
}

interface ProjectionCounts {
  traces: number;
  evaluations: number;
  simulations: number;
  experimentRuns: number;
  events: number;
}

async function projectionCounts(): Promise<ProjectionCounts> {
  const client = await getClickHouseClientForProject(PROJECT_ID);
  if (!client) throw new Error("ClickHouse client is unavailable");
  const result = await client.query({
    query: `
      SELECT
        (SELECT uniqExact(TraceId) FROM trace_summaries WHERE TenantId = {tenantId:String} AND TraceId LIKE 'demo-platform-%') AS traces,
        (SELECT uniqExact(EvaluationId) FROM evaluation_runs WHERE TenantId = {tenantId:String} AND EvaluationId LIKE 'demo-%') AS evaluations,
        (SELECT uniqExact(ScenarioRunId) FROM simulation_runs WHERE TenantId = {tenantId:String} AND ScenarioRunId LIKE 'demo-scenario-%') AS simulations,
        (SELECT uniqExact(RunId) FROM experiment_runs WHERE TenantId = {tenantId:String} AND RunId LIKE 'demo-experiment-run-%') AS experimentRuns,
        (SELECT uniqExact(IdempotencyKey) FROM event_log WHERE TenantId = {tenantId:String} AND IdempotencyKey LIKE '%demo-%') AS events
    `,
    query_params: { tenantId: PROJECT_ID },
    format: "JSONEachRow",
  });
  const [row] =
    await result.json<Record<keyof ProjectionCounts, string | number>>();
  if (!row) throw new Error("Projection count query returned no row");
  return {
    traces: Number(row.traces),
    evaluations: Number(row.evaluations),
    simulations: Number(row.simulations),
    experimentRuns: Number(row.experimentRuns),
    events: Number(row.events),
  };
}

async function waitForProjections(): Promise<ProjectionCounts> {
  const deadline = Date.now() + 45_000;
  let counts = await projectionCounts();
  while (
    (counts.traces < 16 ||
      counts.evaluations < 16 ||
      counts.simulations < 6 ||
      counts.experimentRuns < 2 ||
      counts.events < 20) &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    counts = await projectionCounts();
  }
  if (
    counts.traces < 16 ||
    counts.evaluations < 16 ||
    counts.simulations < 6 ||
    counts.experimentRuns < 2 ||
    counts.events < 20
  ) {
    throw new Error(
      `Timed out waiting for demo projections: ${JSON.stringify(counts)}`,
    );
  }
  return counts;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await seedDemoPlatform({ prisma, projectId: PROJECT_ID, userId: USER_ID });
    const historicalRuns = buildHistoricalScenarioRuns();
    const traces = buildTraceFixtures(historicalRuns);
    for (const [index, trace] of traces.entries()) {
      await ingestTrace(trace, index, traces.length);
    }
    console.log(
      `🌱 Ingested ${traces.length} linked traces through ${ENDPOINT}`,
    );

    await dispatchEventLifecycles(traces);
    const counts = await waitForProjections();
    console.log(
      `✅ Demo projections ready: ${counts.traces} traces, ${counts.evaluations} evaluations, ${counts.simulations} scenario runs, ${counts.experimentRuns} experiment runs, ${counts.events} events`,
    );
  } finally {
    await prisma.$disconnect();
    // GroupQueue producer shutdown can wait on Redis's full graceful timeout
    // even though every seeded projection is already visible. Bound cleanup so
    // a successful one-shot seed cannot hold Haven open for minutes.
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
