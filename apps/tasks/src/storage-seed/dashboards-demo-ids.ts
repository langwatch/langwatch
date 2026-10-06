/**
 * The dashboards demo's stable identifiers, value-only: one organization and team, one
 * project per agent type plus an empty day-zero project. Keys are fixed dev-only values.
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

export const DASHBOARDS_DEMO_BINDING_IDS = {
  organization: "dashboards-demo-admin-organization-binding",
  team: "dashboards-demo-admin-team-binding",
} as const;

export interface DashboardsDemoProject {
  id: string;
  slug: string;
  name: string;
  /** The legacy project key the collector accepts, a fixed dev-only value. */
  apiKey: string;
  /** Unset for the day-zero project, which gets no traffic. */
  archetype?: DashboardsDemoArchetype;
}

const NAMES: Record<DashboardsDemoArchetype, string> = {
  "support-bot": "Customer support bot",
  rag: "RAG assistant",
  vendor: "Agent platform",
  voice: "Voice agent",
  extraction: "Document extraction",
  regulated: "Regulated assistant",
  "tools-agent": "Tools agent",
  generative: "Generative feature",
};

function project(archetype: DashboardsDemoArchetype): DashboardsDemoProject {
  return {
    id: `dashboards-demo-${archetype}`,
    slug: `dashboards-demo-${archetype}`,
    name: NAMES[archetype],
    apiKey: `sk-lw-dashboards-demo-${archetype}`,
    archetype,
  };
}

export const DASHBOARDS_DEMO_PROJECTS: readonly DashboardsDemoProject[] = [
  ...(Object.keys(NAMES) as DashboardsDemoArchetype[]).map(project),
  {
    id: "dashboards-demo-day-zero",
    slug: "dashboards-demo-day-zero",
    name: "New project (no data yet)",
    apiKey: "sk-lw-dashboards-demo-day-zero",
  },
];
