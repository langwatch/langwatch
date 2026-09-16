/**
 * Context-window utilization banding by performance degradation curve; measures
 * `peakContextTokens` (max single call) against the session's widest context window.
 */

export type ContextHealthTone = "success" | "info" | "warning" | "danger";

export interface ContextHealthBand {
  tone: ContextHealthTone;
  label: string;
}

const STANDARD_CONTEXT_WINDOW_TOKENS = 200_000;
const EXTENDED_CONTEXT_WINDOW_TOKENS = 1_000_000;

/** Anthropic's own marker for the 1M-context beta on a raw model id, e.g. `claude-opus-4-8[1m]`. */
const EXTENDED_CONTEXT_MARKER = /\[1m\]/i;

/**
 * The context-window ceiling to measure `peakContextTokens` against: the
 * widest window among the session's models — if any call ran in the 1M beta,
 * that's the ceiling, even if earlier calls used the standard window.
 */
export function contextWindowCeiling(models: string[]): number {
  return models.some((model) => EXTENDED_CONTEXT_MARKER.test(model))
    ? EXTENDED_CONTEXT_WINDOW_TOKENS
    : STANDARD_CONTEXT_WINDOW_TOKENS;
}

/**
 * Bands a context-utilization ratio (0-1) into the reliability curve
 * currently discussed for long-context coding-agent sessions. See the module
 * docblock for where this comes from.
 */
export function contextHealthBand(ratio: number): ContextHealthBand {
  if (ratio < 0.2) {
    return { tone: "success", label: "Reliable" };
  }
  if (ratio < 0.4) {
    return { tone: "info", label: "Degrading" };
  }
  if (ratio < 0.6) {
    return { tone: "warning", label: "Unreliable" };
  }
  if (ratio < 0.8) {
    return { tone: "danger", label: "Broken" };
  }
  return { tone: "danger", label: "Irrecoverable" };
}
