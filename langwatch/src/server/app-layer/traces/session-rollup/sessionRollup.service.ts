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
  CATEGORIES,
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
/** A step retaining less than this fraction of the running max is treated as a
 * subagent / parallel call (minimal sub-task context) and skipped, so a burst
 * of tiny subagent steps can't confirm each other into a phantom re-base.
 *
 * Accepted tradeoff: an AGGRESSIVE real compaction that re-bases below this floor
 * (e.g. 200k → 15k) is missed — counted conservatively as a subagent step. This
 * is the deliberate safe direction (ADR-033 Decision 5: "the naive version is
 * noise" — under-count over phantom events). No clean floor separates the two
 * cases: real subagent steps (~4% of max) and sub-10% compactions overlap, so
 * lowering the floor re-admits false positives. Tunable; a data-backed refinement
 * is a v1.1 candidate. */
export const COMPACTION_MIN_RETAIN_RATIO = 0.1;

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
 *
 * Returns both the event count and the final running max in ONE pass — the
 * max is a byproduct of the same walk, and computing it separately would mean
 * duplicating this loop (the subtlest logic in session tracking) and letting
 * the two copies drift.
 */
/**
 * A candidate drop at `candidateIdx` (already below `threshold`) is a confirmed
 * re-base iff the next `confirmationSteps` steps stay below the drop threshold,
 * OR the session ends still-compacted with at least one confirming step (an
 * end-of-session compaction that just ran out of runway). A step climbing back
 * to/above the threshold means the context returned — not a re-base.
 */
function isConfirmedCompaction(
  steps: SessionStep[],
  candidateIdx: number,
  threshold: number,
  confirmationSteps: number,
): boolean {
  let confirmed = 0;
  let j = candidateIdx + 1;
  for (; j < steps.length && confirmed < confirmationSteps; j++) {
    if (steps[j]!.inputTokens >= threshold) return false; // recovered
    confirmed++;
  }
  if (confirmed === confirmationSteps) return true;
  return j >= steps.length && confirmed >= 1; // ended still-compacted
}

export function detectCompactionEvents({
  steps,
  dropRatio = COMPACTION_DROP_RATIO,
  confirmationSteps = COMPACTION_CONFIRMATION_STEPS,
}: {
  steps: SessionStep[];
  dropRatio?: number;
  confirmationSteps?: number;
}): { events: number; runningMax: number } {
  // Defensive: a zero-token step is never a real context measurement (the fold
  // only appends steps with positive input), but stored history folded before
  // that guard can still carry them, and a 0 is always below any drop threshold
  // — so an unfiltered 0 reads as a phantom compaction candidate. Drop them
  // before the walk so the sawtooth is built from genuine measurements only.
  const positiveSteps = steps.filter((s) => s.inputTokens > 0);
  if (positiveSteps.length === 0) return { events: 0, runningMax: 0 };

  let events = 0;
  let runningMax = positiveSteps[0]!.inputTokens;
  const n = positiveSteps.length;

  for (let i = 1; i < n; i++) {
    const cur = positiveSteps[i]!.inputTokens;
    const threshold = (1 - dropRatio) * runningMax;

    if (cur >= threshold) {
      // No meaningful drop — grow the running max if this step is a new peak.
      if (cur > runningMax) runningMax = cur;
      continue;
    }

    // A step far below the running max is a SUBAGENT / parallel call (minimal
    // context of a focused sub-task), not a compaction of the main thread. Skip
    // it entirely: it neither fires an event nor moves the running max, so the
    // main thread resuming later reads against the unchanged max. This is what
    // the old below-old-max confirmation missed — the dominant pattern is a big
    // main turn (200k), SEVERAL small subagent steps (8k/10k/12k/14k), then the
    // main thread resuming (190k); those tiny steps confirmed each other under
    // the old rule and re-based the max to ~8k, so the resume read as growth.
    // A real compaction retains the system prompt + recent context (a meaningful
    // fraction of the max); a subagent step retains almost nothing. (Decision 5.)
    if (cur < COMPACTION_MIN_RETAIN_RATIO * runningMax) continue;

    // Candidate compaction: a significant-but-not-total drop. Only a confirmed
    // re-base fires an event and resets the max; unconfirmed candidates are
    // noise (the confirmation steps are re-visited by the outer loop).
    if (isConfirmedCompaction(positiveSteps, i, threshold, confirmationSteps)) {
      events++;
      runningMax = cur; // subsequent growth is measured from the compacted level
    }
  }

  return { events, runningMax };
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
 * merges the raw lifted `langwatch.thread.id`. Prefer the semconv-stable
 * `gen_ai.conversation.id` and fall back to `langwatch.thread.id` only when it
 * is absent — a trace carrying both with disagreeing values must key ONE
 * session, not silently split into two buckets. Whitespace-only ids are treated
 * as absent so they can't collapse every mis-tagged trace into one phantom
 * mega-session.
 */
function readThreadId(attributes: Record<string, string>): string | null {
  const conversation = attributes["gen_ai.conversation.id"]?.trim();
  if (conversation) return conversation;
  const thread = attributes["langwatch.thread.id"]?.trim();
  if (thread) return thread;
  return null;
}

/** Closed set of taxonomy values, so an unknown blockcat suffix is skipped
 * rather than blindly coerced into a category the rest of the app can't map. */
const CATEGORY_SET = new Set<string>(CATEGORIES);

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
    const rawCategory = suffix.slice(0, dotIdx);
    if (!CATEGORY_SET.has(rawCategory)) continue;
    const category = rawCategory as Category;
    const field = suffix.slice(dotIdx + 1);
    const value = Number(raw);
    // Floor at 0: tokens and cost are non-negative by construction, so a
    // negative (a classifier regression, a corrupt attr) is dropped rather than
    // subtracted out of a session's rollup totals.
    if (!Number.isFinite(value) || value < 0) continue;
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

    // ':' is collision-safe: harness is a closed enum with no ':' in any value.
    const key = `${harness}:${threadId}`;
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
    const { events, runningMax } = detectCompactionEvents({
      steps,
      dropRatio,
      confirmationSteps,
    });
    views.push({
      harness: group.harness,
      threadId: group.threadId,
      stepCount: steps.length,
      steps,
      runningMaxInputTokens: runningMax,
      compactionEvents: events,
      categoryTotals: group.categoryTotals,
    });
  }

  return views;
}
