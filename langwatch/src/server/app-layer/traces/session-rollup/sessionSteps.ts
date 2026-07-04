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
 * keys strictly by traceId, and both harnesses fragment a session across
 * traces (the Claude Code reactor derives one trace per turn via
 * sha256(session:prompt); Codex fragments per rollout), so the read-time
 * rollup re-joins them by thread id. A session-keyed fold would need a second
 * event per span (rejected in ADR-033 Decision 1). See the ADR Revisions v3
 * note.
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
 * Hard bound on the per-trace step array. Past the cap, the series is halved by
 * min/max decimation (ADR-033 Schema, session-fold block): resolution halves but
 * BOTH the sawtooth peaks AND valleys — the growth AND compaction signal — are
 * preserved, and fold-size pressure stays within ADR-021 limits.
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
 * Halve a step array while preserving BOTH local extrema — peaks AND valleys —
 * via min/max decimation, so the compaction signal survives past the cap.
 *
 * The earlier keep-max merge kept only the larger of each adjacent pair, which
 * systematically ERASED the valleys: the post-compaction low points are exactly
 * what `detectCompactionEvents` reads a context re-base by, so a marathon session
 * past the cap lost its compaction events (the drops were merged away into the
 * neighbouring peaks). Min/max decimation instead buckets consecutive steps in
 * FOURS and emits each bucket's min and max in start-time order: the peaks keep
 * the running-max reference high and the valleys keep the drops, so the halved
 * series still traces the sawtooth the detector walks.
 *
 * Steps are start-time sorted first (OTLP spans and log turns arrive out of
 * chronological order), so each bucket is four chronological neighbours. A bucket
 * whose min and max coincide (a flat run, or a trailing partial bucket of one)
 * emits a single point. Output length ≤ ⌈N/2⌉, so one pass clears the cap.
 *
 * Residual limit: the two interior points of a four-step bucket are dropped, so
 * a second peak+valley pair inside one bucket loses resolution — an accepted
 * trade at the >512-step tail, and strictly better than erasing every valley.
 */
function downsampleKeepExtrema(input: SessionStep[]): SessionStep[] {
  const steps = [...input].sort((a, b) => a.startMs - b.startMs);
  const out: SessionStep[] = [];
  for (let i = 0; i < steps.length; i += 4) {
    let min = steps[i]!;
    let max = steps[i]!;
    for (let j = i + 1; j < i + 4 && j < steps.length; j++) {
      const s = steps[j]!;
      if (s.inputTokens < min.inputTokens) min = s;
      if (s.inputTokens > max.inputTokens) max = s;
    }
    if (min === max) {
      out.push(min);
    } else if (min.startMs <= max.startMs) {
      out.push(min, max);
    } else {
      out.push(max, min);
    }
  }
  return out;
}

/**
 * Append one coding-agent step to a trace's step series on the (mutable)
 * attribute map, stamping the harness marker. Keeps the array bounded at
 * {@link MAX_SESSION_STEPS} by min/max decimation (peaks AND valleys survive)
 * once it would overflow. Pure aside from mutating the passed `attributes`
 * object, which the fold already treats as a fresh per-step copy.
 *
 * Cost note: this parses + re-serialises the series each call, which the fold
 * deliberately avoided for its UNBOUNDED collections (events/spanCosts — see the
 * comment in traceSummary.foldProjection.ts). The difference that makes it safe
 * here is the {@link MAX_SESSION_STEPS} cap: the array never exceeds 512 tiny
 * `{startMs, inputTokens}` entries, so per-step work is O(min(steps, 512)) and
 * total folding is bounded — never the multi-MB-per-span blob those collections
 * grew into. A serialise-once rewrite would need a fold-framework finalize hook
 * (the attribute map is the per-step persisted snapshot); that's disproportionate
 * for a bounded cost, so it's an infra follow-up, not done here.
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
  // OTLP delivery is unordered/retried, so keep the stored series sorted by
  // startMs on every append — the ADR Schema promises a start-time-ordered
  // series, and consumers other than the rollup (which sorts defensively) read
  // it directly. Bounded at MAX_SESSION_STEPS, so the sort stays cheap.
  steps.sort((a, b) => a.startMs - b.startMs);
  const bounded =
    steps.length > MAX_SESSION_STEPS ? downsampleKeepExtrema(steps) : steps;
  attributes[SESSION_STEPS_ATTR] = JSON.stringify(bounded);
  attributes[SESSION_HARNESS_ATTR] = harness;
}
