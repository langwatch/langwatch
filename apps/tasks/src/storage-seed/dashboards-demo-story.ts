/**
 * The scripted story the demo tells, so every widget has something to find: a model change
 * that regresses one agent, a cost spike, an outage hour, a customer whose success drops.
 * Days are the prototype's (89 is today). The flaky test lives with the scenario suites.
 */
import type { DashboardsDemoChange, DashboardsDemoProjectSpec } from "./dashboards-demo-spec.ts";

/** The customers end users belong to, most traffic first. Fictional companies. */
export const DEMO_CUSTOMERS: readonly (readonly [string, number])[] = [
  ["harbor-pine", 0.22],
  ["brightwater-bikes", 0.18],
  ["tallgrass-coffee", 0.14],
  ["mosswood-pets", 0.12],
  ["kestrel-air", 0.1],
  ["quill-and-ink", 0.08],
  ["orbit-gym", 0.07],
  ["copperleaf-foods", 0.05],
  ["lumen-labs", 0.04],
];

/** The customer whose conversations start failing in the story. */
export const STRUGGLING_CUSTOMER = "harbor-pine";

const OUTAGE: DashboardsDemoChange = {
  day: 84,
  kind: "incident",
  label: "Model provider outage, 14:00 to 15:00 UTC",
  effect: { errors: 40, p95: 3.5, hours: [14, 15], untilDay: 85 },
};

/** Changes each agent gets on top of its spec's own, by agent name. */
export const DEMO_STORY: Readonly<Record<string, readonly DashboardsDemoChange[]>> = {
  "shop-assistant": [
    {
      day: 75,
      kind: "model",
      label: "shop-assistant moves to gpt-5-nano",
      version: "shop-assistant v13",
      effect: {
        models: [
          ["gpt-5-nano", 0.92],
          ["gpt-5", 0.08],
        ],
        evals: { "answer-quality": -0.2, "outcome-judge": -0.1 },
        outcome: { resolved: -0.09, misunderstood: 0.09 },
        feedbackDown: 0.12,
      },
    },
    {
      day: 78,
      kind: "customer",
      label: "Harbor & Pine moves its returns to a new warehouse",
      effect: { customers: { [STRUGGLING_CUSTOMER]: -0.4 }, rampDays: 4 },
    },
    OUTAGE,
  ],
  "help-center-answerer": [OUTAGE],
  "delivery-caller": [OUTAGE],
  "checkout-planner": [
    {
      day: 81,
      kind: "incident",
      label: "checkout-planner loops on payment retries",
      effect: { loops: 8, cost: 2.4, p95: 1.6, untilDay: 85 },
    },
  ],
};

/** An agent's spec with its story changes added, in day order so the latest release wins. */
export function withStory({
  spec,
  agentName,
}: {
  spec: DashboardsDemoProjectSpec;
  agentName: string;
}): DashboardsDemoProjectSpec {
  const changes = [...spec.changes, ...(DEMO_STORY[agentName] ?? [])].toSorted(
    (a, b) => a.day - b.day,
  );
  return { ...spec, changes };
}
