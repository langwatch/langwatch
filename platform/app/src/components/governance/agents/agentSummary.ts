/**
 * The four figures the Agents page opens with, derived from the rows it is
 * about to list.
 *
 * DERIVED, NEVER INVENTED TWICE. The strip could have carried its own set of
 * plausible numbers, and it would have looked identical on the day it shipped
 * and drifted from the cards below it by the second change. Every figure here
 * is a fold over the same `GovernanceAgentRow` values the cards are drawn
 * from, so a reader who adds up the cards gets the strip, and the
 * organization-wide read that one day fills those rows lights the strip up
 * through this same function with nothing to go and change.
 *
 * PURE, AND SEPARATE FROM THE JSX. Everything the strip says — the counts, the
 * shares, the line and the caption — is decided here and asserted in
 * `__tests__/agentSummary.unit.test.ts` without rendering anything. What is
 * left in the page is placement.
 *
 * These are figures over the whole fleet, not over what the filter chips have
 * left on screen. The strip sits above the chips and answers "what is in this
 * organization"; a summary that shrank when the reader narrowed a filter would
 * be answering a different question in the same words.
 *
 * Spec: specs/ai-governance/dashboard/agents-page.feature
 */
import type { GovernanceSummaryTone } from "~/components/governance/summary";

import { sourcesPresentIn } from "./agentFilters";
import {
  AGENT_HEALTH_LABELS,
  AGENT_HEALTH_STATES,
  AGENT_SOURCE_LABELS,
  type AgentHealth,
  type GovernanceAgentRow,
} from "./agentRows";

/**
 * How far back the registration line reaches, and how coarsely.
 *
 * Twelve points a month apart. Fewer and the line is a zigzag that implies
 * precision the buckets do not have; more and a card-sized sparkline turns the
 * points into a smear. A month is also the unit the caption speaks in, so the
 * picture and the sentence under it are measured the same way.
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
  /** How many arrived recently, and what the line above is. */
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
 * A list of things, the way a person says it out loud.
 *
 * "Custom and Databricks", not "Custom, Databricks". The card has room for the
 * word and a reader should not have to parse punctuation to read a sentence.
 */
function spokenList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]!}`;
}

/**
 * The cumulative fleet size at each of the last twelve month boundaries.
 *
 * A row whose registration moment was never recorded is left off the line
 * entirely rather than dropped at one end of it: a line that placed unmeasured
 * agents at the oldest point would draw a fleet that has always existed, and
 * one that placed them at the newest would draw a stampede that never
 * happened.
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

/** The fleet card: how many there are, how that grew, and what changed lately. */
function summarizeFleet(rows: readonly GovernanceAgentRow[]): AgentFleetCount {
  const recent = rows.filter(
    (row) =>
      row.registeredDaysAgo !== null &&
      row.registeredDaysAgo <= RECENT_WINDOW_DAYS,
  ).length;

  const arrivals =
    recent === 0
      ? `No new agents in the last ${RECENT_WINDOW_DAYS} days`
      : `+${recent} in the last ${RECENT_WINDOW_DAYS} days`;

  return {
    count: rows.length,
    unit: rows.length === 1 ? "agent" : "agents",
    registrations: registrationCurve(rows),
    // Says cumulative out loud, because the series is. The first point counts
    // every agent registered by then, including ones from long before this
    // window, so "agents registered over the last twelve months" would name a
    // different and smaller number than the line draws. This is the sparkline's
    // only description for a reader who cannot see it.
    registrationsLabel: `Total agents registered, by month over the last ${REGISTRATION_MONTHS} months`,
    caption: `${arrivals} · registered over time`,
  };
}

/**
 * The health card: one line per state, always all three.
 *
 * A state with nothing in it still gets its line. Dropping it would make the
 * card change shape as the fleet changes, and — worse — would hide the fact
 * that zero agents are erroring, which is the single most reassuring number on
 * the page.
 *
 * The three counts need not add up to the fleet. An agent whose health nothing
 * has measured is counted in none of them, which is the honest arithmetic: it
 * is not idle, and calling it idle to make the column total would be the
 * quietest possible lie.
 */
function summarizeHealth(
  rows: readonly GovernanceAgentRow[],
): AgentStatusLine[] {
  return AGENT_HEALTH_STATES.map((state) => ({
    key: state,
    tone: HEALTH_TONES[state],
    count: rows.filter((row) => row.health === state).length,
    label: AGENT_HEALTH_LABELS[state],
  }));
}

/**
 * The ownership card: how many have an owner, and where the rest came from.
 *
 * The sources are on the unclaimed line because that is the line a reader acts
 * on. "Three unclaimed" tells an admin they have work; "three unclaimed, from
 * Databricks and Custom" tells them which two consoles to go and look in.
 */
function summarizeOwnership(
  rows: readonly GovernanceAgentRow[],
): AgentStatusLine[] {
  const unclaimed = rows.filter((row) => row.owner === null);
  const sources = sourcesPresentIn(unclaimed).map(
    (source) => AGENT_SOURCE_LABELS[source],
  );

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
      label:
        sources.length === 0
          ? "unclaimed"
          : `unclaimed, from ${spokenList(sources)}`,
    },
  ];
}

/**
 * The spend ranking: the three biggest, as shares of what we measured.
 *
 * The denominator is the measured spend, not the fleet's spend, because those
 * are not the same number and only one of them is knowable. An agent whose
 * cost the platform has not measured is left out of both the ranking and the
 * total — folding it in as zero would silently inflate every other agent's
 * share and present the result as a percentage of everything.
 */
function summarizeTopSpenders(
  rows: readonly GovernanceAgentRow[],
): AgentSpendLine[] {
  const measured = rows.filter(
    (row): row is GovernanceAgentRow & { costUsd30d: number } =>
      row.costUsd30d !== null,
  );
  const total = measured.reduce((sum, row) => sum + row.costUsd30d, 0);
  if (total <= 0) return [];

  return [...measured]
    .sort((a, b) => b.costUsd30d - a.costUsd30d)
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
 * The whole strip, from the rows.
 *
 * There is no "nothing measured" branch here on purpose. With no rows this
 * returns a fleet of zero and three empty health lines, and the page declines
 * to render any of it — the decision about whether an unmeasured organization
 * is worth four boxes belongs to the page, which is the only thing that knows
 * why its rows are empty.
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
