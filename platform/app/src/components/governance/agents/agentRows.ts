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

/**
 * What an agent is doing right now, as one of three words.
 *
 * Stored rather than derived. "Responding" and "idle" could be read off
 * `lastActiveMinutesAgo`, but "erroring" cannot — an agent that answered a
 * minute ago and failed every one of those answers is recently active and
 * unhealthy at the same time — and a field that is half derived and half
 * stored is a field two readers disagree about. One source, so the three words
 * always agree with each other.
 */
export const AGENT_HEALTH_STATES = ["responding", "idle", "erroring"] as const;
export type AgentHealth = (typeof AGENT_HEALTH_STATES)[number];

/** Spelled out, never abbreviated — the words the summary strip says. */
export const AGENT_HEALTH_LABELS: Record<AgentHealth, string> = {
  responding: "responding",
  idle: "idle",
  erroring: "erroring",
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
  /**
   * See `AgentHealth`. `null` is an agent whose health nothing has measured,
   * which is a different fact from being idle and is counted as neither — so
   * the strip's three health counts need not add up to the fleet.
   */
  health: AgentHealth | null;
  /**
   * Days since the agent registered, or `null` if the registration moment was
   * never recorded. Days rather than a date for the same reason
   * `lastActiveMinutesAgo` is minutes: a fixed date in invented data goes
   * stale the week after it is written.
   *
   * The fleet card draws its registration line from this, so the read that
   * one day fills this shape fills the line with it.
   */
  registeredDaysAgo: number | null;
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
  if (minutesAgo < 60)
    return `${minutesAgo} ${minutesAgo === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.floor(minutesAgo / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

/**
 * How long the agent has been registered, in the words a reader would use.
 *
 * Coarser than `formatLastActive` on purpose, and it climbs to months and
 * years. "Last active" is how a reader decides whether an agent is alive, so
 * minutes matter there; how long ago it registered is context, and "320 days
 * ago" makes a reader do arithmetic that "10 months ago" does not.
 *
 * The list view draws its Registered column from this. The card has no room
 * for the column and does not show it, which is one of the two facts the list
 * exists to surface.
 *
 * Years are counted in the same thirty-day months this counts months in, not
 * in calendar years. Mixing the two units leaves a gap: a year measured as 365
 * days has not started yet when a twelfth thirty-day month has already ended,
 * so any day in that gap floors to zero and the reader is told "0 years ago".
 * One unit throughout cannot produce a zero.
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
