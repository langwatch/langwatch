import type { CodingAgentSessionRow } from "~/server/event-sourcing/pipelines/trace-processing/projections/codingAgentSession.foldProjection";

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

export function deriveSessionSignals(
  row: CodingAgentSessionRow,
): SessionSignal[] {
  const signals: SessionSignal[] = [];

  // The reply was CUT OFF. This is first because it changes how you read
  // everything else on the screen: the session did not finish, so its output is
  // not an answer.
  if (row.truncated) {
    signals.push({
      id: "truncated",
      tone: "danger",
      title: "The reply was cut off",
      detail:
        "The model hit its output limit mid-answer, so the last reply is incomplete rather than finished.",
    });
  }

  if (row.rateLimited > 0) {
    signals.push({
      id: "rate-limited",
      tone: "danger",
      title: `Rate limited ${row.rateLimited}×`,
      detail:
        "The provider turned requests away. Time here is spent waiting, not working.",
    });
  }

  if (row.retriesExhausted > 0) {
    signals.push({
      id: "retries-exhausted",
      tone: "danger",
      title: `Gave up after retrying ${row.retriesExhausted}×`,
      detail:
        "A request kept failing until it ran out of attempts. Whatever it was doing did not happen.",
    });
  }

  if (row.retryMs >= NOTABLE_RETRY_MS) {
    signals.push({
      id: "retry-time",
      tone: "warning",
      title: "Time spent retrying",
      detail: `${formatShortDuration(row.retryMs)} went on retried requests — paid for, but produced nothing.`,
    });
  }

  // The expensive mistake, and the one no raw token count shows.
  if (
    row.cacheCreationTokens >= MIN_CACHE_CREATION_TOKENS &&
    row.cacheReadTokens > 0 &&
    row.cacheCreationTokens / row.cacheReadTokens >= CACHE_CHURN_RATIO
  ) {
    signals.push({
      id: "cache-churn",
      tone: "warning",
      title: "The cache kept being rebuilt",
      detail:
        `Rebuilding the cache cost ${formatCompact(row.cacheCreationTokens)} tokens against ` +
        `${formatCompact(row.cacheReadTokens)} reused — and rebuilding costs more per token than reusing. ` +
        "A long session that keeps re-warming its cache pays for the same context repeatedly.",
    });
  }

  if (row.compactions > 0) {
    signals.push({
      id: "compacted",
      tone: "info",
      title:
        row.compactions === 1
          ? "The conversation was compacted"
          : `The conversation was compacted ${row.compactions}×`,
      detail:
        "It outgrew the context window and older detail was summarised away. Anything the agent forgot after this point, it forgot here.",
    });
  }

  // Pure friction: the agent was idle and so was the person.
  if (row.blockedOnUserMs >= NOTABLE_BLOCKED_MS) {
    signals.push({
      id: "blocked-on-user",
      tone: "warning",
      title: "Waiting for approval",
      detail: `${formatShortDuration(row.blockedOnUserMs)} of this session was the agent sitting idle, waiting for someone to approve a tool.`,
    });
  }

  if (row.toolsDenied > 0) {
    signals.push({
      id: "tools-denied",
      tone: "info",
      title: `${row.toolsDenied} ${row.toolsDenied === 1 ? "action was" : "actions were"} declined`,
      detail:
        "Someone said no. Those actions never ran, so they leave no other trace in this session.",
    });
  }

  if (row.hooksBlocked > 0) {
    signals.push({
      id: "hooks-blocked",
      tone: "info",
      title: `Guardrails blocked ${row.hooksBlocked} ${row.hooksBlocked === 1 ? "action" : "actions"}`,
      detail: "Your own rules stopped the agent before the action ran.",
    });
  }

  if (row.failedTools > 0) {
    signals.push({
      id: "failed-tools",
      tone: "warning",
      title: `${row.failedTools} of ${row.toolCalls} actions failed`,
      detail: describeErrorTypes(row.errorTypes),
    });
  }

  if (row.refusals > 0) {
    signals.push({
      id: "refusals",
      tone: "warning",
      title: `The model declined ${row.refusals} ${row.refusals === 1 ? "request" : "requests"}`,
      detail:
        row.refusalCategories.length > 0
          ? row.refusalCategories.join(", ")
          : "The model would not answer.",
    });
  }

  // An escalation worth auditing: the session ended somewhere more permissive
  // than it started.
  if (row.permissionChanges > 0 && row.permissionMode) {
    signals.push({
      id: "permission-changed",
      tone: "info",
      title: "Approval settings changed mid-session",
      detail: `Changed ${row.permissionChanges}× — it ended in ${row.permissionMode}.`,
    });
  }

  return signals;
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
