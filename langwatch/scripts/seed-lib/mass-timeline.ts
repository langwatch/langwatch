/**
 * The mass seeder's timeline: months of coherent, backdated activity, built
 * deterministically (same now + months → same timeline). Pure — no I/O — so
 * the window rules are unit-testable:
 *
 *   - Scenario runs, evaluations, and experiment runs span the WHOLE window;
 *     they travel as event-sourcing commands whose occurredAt the substrate
 *     honours verbatim, so deep history lands in old event-log partitions.
 *   - Trace fixtures are attached only inside the collector's ingest window
 *     (TRACE_WINDOW_DAYS): the collector refuses older spans by design, and
 *     the seeder respects that contract instead of weakening it.
 */
import {
  DAY_MS,
  TRACE_WINDOW_DAYS,
  dateKey,
  mulberry32,
  utcDayStart,
  type TraceFixture,
} from "./seed-primitives";
import {
  EXPERIMENT_ROWS,
  ORGANIC_TRAFFIC,
  SCENARIO_FIXTURES,
} from "./platform-fixtures";
import { DEMO_PLATFORM_IDS } from "../../prisma/demo-platform-ids";

export interface MassScenarioRun {
  runId: string;
  batchRunId: string;
  scenarioIndex: number;
  startedAt: number;
  passed: boolean;
  score: number;
  latencyMs: number;
  /** Present only inside the collector's trace window. */
  trace?: TraceFixture;
}

export interface MassExperimentRun {
  runId: string;
  variant: "baseline" | "improved";
  startedAt: number;
  scores: number[];
  outputs: string[];
}

export interface MassTimeline {
  days: number;
  firstDayStart: number;
  lastDayStart: number;
  scenarioRuns: MassScenarioRun[];
  experimentRuns: MassExperimentRun[];
  organicTraces: TraceFixture[];
}

export interface MassTimelineOptions {
  months: number;
  now: number;
  /** Override for tests; defaults to the collector's contract. */
  traceWindowDays?: number;
}

const DAYS_PER_MONTH = 30;

/** Quality drifts upward over the window, with per-day noise. */
function passProbability(trend: number, scenarioIndex: number): number {
  return 0.55 + trend * 0.3 - scenarioIndex * 0.025;
}

