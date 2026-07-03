/**
 * Per-trace coding-agent step series (ADR-033 Decision 5, PR C).
 *
 * A **step** is one LLM API call. The trace fold appends each coding-agent
 * step's `{ startMs, inputTokens }` to a bounded reserved attribute on the
 * trace summary; a read-time rollup (`sessionRollup.service.ts`) later groups
 * these across traces by thread id to reconstruct the session's context-growth
 * curve and detect compaction events.
 *
 * Why on the trace summary and not a session-keyed fold: the fold framework
 * keys strictly by traceId. For Claude Code, a whole session's turns already
 * fold into one trace summary (log records are additive per trace); Codex
 * fragments a session across traces, which the read-time rollup re-joins by
 * thread id. A session-keyed fold would need a second event per span (rejected
 * in ADR-033 Decision 1). See the ADR Revisions v3 note.
 *
 * `inputTokens` is the step's **total input context** — fresh input plus
 * cache-read plus cache-creation tokens — not just the freshly-billed prefix.
 * Compaction is a drop in the *whole* prompt context; on a cached turn the
 * fresh `input_tokens` is tiny (just the new user message) while the real
 * context sits in the cache-read pool, so tracking fresh input alone would
 * read as a compaction on every turn. Summing the pools is the only signal
 * that reflects genuine context re-basing.
 *
 * The `reserved` prefix is mandatory: it is the only namespace
 * `stripReservedAttributes` scrubs from ingested SDK spans, so the step series
 * cannot be spoofed by customer-supplied attributes (same protection the
 * blockcat totals rely on).
 */

import type { CodingAgentHarness } from "../block-classification/harnessDetection";

/** One LLM API step's context size, ordered later by `startMs`. */
export interface SessionStep {
  /** Span/turn start time (unix ms) — the ordering key for the growth curve. */
  startMs: number;
  /** Total input context tokens for the step (fresh + cache-read + cache-creation). */
  inputTokens: number;
}

/** Bounded per-trace step-series attribute — JSON array of {@link SessionStep}. */
export const SESSION_STEPS_ATTR = "langwatch.reserved.session_steps";

/** Which coding-agent harness produced this trace's session steps. */
export const SESSION_HARNESS_ATTR = "langwatch.reserved.session.harness";

/**
 * Hard bound on the per-trace step array. Past the cap, adjacent pairs merge
 * keeping the larger input size (ADR-033 Schema, session-fold block): resolution
 * halves but the sawtooth shape — the growth/compaction signal — is preserved,
 * and fold-size pressure stays within ADR-021 limits.
 */
export const MAX_SESSION_STEPS = 512;

/** Parse the stored step-series attribute; tolerant of absent/garbage values. */
export function parseSessionSteps(raw: string | undefined): SessionStep[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const steps: SessionStep[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const { startMs, inputTokens } = entry as Record<string, unknown>;
    if (typeof startMs !== "number" || typeof inputTokens !== "number")
      continue;
    steps.push({ startMs, inputTokens });
  }
  return steps;
}

/**
 * Collapse a step array to half its length by merging adjacent pairs and
 * keeping the larger input size — preserving the sawtooth peaks that carry the
 * compaction signal. The earlier `startMs` of each pair is kept so ordering
 * survives the merge. A trailing odd element is carried through unmerged.
 *
 * Steps are sorted by `startMs` first: OTLP spans and log turns can arrive
 * out of chronological order, so pairing raw append-order neighbours could
 * merge a late-arriving early step with a distant one and corrupt the
 * preserved sawtooth. Sorting first makes each merged pair two chronological
 * neighbours, so the halved-resolution curve still tracks real context growth.
 */
function mergeAdjacentKeepMax(input: SessionStep[]): SessionStep[] {
  const steps = [...input].sort((a, b) => a.startMs - b.startMs);
  const merged: SessionStep[] = [];
  for (let i = 0; i < steps.length; i += 2) {
    const a = steps[i]!;
    const b = steps[i + 1];
    if (!b) {
      merged.push(a);
      continue;
    }
    merged.push({
      startMs: Math.min(a.startMs, b.startMs),
      inputTokens: Math.max(a.inputTokens, b.inputTokens),
    });
  }
  return merged;
}

/**
 * Append one coding-agent step to a trace's step series on the (mutable)
 * attribute map, stamping the harness marker. Keeps the array bounded at
 * {@link MAX_SESSION_STEPS} by merging adjacent pairs (keep-max) once it would
 * overflow. Pure aside from mutating the passed `attributes` object, which the
 * fold already treats as a fresh per-step copy.
 */
export function appendSessionStep({
  attributes,
  harness,
  startMs,
  inputTokens,
}: {
  attributes: Record<string, string>;
  harness: CodingAgentHarness;
  startMs: number;
  inputTokens: number;
}): void {
  const steps = parseSessionSteps(attributes[SESSION_STEPS_ATTR]);
  steps.push({ startMs, inputTokens });
  const bounded =
    steps.length > MAX_SESSION_STEPS ? mergeAdjacentKeepMax(steps) : steps;
  attributes[SESSION_STEPS_ATTR] = JSON.stringify(bounded);
  attributes[SESSION_HARNESS_ATTR] = harness;
}
