/**
 * Read-time coding-agent session rollup (ADR-033 Decision 4/5, PR C).
 *
 * Pure functions that turn a set of lean trace summaries — each carrying a
 * thread id, a harness marker, a per-trace step series (`sessionSteps.ts`), and
 * per-category blockcat totals — into per-session views keyed by
 * `(harness, threadId)`. This is the realisation of the ADR's "session-level
 * fold": rather than a session-keyed fold projection (which the fold framework
 * cannot express — it keys strictly by traceId, and a second event per span was
 * rejected in Decision 1), sessions are reconstructed at read time by grouping
 * trace summaries on their thread id. For Claude Code a session already lives in
 * one trace summary; for Codex the session is fragmented across traces and this
 * rollup re-joins the fragments.
 *
 * Input is trace SUMMARIES (lean rows), never stored spans — the read-time
 * pattern rejected in Decision 1 concerned re-scanning millions of span rows,
 * which this does not do.
 *
 * Analytics only — these numbers never feed billing, quotas, or plan limits.
 */

import {
  type Category,
  SPAN_ATTR_BLOCKCAT_PREFIX,
} from "../block-classification/categories";
import type { CodingAgentHarness } from "../block-classification/harnessDetection";
import {
  parseSessionSteps,
  SESSION_HARNESS_ATTR,
  SESSION_STEPS_ATTR,
  type SessionStep,
} from "./sessionSteps";

/** ADR-033 Constants: compaction-event detection thresholds. */
export const COMPACTION_DROP_RATIO = 0.4;
export const COMPACTION_CONFIRMATION_STEPS = 2;

/** Per-category token + cost totals, summed across a session's traces. */
export type SessionCategoryTotals = Partial<
  Record<Category, { tokens: number; costUsd: number }>
>;

/** A reconstructed coding-agent session view (ADR-033 Schema, session fold). */
export interface SessionView {
  harness: CodingAgentHarness;
  threadId: string;
  /** LLM API steps across every trace in the session. */
  stepCount: number;
  /** Every step, ordered by span start time (out-of-order arrival safe). */
  steps: SessionStep[];
  /** Compaction baseline after the last event (Decision 5). */
  runningMaxInputTokens: number;
  /** Confirmed context re-bases across the session. */
  compactionEvents: number;
  /** Per-category totals summed across the session's traces. */
  categoryTotals: SessionCategoryTotals;
}

/** The lean per-trace input the rollup consumes — just the attribute map. */
export interface SessionRollupTraceInput {
  attributes: Record<string, string>;
}

/**
 * Detect compaction events over a step series (ADR-033 Decision 5) — the heart
 * of session tracking, kept a standalone pure function so it can be tested
 * directly.
 *
 * A compaction event is a genuine context re-base, not one small step:
 *   - Track the session's **running maximum** input size across steps.
 *   - A step whose input tokens fall below `(1 − dropRatio) × runningMax` is a
 *     *candidate* drop.
 *   - It is only confirmed when the next `confirmationSteps` steps ALL stay
 *     below the old running max (the session really re-based — it was not one
 *     small parallel/subagent request). Only then is one event counted and the
 *     running max reset to the compacted level.
 *   - A small subagent step followed by a return to the prior size fails
 *     confirmation, so it never fires an event and never resets the max.
 *
 * Steps are assumed already ordered by start time (the rollup sorts before
 * calling; a direct caller must pass them ordered).
 */
export function detectCompactionEvents({
  steps,
  dropRatio = COMPACTION_DROP_RATIO,
  confirmationSteps = COMPACTION_CONFIRMATION_STEPS,
}: {
  steps: SessionStep[];
  dropRatio?: number;
  confirmationSteps?: number;
}): number {
  if (steps.length === 0) return 0;

  let events = 0;
  let runningMax = steps[0]!.inputTokens;

  for (let i = 1; i < steps.length; i++) {
    const cur = steps[i]!.inputTokens;
    const threshold = (1 - dropRatio) * runningMax;

    if (cur >= threshold) {
      // No meaningful drop — grow the running max if this step is a new peak.
      if (cur > runningMax) runningMax = cur;
      continue;
    }

    // Candidate drop: confirm the next `confirmationSteps` steps stay below the
    // OLD max. A single step climbing back to (or above) the old max means this
    // was a small parallel step, not a compaction — the max never resets.
    let confirmed = 0;
    for (
      let j = i + 1;
      j < steps.length && confirmed < confirmationSteps;
      j++
    ) {
      if (steps[j]!.inputTokens >= runningMax) break;
      confirmed++;
    }

    if (confirmed === confirmationSteps) {
      events++;
      // Re-base to the compacted level; subsequent growth is measured from here.
      runningMax = cur;
    }
    // Unconfirmed candidates are noise: no event, no reset. The confirmation
    // steps are re-visited by the outer loop and rebuild the max normally.
  }

  return events;
}

