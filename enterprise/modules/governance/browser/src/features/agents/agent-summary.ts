/**
 * The Agents page's four figures, folded from the same rows the cards draw, so they cannot drift.
 * Pure and separate from the JSX; over the whole fleet, not the filtered view.
 * @see specs/ai-governance/dashboard/agents-page.feature
 */
import type { GovernanceSummaryTone } from "../../ui/elements/governance-summary-cards.tsx";
import { sourcesPresentIn } from "./agent-filters";
import {
  AGENT_HEALTH_LABELS,
  AGENT_HEALTH_STATES,
  AGENT_SOURCE_LABELS,
  type AgentHealth,
  type GovernanceAgentRow,
} from "./agent-rows";

/**
 * The registration line's reach: twelve points a month apart. Fewer implies false precision, more
 * smears a card-sized sparkline, and a month is the unit the caption speaks in.
 */
const REGISTRATION_MONTHS = 12;
const DAYS_PER_MONTH = 30;

/** The window the fleet caption reports, in days. */
const RECENT_WINDOW_DAYS = 30;

/** How many agents the ranking names before it stops being a ranking. */
const TOP_SPENDER_COUNT = 3;

/** The headline count on the fleet card, and the line and caption beneath it. */
export interface AgentFleetCount {
  count: number;
  /** "agents", or "agent" when there is exactly one. Never abbreviated. */
  unit: string;
  /**
   * Cumulative fleet size, oldest month first: how many agents had registered
   * by each point. It never falls, because an agent that registered stays
   * registered.
   */
  registrations: number[];
  /** What that line is a picture of, for a reader who cannot see it. */
  registrationsLabel: string;
  /**
   * How many arrived recently, what the line above is, and — when the two
   * describe different populations — which agents the line cannot include.
   */
  caption: string;
}

/** One line of a card's status list. */
export interface AgentStatusLine {
  /** Stable across renders. The React key, and nothing else reads it. */
  key: string;
  tone: GovernanceSummaryTone;
  count: number;
  /** What those agents are doing, in full words. */
  label: string;
}

/** One line of the spend ranking. */
export interface AgentSpendLine {
  key: string;
  name: string;
  /** A whole percent of the spend the platform measured. */
  sharePercent: number;
  /** That percent as the card draws it. */
  shareLabel: string;
}

export interface AgentFleetSummary {
  fleet: AgentFleetCount;
  /** Responding, idle and erroring, always all three and in that order. */
  health: AgentStatusLine[];
  /** Owned, then unclaimed with the sources those agents came from. */
  ownership: AgentStatusLine[];
  /** Biggest share first. Empty when no spend was measured at all. */
  topSpenders: AgentSpendLine[];
}

/**
 * How loudly each health state reads. A property of the state itself, not of
 * the page, so every governance surface that ever reports agent health reports
 * it in the same colours.
 */
const HEALTH_TONES: Record<AgentHealth, GovernanceSummaryTone> = {
  responding: "good",
  // Idle is neither healthy nor a problem. An agent nobody has called today is
  // a fact about the week, not a fault, and colouring it as one would train
  // readers to ignore the colour that means something is broken.
  idle: "neutral",
  erroring: "bad",
};

/**
 * A list the way a person says it: "Custom and Databricks". Exported for the page's empty states so
 * two items are never punctuated differently a few pixels apart.
 */
