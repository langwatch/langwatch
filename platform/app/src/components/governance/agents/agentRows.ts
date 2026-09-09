/**
 * What the Agents page shows for one agent, and the invented set it shows when
 * there is nothing real to show.
 *
 * The row shape is deliberately wider than any read the platform has today.
 * `agents.getAll` is project-scoped and the governance section is
 * organization-scoped, so nothing here is fetched — see the page for why. When
 * an organization-wide read lands it fills this same shape, and the cards stop
 * caring where the rows came from.
 *
 * Every figure is nullable on purpose. A connected agent that registered this
 * morning and has never been called has no spend and no request count, and a
 * dash with a reason beside it is the honest rendering; `$0.00` would claim we
 * measured nothing spent.
 *
 * Spec: specs/ai-governance/dashboard/agents-page.feature
 */

/** Where an agent came to us from. The list the source chip offers. */
export const AGENT_SOURCES = [
  "custom",
  "databricks",
  "copilot_studio",
] as const;
export type AgentSource = (typeof AGENT_SOURCES)[number];

/** Spelled out, never abbreviated — the words a reader would say out loud. */
export const AGENT_SOURCE_LABELS: Record<AgentSource, string> = {
  custom: "Custom",
  databricks: "Databricks",
  copilot_studio: "Copilot Studio",
};

export interface GovernanceAgentRow {
  id: string;
  name: string;
  /** Part of the agent's identity, not a tag: ADR-128 keys a row on it. */
  environment: string;
  /** `null` is the unclaimed case, which is the whole point of the filter. */
  owner: string | null;
  models: string[];
  source: AgentSource;
  /** United States dollars over the last 30 days, or `null` if not measured. */
  costUsd30d: number | null;
  requests30d: number | null;
  /**
   * Minutes since the agent last did anything, rather than a timestamp: a
   * fixed date in invented data goes stale the week after it is written and
   * starts reading as an outage.
   */
  lastActiveMinutesAgo: number | null;
}

/**
 * The invented set. Ten agents, three sources, a spread of owned and
 * unclaimed, and one that has registered but never run — the case that proves
 * a missing figure renders as a dash rather than a zero.
 *
 * Names are generic on purpose. Nothing here names a customer, a person or a
 * real deployment.
 *
 * These names are canonical across the governance section: this page is the
 * registry of record, so every agent another page invents spend for has a row
 * here. A reader crossing from Costs must find what they were just billed for.
 * The environment is a column here rather than a suffix on the name, because
 * ADR-128 keys an agent on the pair — an agent is not called "checkout-agent-prod",
 * it is "checkout-agent" running in production.
 */
export const SAMPLE_AGENT_ROWS: GovernanceAgentRow[] = [
  {
    id: "sample-support-copilot",
    name: "support-copilot",
    environment: "production",
    owner: "Customer Support",
    models: ["gpt-5-mini", "claude-sonnet-5"],
    source: "custom",
    costUsd30d: 4182.4,
    requests30d: 128400,
    lastActiveMinutesAgo: 4,
  },
  {
    id: "sample-checkout-agent",
    name: "checkout-agent",
    environment: "production",
    owner: "Payments",
    models: ["gpt-5-mini"],
    source: "custom",
    costUsd30d: 2640.15,
    requests30d: 86200,
    lastActiveMinutesAgo: 12,
  },
  {
    id: "sample-genie-revenue",
    name: "genie-revenue-analyst",
    environment: "production",
    owner: null,
    models: ["databricks-claude-sonnet-5"],
    source: "databricks",
    costUsd30d: 1975.8,
    requests30d: 9450,
    lastActiveMinutesAgo: 55,
  },
  {
    id: "sample-fraud-triage",
    name: "fraud-triage",
    environment: "production",
    owner: "Risk",
    models: ["claude-sonnet-5"],
    source: "custom",
    costUsd30d: 1150.9,
    requests30d: 44300,
    lastActiveMinutesAgo: 30,
  },
  {
    id: "sample-genie-supply",
    name: "genie-supply-planner",
    environment: "staging",
    owner: "Data and AI",
    models: ["databricks-llama-4-maverick"],
    source: "databricks",
    costUsd30d: 612.3,
    requests30d: 3110,
    lastActiveMinutesAgo: 260,
  },
  {
    id: "sample-churn-predictor",
    name: "churn-predictor",
    environment: "staging",
    owner: null,
    models: ["gpt-5-mini"],
    source: "custom",
    costUsd30d: 455.7,
    requests30d: 5200,
    lastActiveMinutesAgo: 180,
  },
  {
    id: "sample-hr-helpdesk",
    name: "hr-helpdesk",
    environment: "production",
    owner: "People Operations",
    models: ["gpt-5-mini"],
    source: "copilot_studio",
    costUsd30d: null,
    requests30d: 21800,
    lastActiveMinutesAgo: 95,
  },
  {
    id: "sample-it-triage",
    name: "it-service-triage",
    environment: "production",
    // Owned, and deliberately so. It leaves Copilot Studio as the one source
    // with nothing unclaimed behind it, which is what makes the "no agent
    // matches these filters" state reachable at all: every other source has an
    // unclaimed agent, so before this the empty-filter branch could not be
    // reached with sample data on, and neither a reviewer nor a test could
    // ever see it. A bot built inside a service desk having an owner is also
    // the likelier story.
    owner: "IT Service Desk",
    models: ["gpt-5-mini"],
    source: "copilot_studio",
    costUsd30d: null,
    requests30d: 15600,
    lastActiveMinutesAgo: 1500,
  },
  {
    id: "sample-docs-rag",
    name: "docs-rag",
    environment: "production",
    owner: "Documentation",
    models: ["gpt-5-mini", "text-embedding-3-large"],
    source: "custom",
    costUsd30d: 71.42,
    requests30d: 2040,
    lastActiveMinutesAgo: 2880,
  },
  {
    // The never-run case. It is deliberately an agent no other page bills for:
    // a row Costs shows spend against cannot also be one that has never run.
    id: "sample-contract-review",
    name: "contract-review",
    environment: "development",
    owner: null,
    models: ["claude-sonnet-5"],
    source: "custom",
    costUsd30d: null,
    requests30d: null,
    lastActiveMinutesAgo: null,
  },
];

/**
 * How long ago, in the words a reader would use. Whole units only: the reader
 * is deciding whether an agent is alive, not timing it.
 */
export function formatLastActive(minutesAgo: number | null): string | null {
  if (minutesAgo === null) return null;
  if (minutesAgo < 1) return "just now";
  if (minutesAgo < 60)
    return `${minutesAgo} ${minutesAgo === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.floor(minutesAgo / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}
