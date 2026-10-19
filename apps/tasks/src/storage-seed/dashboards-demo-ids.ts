/**
 * The dashboards demo's stable identifiers, value-only: one organization and team, three
 * projects that each run several named agents, and an empty day-zero project. Keys are
 * fixed dev-only values.
 */
import type { DashboardsDemoArchetype } from "./dashboards-demo-spec.ts";

export const DASHBOARDS_DEMO_ORGANIZATION = {
  id: "dashboards-demo-organization",
  slug: "dashboards-demo",
  name: "Dashboards Demo",
} as const;

export const DASHBOARDS_DEMO_TEAM = {
  id: "dashboards-demo-team",
  slug: "dashboards-demo-team",
  name: "Dashboards Demo Team",
} as const;

/**
 * How an agent's traces are built. `conversation` is one root agent span with its tools;
 * `planner` hands each turn to sub-agents, each a named agent span; `batch` runs in a
 * nightly job with no user; `coding` is a developer's coding-agent session.
 */
export type DashboardsDemoAgentShape = "conversation" | "planner" | "batch" | "coding";

export interface DashboardsDemoAgent {
  /** Sent as gen_ai.agent.name; also names every id the agent's traffic makes. */
  name: string;
  /** The traffic spec it draws from; coding agents have none. */
  archetype?: DashboardsDemoArchetype;
  shape: DashboardsDemoAgentShape;
}

export interface DashboardsDemoProject {
  id: string;
  slug: string;
  name: string;
  /** The legacy project key the collector accepts, a fixed dev-only value. */
  apiKey: string;
  /** Empty for the day-zero project, which gets no traffic. */
  agents: readonly DashboardsDemoAgent[];
}

function project({
  key,
  name,
  agents,
}: {
  key: string;
  name: string;
  agents: DashboardsDemoAgent[];
}): DashboardsDemoProject {
  return {
    id: `dashboards-demo-${key}`,
    slug: `dashboards-demo-${key}`,
    name,
    apiKey: `sk-lw-dashboards-demo-${key}`,
    agents,
  };
}

export const DASHBOARDS_DEMO_PROJECTS: readonly DashboardsDemoProject[] = [
  project({
    key: "care",
    name: "Customer care",
    agents: [
      { name: "shop-assistant", archetype: "support-bot", shape: "conversation" },
      { name: "help-center-answerer", archetype: "rag", shape: "conversation" },
      { name: "delivery-caller", archetype: "voice", shape: "conversation" },
    ],
  }),
  project({
    key: "platform",
    name: "Agent platform",
    agents: [
      { name: "checkout-planner", archetype: "tools-agent", shape: "planner" },
      { name: "invoice-classifier", archetype: "extraction", shape: "batch" },
      { name: "catalogue-copywriter", archetype: "generative", shape: "conversation" },
    ],
  }),
  project({
    key: "engineering",
    name: "Engineering",
    agents: [
      { name: "code-helper", shape: "coding" },
      { name: "ops-cowork", shape: "coding" },
    ],
  }),
  project({ key: "day-zero", name: "New project (no data yet)", agents: [] }),
];
