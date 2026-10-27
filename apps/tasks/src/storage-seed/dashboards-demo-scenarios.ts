/**
 * Scenario test suites for the dashboards demo: a CI batch each weekday runs every scenario
 * of an agent's suite, sent as the scenario SDK sends its events. One scenario is flaky and
 * one starts failing after the shop assistant's model change, so release widgets find both.
 */
import type { CollectorRESTParams } from "@langwatch/trace-contract";

import { type DemoDay, isWeekend } from "./dashboards-demo-days.ts";
import { DemoRandom, hexId } from "./dashboards-demo-random.ts";

interface DemoScenario {
  name: string;
  criteria: string[];
  /** Chance a run passes, by prototype day. */
  passRate: (day: number) => number;
}

interface DemoSuite {
  agent: string;
  suite: string;
  scenarios: DemoScenario[];
}

const steady = (rate: number) => () => rate;

/** The agents with a suite, by agent name. */
export const DEMO_SUITES: readonly DemoSuite[] = [
  {
    agent: "shop-assistant",
    suite: "shop-assistant-regression",
    scenarios: [
      {
        name: "Track a late order",
        criteria: ["Finds the order", "Gives a delivery date", "Stays polite"],
        passRate: steady(0.97),
      },
      {
        name: "Return a damaged parcel",
        criteria: ["Opens a return", "Offers a refund or swap", "Sends the return label"],
        // The flaky test: it passes about half the time whatever changes.
        passRate: steady(0.5),
      },
      {
        name: "Ask for a product the shop does not sell",
        criteria: [
          "Says the product is not sold",
          "Suggests a close match",
          "Does not invent stock",
        ],
        passRate: (day) => (day >= 75 ? 0.3 : 0.92),
      },
      {
        name: "Change the delivery address",
        criteria: ["Checks the order can still change", "Confirms the new address"],
        passRate: steady(0.94),
      },
      {
        name: "Ask for a human",
        criteria: ["Hands over to an agent", "Summarises the problem"],
        passRate: steady(0.99),
      },
    ],
  },
  {
    agent: "checkout-planner",
    suite: "checkout-planner-smoke",
    scenarios: [
      {
        name: "Pay with a saved card",
        criteria: ["Charges the card once", "Confirms the order"],
        passRate: steady(0.96),
      },
      {
        name: "Apply an expired discount code",
        criteria: ["Explains the code expired", "Does not apply it"],
        passRate: steady(0.9),
      },
      {
        name: "Retry a declined payment",
        criteria: ["Retries at most twice", "Offers another payment method"],
        passRate: (day) => (day >= 81 && day < 85 ? 0.2 : 0.88),
      },
    ],
  },
];

export interface ScenarioRunPayloads {
  scenarioRunId: string;
  startedAt: number;
  /** The run's agent trace, sent like any other. */
  trace: CollectorRESTParams;
  /** Started, snapshot and finished, in order. */
  events: object[];
}

/** One CI batch of a suite on a day, or none on weekends. Ids are fixed by suite and day. */
export function suiteBatchOn({
  suite,
  projectSlug,
  day,
  now,
}: {
  suite: DemoSuite;
  projectSlug: string;
  day: DemoDay;
  /** A batch that would still be running at this moment is left out. */
  now: number;
}): ScenarioRunPayloads[] {
  if (isWeekend(day) || day.dayStart + 8 * 3_600_000 > now) return [];
  const batchRunId = `batch_${projectSlug}_${suite.suite}_${day.key}`;
  let clock =
    day.dayStart + 6 * 3_600_000 + new DemoRandom(batchRunId).int({ min: 0, max: 1_800_000 });
  return suite.scenarios.map((scenario, index) => {
    const random = new DemoRandom(`${batchRunId}:${index}`);
    const scenarioId = `scenario_${suite.suite}_${index}`;
    const scenarioRunId = `run_${batchRunId}_${index}`;
    const traceId = hexId({ key: `scenario-trace:${scenarioRunId}`, length: 32 });
    const durationMs = Math.round(random.logNormal({ median: 9_000, p95: 30_000 }));
    const startedAt = clock;
    const finishedAt = startedAt + durationMs;
    clock = finishedAt + random.int({ min: 200, max: 2_000 });
    const passed = random.chance(scenario.passRate(day.prototypeDay));
    const unmet = passed ? [] : [random.pick(scenario.criteria)];
    const base = { batchRunId, scenarioId, scenarioRunId, scenarioSetId: suite.suite };
    const promptTokens = random.int({ min: 800, max: 4_000 });
    const completionTokens = random.int({ min: 150, max: 900 });
    return {
      scenarioRunId,
      startedAt,
      trace: {
        trace_id: traceId,
        spans: [
          {
            span_id: hexId({ key: `${traceId}:root`, length: 16 }),
            trace_id: traceId,
            type: "llm",
            name: "generate",
            model: "gpt-5-mini",
            input: { type: "text", value: `Scenario: ${scenario.name}` },
            output: { type: "text", value: passed ? "Done as asked." : "I could not finish that." },
            params: { "gen_ai.agent.name": suite.agent, "scenario.run_id": scenarioRunId },
            metrics: {
              prompt_tokens: promptTokens,
              completion_tokens: completionTokens,
              cost: (promptTokens * 0.25 + completionTokens * 2) / 1_000_000,
            },
            timestamps: { started_at: startedAt, finished_at: finishedAt },
          },
        ],
        metadata: { labels: ["scenario"] },
      },
      events: [
        {
          ...base,
          type: "SCENARIO_RUN_STARTED",
          timestamp: startedAt,
          metadata: {
            name: scenario.name,
            description: `${suite.agent}: ${scenario.name}`,
          },
        },
        {
          ...base,
          type: "SCENARIO_MESSAGE_SNAPSHOT",
          timestamp: finishedAt - 50,
          messages: [
            {
              id: `${scenarioRunId}_user`,
              role: "user",
              content: scenario.name,
              trace_id: traceId,
            },
            {
              id: `${scenarioRunId}_agent`,
              role: "assistant",
              content: passed ? "Done as asked." : "I could not finish that.",
              trace_id: traceId,
            },
          ],
        },
        {
          ...base,
          type: "SCENARIO_RUN_FINISHED",
          timestamp: finishedAt,
          status: passed ? "SUCCESS" : "FAILED",
          results: {
            verdict: passed ? "success" : "failure",
            reasoning: passed ? "Every criterion was met." : `Missed: ${unmet.join(", ")}.`,
            metCriteria: scenario.criteria.filter((criterion) => !unmet.includes(criterion)),
            unmetCriteria: unmet,
          },
        },
      ],
    };
  });
}
