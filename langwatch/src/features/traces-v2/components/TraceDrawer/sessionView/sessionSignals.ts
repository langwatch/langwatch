import type { CodingAgentSessionRow } from "~/server/event-sourcing/pipelines/coding-agent-processing/projections/codingAgentSession.foldProjection";

/**
 * What's worth NOTICING about a coding-agent session.
 *
 * A wall of counters is not insight. Anyone can read "cache created: 318,404"
 * off a stat grid and learn nothing, because the number only means something
 * against the thing it should be compared to. The job of this module is to do
 * that comparison and say the sentence out loud: *this session paid to rebuild
 * its cache four times*, *you spent six minutes waiting to approve things*,
 * *it got cut off, so the answer is incomplete*.
 *
 * Deliberately a pure function of the row: no query, no hook, no JSX. That keeps
 * every rule below testable as an assertion about a session, which is exactly
 * what they are.
 */

export type SessionSignalTone = "danger" | "warning" | "info";

export interface SessionSignal {
  id: string;
  tone: SessionSignalTone;
  /** The finding, in the user's language. Never a field name. */
  title: string;
  /** The evidence for it. */
  detail: string;
}

/**
 * A cache read costs a fraction of fresh input; re-CREATING the cache costs more
 * than fresh input. So cache-creation tokens are the ones that quietly cost
 * money, and the ratio against reads is what says whether the session was
 * re-warming the cache repeatedly or just once at the start (which is normal and
 * unavoidable — every session pays for the first write).
 */
const CACHE_CHURN_RATIO = 0.25;

/** Below this there is nothing to say — a handful of tokens is not a story. */
const MIN_CACHE_CREATION_TOKENS = 20_000;

/** Waiting on a human for this long is friction worth surfacing. */
const NOTABLE_BLOCKED_MS = 60_000;

/** Retry time only reads as waste once it's a real slice of the session. */
const NOTABLE_RETRY_MS = 10_000;

/**
 * One rule per finding: when it applies, and how to say it. Order is the
 * order the signals render in, so severity reads top-down.
 */
interface SignalRule {
  id: string;
  tone: SessionSignalTone;
  applies: (row: CodingAgentSessionRow) => boolean;
  title: (row: CodingAgentSessionRow) => string;
  detail: (row: CodingAgentSessionRow) => string;
}

const SIGNAL_RULES: readonly SignalRule[] = [
  // The reply was CUT OFF. This is first because it changes how you read
  // everything else on the screen: the session did not finish, so its output
  // is not an answer.
  {
    id: "truncated",
    tone: "danger",
    applies: (row) => row.truncated,
    title: () => "The reply was cut off",
    detail: () =>
      "The model hit its output limit mid-answer, so the last reply is incomplete rather than finished.",
  },
  {
    id: "rate-limited",
    tone: "danger",
    applies: (row) => row.rateLimited > 0,
    title: (row) => `Rate limited ${row.rateLimited}×`,
    detail: () =>
      "The provider turned requests away. Time here is spent waiting, not working.",
  },
  {
    id: "retries-exhausted",
    tone: "danger",
    applies: (row) => row.retriesExhausted > 0,
    title: (row) => `Gave up after retrying ${row.retriesExhausted}×`,
    detail: () =>
      "A request kept failing until it ran out of attempts. Whatever it was doing did not happen.",
  },
  {
    id: "retry-time",
    tone: "warning",
    applies: (row) => row.retryMs >= NOTABLE_RETRY_MS,
    title: () => "Time spent retrying",
    detail: (row) =>
      `${formatShortDuration(row.retryMs)} went on retried requests — paid for, but produced nothing.`,
  },
  // The expensive mistake, and the one no raw token count shows.
  {
    id: "cache-churn",
    tone: "warning",
    applies: (row) =>
      row.cacheCreationTokens >= MIN_CACHE_CREATION_TOKENS &&
      row.cacheReadTokens > 0 &&
      row.cacheCreationTokens / row.cacheReadTokens >= CACHE_CHURN_RATIO,
    title: () => "The cache kept being rebuilt",
    detail: (row) =>
      `Rebuilding the cache cost ${formatCompact(row.cacheCreationTokens)} tokens against ` +
      `${formatCompact(row.cacheReadTokens)} reused — and rebuilding costs more per token than reusing. ` +
      "A long session that keeps re-warming its cache pays for the same context repeatedly.",
  },
  {
    id: "compacted",
    tone: "info",
    applies: (row) => row.compactions > 0,
    title: (row) =>
      row.compactions === 1
        ? "The conversation was compacted"
        : `The conversation was compacted ${row.compactions}×`,
    detail: () =>
      "It outgrew the context window and older detail was summarised away. Anything the agent forgot after this point, it forgot here.",
  },
  // Pure friction: the agent was idle and so was the person.
  {
    id: "blocked-on-user",
    tone: "warning",
    applies: (row) => row.blockedOnUserMs >= NOTABLE_BLOCKED_MS,
    title: () => "Waiting for approval",
    detail: (row) =>
      `${formatShortDuration(row.blockedOnUserMs)} of this session was the agent sitting idle, waiting for someone to approve a tool.`,
  },
  {
    id: "tools-denied",
    tone: "info",
    applies: (row) => row.toolsDenied > 0,
    title: (row) =>
      `${row.toolsDenied} ${row.toolsDenied === 1 ? "action was" : "actions were"} declined`,
    detail: () =>
      "Someone said no. Those actions never ran, so they leave no other trace in this session.",
  },
  {
    id: "hooks-blocked",
    tone: "info",
    applies: (row) => row.hooksBlocked > 0,
    title: (row) =>
      `Guardrails blocked ${row.hooksBlocked} ${row.hooksBlocked === 1 ? "action" : "actions"}`,
    detail: () => "Your own rules stopped the agent before the action ran.",
  },
  {
    id: "failed-tools",
    tone: "warning",
    applies: (row) => row.failedTools > 0,
    title: (row) => `${row.failedTools} of ${row.toolCalls} actions failed`,
    detail: (row) => describeErrorTypes(row.errorTypes),
  },
  {
    id: "refusals",
    tone: "warning",
    applies: (row) => row.refusals > 0,
    title: (row) =>
      `The model declined ${row.refusals} ${row.refusals === 1 ? "request" : "requests"}`,
    detail: (row) =>
      row.refusalCategories.length > 0
        ? row.refusalCategories.join(", ")
        : "The model would not answer.",
  },
  // An escalation worth auditing: the session ended somewhere more permissive
  // than it started.
  {
    id: "permission-changed",
    tone: "info",
    applies: (row) => row.permissionChanges > 0 && row.permissionMode !== "",
    title: () => "Approval settings changed mid-session",
    detail: (row) =>
      `Changed ${row.permissionChanges}× — it ended in ${row.permissionMode}.`,
  },
];

export function deriveSessionSignals(
  row: CodingAgentSessionRow,
): SessionSignal[] {
  return SIGNAL_RULES.filter((rule) => rule.applies(row)).map((rule) => ({
    id: rule.id,
    tone: rule.tone,
    title: rule.title(row),
    detail: rule.detail(row),
  }));
}

function describeErrorTypes(errorTypes: Record<string, number>): string {
  const entries = Object.entries(errorTypes).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return "The failures carried no error type.";
  return entries.map(([type, count]) => `${type} ×${count}`).join(", ");
}

/** e.g. `8.1M`, `318k`, `942`. */
export function formatCompact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(value);
}

/** e.g. `1h 4m`, `6m 12s`, `840ms`. */
export function formatShortDuration(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  const totalSeconds = Math.round(ms / 1_000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
