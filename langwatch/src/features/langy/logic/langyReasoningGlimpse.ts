/**
 * The reasoning GLIMPSE: what the collapsed thinking line shows of the model's
 * live reasoning, and when.
 *
 * The design (validated against reading research before it was built): text
 * that MOVES cannot be comfortably read — following drifting words demands a
 * smooth leftward eye pursuit while reading demands rightward saccades, and the
 * line sits in peripheral vision, which is motion-sensitive by design. So the
 * glimpse never scrolls and never ticks. Most of the time the line is just the
 * verb; every few seconds the latest COMPLETE thought surfaces — fades in,
 * holds long enough to read, dissolves — then quiet again. Opacity is the only
 * thing that ever animates, and only at those discrete moments.
 *
 * This module is the pure half: clause detection and fragment selection.
 * The timing loop and rendering live in the component
 * (`components/LangyThinkingLine.tsx`).
 */

/** How often a glimpse surfaces. Quiet the rest of the time. */
export const GLIMPSE_PERIOD_MS = 6_000;
/**
 * One glimpse's whole life — fade in, hold, fade out — as a single CSS
 * animation, so the hold cannot drift out of sync with the hide timer.
 */
export const GLIMPSE_LIFE_MS = 4_200;
/** A fragment longer than this gets trimmed to its freshest words. */
export const GLIMPSE_MAX_WORDS = 8;

// A thought is complete at sentence punctuation…
const SENTENCE_END = /[.!?…]$/;
// …or at a breath (comma, dash, colon) once it has enough words to stand alone.
const SOFT_BREAK = /[,;:—–]$/;
const SOFT_BREAK_MIN_WORDS = 7;
// A run with no punctuation at all still completes eventually.
const HARD_MAX_WORDS = 12;

/**
 * The latest COMPLETE clause in the accumulated reasoning, or null while the
 * model is still mid-thought on its first clause. Trailing words that haven't
 * completed a clause yet are deliberately excluded — a glimpse shows a thought,
 * not a stutter.
 */
export function latestCompleteClause(reasoning: string): string | null {
  const words = reasoning.split(/\s+/).filter(Boolean);
  let clause: string[] = [];
  let lastComplete: string | null = null;
  for (const word of words) {
    clause.push(word);
    const isEnd =
      SENTENCE_END.test(word) ||
      (SOFT_BREAK.test(word) && clause.length >= SOFT_BREAK_MIN_WORDS) ||
      clause.length >= HARD_MAX_WORDS;
    if (isEnd) {
      lastComplete = clause.join(" ");
      clause = [];
    }
  }
  return lastComplete;
}

/**
 * The fragment the next glimpse should show, or null when there is nothing
 * NEW to show (an unchanged thought must not re-surface — a repeated glimpse
 * reads as a stuck model).
 *
 * Preference order: the latest complete thought, trimmed to its final
 * {@link GLIMPSE_MAX_WORDS} words with a leading ellipsis; otherwise — when no
 * new thought has completed since the last glimpse but fresh words HAVE
 * arrived — a small ellipsed taste of those, so a long-running clause still
 * shows life.
 */
export function nextGlimpseFragment({
  reasoning,
  lastClauseShown,
  lastReasoningLength,
}: {
  reasoning: string;
  /** The clause the previous glimpse showed (untrimmed), or null. */
  lastClauseShown: string | null;
  /** `reasoning.length` at the previous glimpse, to detect fresh words. */
  lastReasoningLength: number;
}): { fragment: string; clause: string | null } | null {
  const clause = latestCompleteClause(reasoning);

  if (clause && clause !== lastClauseShown) {
    const words = clause.split(" ");
    const fragment =
      words.length > GLIMPSE_MAX_WORDS
        ? "…" + words.slice(-GLIMPSE_MAX_WORDS).join(" ")
        : clause;
    return { fragment, clause };
  }

  if (reasoning.length > lastReasoningLength) {
    const fresh = reasoning
      .split(/\s+/)
      .filter(Boolean)
      // Punctuation-only tokens (a lone em dash) carry nothing worth glimpsing.
      .map((w) => w.replace(/^[—–-]+$|^[.,;:!?…]+$/g, ""))
      .filter(Boolean)
      .slice(-4);
    if (fresh.length === 0) return null;
    const fragment =
      "…" + fresh.join(" ").replace(/[.,;:!?…]+$/, "") + "…";
    return { fragment, clause: lastClauseShown };
  }

  return null;
}
