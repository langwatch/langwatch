/**
 * The demo platform's stable identifiers, value-only — importable by pure
 * generators and unit tests without dragging the generated Prisma client in
 * (prisma/seed-demo-platform.ts needs @prisma/client at runtime; this does not).
 */
export const DEMO_PLATFORM_IDS = {
  agents: {
    support: "demo-agent-support",
    retrieval: "demo-agent-retrieval",
  },
  evaluators: {
    quality: "demo-evaluator-quality",
    groundedness: "demo-evaluator-groundedness",
  },
  scenarios: {
    refund: "demo-scenario-refund",
    groundedness: "demo-scenario-groundedness",
    escalation: "demo-scenario-escalation",
  },
  suite: "demo-suite-support-regression",
  dataset: "demo-dataset-support-regression",
  experiment: "demo-experiment-support-quality",
} as const;