export function spokenList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]!}`;
}

/**
 * The cumulative fleet size at each of the last twelve month boundaries. Rows with no recorded
 * registration are left off the line rather than placed at either end, which would draw a false
 * history.
 */
function registrationCurve(rows: readonly GovernanceAgentRow[]): number[] {
  const registeredDaysAgo = rows
    .map((row) => row.registeredDaysAgo)
    .filter((days): days is number => days !== null);

  return Array.from({ length: REGISTRATION_MONTHS }, (_unused, index) => {
    const boundaryDaysAgo = (REGISTRATION_MONTHS - 1 - index) * DAYS_PER_MONTH;
    return registeredDaysAgo.filter((days) => days >= boundaryDaysAgo).length;
  });
}

/**
 * What the line and caption leave out, in the caption's words: provider-named agents have no
 * registration date, so naming the gap stops the headline and line from looking contradictory.
 */
function trendExclusion(rows: readonly GovernanceAgentRow[]): string {
  const undated = rows.filter((row) => row.registeredDaysAgo === null).length;
  return undated === 0
    ? ""
    : `, excluding ${undated} found at a provider with no registration date`;
}

/** The fleet card: how many there are, how that grew, and what changed lately. */
function summarizeFleet(rows: readonly GovernanceAgentRow[]): AgentFleetCount {
  const recent = rows.filter(
    (row) => row.registeredDaysAgo !== null && row.registeredDaysAgo <= RECENT_WINDOW_DAYS,
  ).length;

  const arrivals =
    recent === 0
      ? `No new agents in the last ${RECENT_WINDOW_DAYS} days`
      : `+${recent} in the last ${RECENT_WINDOW_DAYS} days`;

  // The same sentence in both places. A reader who hovers the line and a
  // reader who only reads the caption are told the same thing about the same
  // gap, rather than one of them finding out and the other not.
  const excluded = trendExclusion(rows);

  return {
    count: rows.length,
    unit: rows.length === 1 ? "agent" : "agents",
    registrations: registrationCurve(rows),
    // Says cumulative out loud, because the series is. The first point counts
    // every agent registered by then, including ones from long before this
    // window, so "agents registered over the last twelve months" would name a
    // different and smaller number than the line draws. This is the sparkline's
    // only description for a reader who cannot see it.
    registrationsLabel: `Total agents registered, by month over the last ${REGISTRATION_MONTHS} months${excluded}`,
    caption: `${arrivals} · registered over time${excluded}`,
  };
}

/**
 * The health card: always all three states, so the card keeps its shape and zero erroring is shown.
 * Counts need not sum to the fleet: unmeasured agents are in none, not called idle.
 */
function summarizeHealth(rows: readonly GovernanceAgentRow[]): AgentStatusLine[] {
  return AGENT_HEALTH_STATES.map((state) => ({
    key: state,
    tone: HEALTH_TONES[state],
    count: rows.filter((row) => row.health === state).length,
    label: AGENT_HEALTH_LABELS[state],
  }));
}

/**
 * The ownership card: owned count, and the unclaimed line names its sources, because that is the
 * line a reader acts on.
 */
function summarizeOwnership(rows: readonly GovernanceAgentRow[]): AgentStatusLine[] {
  const unclaimed = rows.filter((row) => row.owner === null);
  const sources = sourcesPresentIn(unclaimed).map((source) => AGENT_SOURCE_LABELS[source]);

  return [
    {
      key: "owned",
      tone: "good",
      count: rows.length - unclaimed.length,
      label: "owned",
    },
    {
      key: "unclaimed",
      // Attention rather than bad. An unclaimed agent is not broken, it is
      // unassigned, and it is the one thing on this card a person can fix.
      tone: "attention",
      count: unclaimed.length,
      label: sources.length === 0 ? "unclaimed" : `unclaimed, from ${spokenList(sources)}`,
    },
  ];
}

/**
 * The three biggest spenders as shares of MEASURED spend. Unmeasured agents are left out of the
 * ranking and the total; folding them in as zero would inflate every other share.
 */
function summarizeTopSpenders(rows: readonly GovernanceAgentRow[]): AgentSpendLine[] {
  const measured = rows.filter(
    (row): row is GovernanceAgentRow & { costUsd30d: number } => row.costUsd30d !== null,
  );
  const total = measured.reduce((sum, row) => sum + row.costUsd30d, 0);
  if (total <= 0) return [];

  return [...measured]
    .toSorted((a, b) => b.costUsd30d - a.costUsd30d)
    .slice(0, TOP_SPENDER_COUNT)
    .map((row) => {
      const sharePercent = Math.round((row.costUsd30d / total) * 100);
      return {
        key: row.id,
        name: row.name,
        sharePercent,
        shareLabel: `${sharePercent}%`,
      };
    });
}

/**
 * The whole strip, from the rows. No "nothing measured" branch: with no rows it returns zeros, and
 * the page, which knows why its rows are empty, decides whether to render.
 */
export function summarizeAgentFleet({
  rows,
}: {
  rows: readonly GovernanceAgentRow[];
}): AgentFleetSummary {
  return {
    fleet: summarizeFleet(rows),
    health: summarizeHealth(rows),
    ownership: summarizeOwnership(rows),
    topSpenders: summarizeTopSpenders(rows),
  };
}