/**
 * The final running max a full compaction pass would leave, exposed on the
 * view. Recomputed here (rather than threaded out of `detectCompactionEvents`)
 * to keep the detector a single-purpose counter.
 */
function finalRunningMax({
  steps,
  dropRatio,
  confirmationSteps,
}: {
  steps: SessionStep[];
  dropRatio: number;
  confirmationSteps: number;
}): number {
  if (steps.length === 0) return 0;
  let runningMax = steps[0]!.inputTokens;
  for (let i = 1; i < steps.length; i++) {
    const cur = steps[i]!.inputTokens;
    const threshold = (1 - dropRatio) * runningMax;
    if (cur >= threshold) {
      if (cur > runningMax) runningMax = cur;
      continue;
    }
    let confirmed = 0;
    for (
      let j = i + 1;
      j < steps.length && confirmed < confirmationSteps;
      j++
    ) {
      if (steps[j]!.inputTokens >= runningMax) break;
      confirmed++;
    }
    if (confirmed === confirmationSteps) runningMax = cur;
  }
  return runningMax;
}

/** Read the harness marker off a trace summary's attributes, if present. */
function readHarness(
  attributes: Record<string, string>,
): CodingAgentHarness | null {
  const value = attributes[SESSION_HARNESS_ATTR];
  return value === "claude" || value === "codex" ? value : null;
}

/**
 * Read the session/thread id off a trace summary. The span path maps thread id
 * onto `gen_ai.conversation.id` (accumulation allowlist); the Path B log path
 * merges the raw lifted `langwatch.thread.id`. Read both so either origin keys
 * the same session.
 */
function readThreadId(attributes: Record<string, string>): string | null {
  return (
    attributes["langwatch.thread.id"] ||
    attributes["gen_ai.conversation.id"] ||
    null
  );
}

/** Sum this trace's per-category blockcat totals into the running session map. */
function accumulateCategoryTotals(
  into: SessionCategoryTotals,
  attributes: Record<string, string>,
): void {
  for (const [key, raw] of Object.entries(attributes)) {
    if (!key.startsWith(SPAN_ATTR_BLOCKCAT_PREFIX)) continue;
    const suffix = key.slice(SPAN_ATTR_BLOCKCAT_PREFIX.length);
    const dotIdx = suffix.lastIndexOf(".");
    if (dotIdx <= 0) continue;
    const category = suffix.slice(0, dotIdx) as Category;
    const field = suffix.slice(dotIdx + 1);
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    const bucket = (into[category] ??= { tokens: 0, costUsd: 0 });
    if (field === "tokens") bucket.tokens += value;
    else if (field === "cost_usd") bucket.costUsd += value;
  }
}

/**
 * Roll a set of trace summaries up into per-session views keyed by
 * `(harness, threadId)`. Traces without both a harness marker and a thread id
 * carry no session steps and are skipped. Steps from every trace in a session
 * are concatenated then sorted by start time before compaction detection, so
 * out-of-order OTLP delivery and Codex's fragmentation across traces are both
 * handled.
 */
export function rollupSessions({
  traces,
  dropRatio = COMPACTION_DROP_RATIO,
  confirmationSteps = COMPACTION_CONFIRMATION_STEPS,
}: {
  traces: SessionRollupTraceInput[];
  dropRatio?: number;
  confirmationSteps?: number;
}): SessionView[] {
  const byKey = new Map<
    string,
    {
      harness: CodingAgentHarness;
      threadId: string;
      steps: SessionStep[];
      categoryTotals: SessionCategoryTotals;
    }
  >();

  for (const trace of traces) {
    const { attributes } = trace;
    const harness = readHarness(attributes);
    const threadId = readThreadId(attributes);
    if (!harness || !threadId) continue;

    const key = `${harness} ${threadId}`;
    const group = byKey.get(key) ?? {
      harness,
      threadId,
      steps: [],
      categoryTotals: {},
    };
    group.steps.push(...parseSessionSteps(attributes[SESSION_STEPS_ATTR]));
    accumulateCategoryTotals(group.categoryTotals, attributes);
    byKey.set(key, group);
  }

  const views: SessionView[] = [];
  for (const group of byKey.values()) {
    const steps = [...group.steps].sort((a, b) => a.startMs - b.startMs);
    views.push({
      harness: group.harness,
      threadId: group.threadId,
      stepCount: steps.length,
      steps,
      runningMaxInputTokens: finalRunningMax({
        steps,
        dropRatio,
        confirmationSteps,
      }),
      compactionEvents: detectCompactionEvents({
        steps,
        dropRatio,
        confirmationSteps,
      }),
      categoryTotals: group.categoryTotals,
    });
  }

  return views;
}