export function buildMassTimeline(options: MassTimelineOptions): MassTimeline {
  const months = Math.max(1, Math.floor(options.months));
  const days = months * DAYS_PER_MONTH;
  const traceWindowDays = options.traceWindowDays ?? TRACE_WINDOW_DAYS;
  const lastDayStart = utcDayStart(options.now) - DAY_MS;
  const firstDayStart = lastDayStart - (days - 1) * DAY_MS;
  const traceCutoff = options.now - traceWindowDays * DAY_MS;

  const scenarioRuns: MassScenarioRun[] = [];
  const organicTraces: TraceFixture[] = [];
  const experimentRuns: MassExperimentRun[] = [];

  for (let dayIndex = 0; dayIndex < days; dayIndex++) {
    const dayStart = firstDayStart + dayIndex * DAY_MS;
    const day = dateKey(dayStart);
    const random = mulberry32(0x9e3779b9 ^ (dayIndex * 7_919));
    const trend = dayIndex / Math.max(1, days - 1);

    const dailyRuns = SCENARIO_FIXTURES.length + Math.floor(random() * 3);
    for (let ordinal = 0; ordinal < dailyRuns; ordinal++) {
      const scenarioIndex =
        ordinal < SCENARIO_FIXTURES.length
          ? ordinal
          : Math.floor(random() * SCENARIO_FIXTURES.length);
      const scenario = SCENARIO_FIXTURES[scenarioIndex]!;
      const passed = random() < passProbability(trend, scenarioIndex);
      const variant = passed ? "improved" : "baseline";
      const latencyMs = Math.round(
        950 + random() * 3_800 + (passed ? 0 : random() * 2_500),
      );
      const startedAt =
        dayStart +
        (8 * 60 + ordinal * 95 + Math.floor(random() * 40)) * 60_000;
      const runId = `mass-scenario-${day}-${ordinal + 1}`;
      const score = passed ? 0.74 + random() * 0.24 : 0.2 + random() * 0.45;

      const run: MassScenarioRun = {
        runId,
        batchRunId: `mass-batch-${day}`,
        scenarioIndex,
        startedAt,
        passed,
        score,
        latencyMs,
      };
      if (startedAt >= traceCutoff) {
        run.trace = {
          traceId: `mass-trace-${day}-${ordinal + 1}`,
          userId: `mass-user-${1 + Math.floor(random() * 24)}`,
          threadId: `mass-thread-${day}-${ordinal + 1}`,
          input: scenario.user,
          output: scenario[variant],
          model: passed ? "gpt-5-mini" : "gpt-4.1-mini",
          latencyMs,
          promptTokens: 78 + Math.floor(random() * 86),
          completionTokens: 34 + Math.floor(random() * 74),
          cost: Number((0.0024 + random() * 0.0068).toFixed(6)),
          finishedAtMs: startedAt + latencyMs,
          metadata: {
            labels: ["mass-seed", "scenario", passed ? "passed" : "failed"],
            "scenario.run_id": runId,
            "scenario.id": scenario.scenarioId,
            "scenario.batch_run_id": run.batchRunId,
            "agent.id": DEMO_PLATFORM_IDS.agents.support,
            "seed.cohort": "mass-history",
          },
        };
      }
      scenarioRuns.push(run);
    }

    // Organic traffic exists only where the collector will accept it.
    if (dayStart + DAY_MS > traceCutoff) {
      const conversations = 6 + Math.floor(random() * 8);
      for (let i = 0; i < conversations; i++) {
        const startedAt =
          dayStart + (9 * 60 + i * 55 + Math.floor(random() * 30)) * 60_000;
        if (startedAt < traceCutoff) continue;
        const topic = ORGANIC_TRAFFIC[Math.floor(random() * ORGANIC_TRAFFIC.length)]!;
        const latencyMs = Math.round(700 + random() * 2_600);
        organicTraces.push({
          traceId: `mass-organic-${day}-${i + 1}`,
          userId: `mass-user-${1 + Math.floor(random() * 40)}`,
          threadId: `mass-organic-thread-${day}-${i + 1}`,
          input: topic.input,
          output: topic.output,
          model: random() < 0.7 ? "gpt-5-mini" : "gpt-4.1-mini",
          latencyMs,
          promptTokens: 60 + Math.floor(random() * 120),
          completionTokens: 30 + Math.floor(random() * 90),
          cost: Number((0.0016 + random() * 0.005).toFixed(6)),
          finishedAtMs: startedAt + latencyMs,
          metadata: {
            labels: ["mass-seed", "organic"],
            "seed.cohort": "mass-organic",
          },
        });
      }
    }

    // One experiment run pair per week, scores drifting up over the window.
    if (dayIndex % 7 === 3) {
      const week = dateKey(dayStart);
      for (const variant of ["baseline", "improved"] as const) {
        const uplift = variant === "improved" ? 0.24 : 0;
        experimentRuns.push({
          runId: `mass-exp-${week}-${variant}`,
          variant,
          startedAt: dayStart + (13 + (variant === "improved" ? 2 : 0)) * 60 * 60_000,
          scores: EXPERIMENT_ROWS.map((_, index) =>
            Number(
              Math.min(
                0.98,
                0.5 + trend * 0.18 + uplift + random() * 0.08 - index * 0.015,
              ).toFixed(3),
            ),
          ),
          outputs: EXPERIMENT_ROWS.map((row) => row.expected),
        });
      }
    }
  }

  return {
    days,
    firstDayStart,
    lastDayStart,
    scenarioRuns,
    experimentRuns,
    organicTraces,
  };
}
