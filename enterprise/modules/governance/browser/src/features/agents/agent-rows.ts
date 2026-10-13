/** The Agents page's labels, samples and formatting; the row type lives in the contract. */
import type {
  AgentHealth,
  AgentSource,
  GovernanceAgentRow,
} from "@langwatch/enterprise-governance-contract";

/** Spelled out, never abbreviated — the words a reader would say out loud. */
export const AGENT_SOURCE_LABELS: Record<AgentSource, string> = {
  custom: "Custom",
  databricks: "Databricks",
  copilot_studio: "Copilot Studio",
};

/** Spelled out, never abbreviated — the words the summary strip says. */
export const AGENT_HEALTH_LABELS: Record<AgentHealth, string> = {
  responding: "responding",
  idle: "idle",
  erroring: "erroring",
};

/**
 * The invented set: ten generic agents over three sources, including one never run (a missing
 * figure is a dash). Canonical across governance pages; the environment is a column because ADR-128
 * keys on the pair.
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
    health: "responding",
    registeredDaysAgo: 320,
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
    health: "responding",
    registeredDaysAgo: 295,
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
    health: "responding",
    registeredDaysAgo: 210,
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
    // The case that proves health is stored rather than read off the clock:
    // active half an hour ago and failing, which no rule over
    // `lastActiveMinutesAgo` could ever tell apart from the two above.
    health: "erroring",
    registeredDaysAgo: 260,
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
    health: "idle",
    registeredDaysAgo: 150,
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
    health: "idle",
    registeredDaysAgo: 120,
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
    health: "responding",
    registeredDaysAgo: 88,
  },
  {
    id: "sample-it-triage",
    name: "it-service-triage",
    environment: "production",
    // Owned, and deliberately so. It leaves Copilot Studio as the one source with nothing unclaimed
    // behind it, which is what makes the "no agent matches these filters" state reachable at all:
    // every other source has an unclaimed agent, so before this the empty-filter branch could not
    // be reached with sample data on, and neither a reviewer nor a test could ever see it. A bot
    // built inside a service desk having an owner is also the likelier story.
    owner: "IT Service Desk",
    models: ["gpt-5-mini"],
    source: "copilot_studio",
    costUsd30d: null,
    requests30d: 15600,
    lastActiveMinutesAgo: 1500,
    health: "idle",
    registeredDaysAgo: 74,
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
    health: "idle",
    registeredDaysAgo: 45,
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
    // Never run, so nothing has measured its health. Not idle: idle is a
    // measurement of an agent that has run and stopped. It is the row that
    // keeps the strip's three health counts from adding up to the fleet, which
    // is the honest arithmetic rather than a rounding error.
    health: null,
    // It still registered, and recently — the one agent behind the fleet
    // card's "in the last thirty days".
    registeredDaysAgo: 11,
  },
];

/**
 * How long ago, in the words a reader would use. Whole units only: the reader
 * is deciding whether an agent is alive, not timing it.
 */
export function formatLastActive(minutesAgo: number | null): string | null {
  if (minutesAgo === null) return null;
  if (minutesAgo < 1) return "just now";
  if (minutesAgo < 60) return `${minutesAgo} ${minutesAgo === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.floor(minutesAgo / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

/**
 * How long ago the agent registered, coarser than `formatLastActive` and climbing to months and
 * years. Years count thirty-day months too, so no gap ever floors to "0 years ago".
 */
export function formatRegistered(daysAgo: number | null): string | null {
  if (daysAgo === null) return null;
  if (daysAgo < 1) return "today";
  if (daysAgo < 30) return `${daysAgo} ${daysAgo === 1 ? "day" : "days"} ago`;
  const months = Math.floor(daysAgo / 30);
  if (months < 12) return `${months} ${months === 1 ? "month" : "months"} ago`;
  const years = Math.floor(months / 12);
  return `${years} ${years === 1 ? "year" : "years"} ago`;
}
