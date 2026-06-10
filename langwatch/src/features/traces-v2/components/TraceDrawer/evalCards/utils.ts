import {
  EVALUATION_STATUS_COLORS,
  EVALUATION_STATUS_TONES,
} from "~/utils/evaluationResults";
import type { EvalSummary } from "../../../types/trace";

/**
 * Per-status tag rendering for the Evals accordion cards. Sourced from
 * the shared evaluation-results maps so dot / tag colours can't drift
 * out of step with the trace-list `EvalChip`, the v2 drawer header
 * chip, or the v3 EvaluatorChip — three surfaces that all need to
 * agree on "this verdict reads as X".
 */
function buildStatusTone(
  parsed: keyof typeof EVALUATION_STATUS_COLORS,
  label: string,
) {
  return {
    color: EVALUATION_STATUS_COLORS[parsed],
    fg: EVALUATION_STATUS_TONES[parsed].fg,
    bg: EVALUATION_STATUS_TONES[parsed].bg,
    label,
  } as const;
}

export const STATUS = {
  pass: buildStatusTone("passed", "PASS"),
  // "Warning" is a legacy trace-summary status with no v3 equivalent;
  // it reads as a not-quite-pass, so route it through the `failed` tone
  // so the chip still turns red rather than picking up a bespoke yellow.
  warning: buildStatusTone("failed", "WARN"),
  fail: buildStatusTone("failed", "FAIL"),
  // Evaluator wasn't run — provider not configured, preconditions failed,
  // etc. This is a setup state, not a verdict; gray-on-gray keeps it from
  // competing for attention next to real pass/fail rows.
  skipped: buildStatusTone("skipped", "SKIPPED"),
  // Evaluator crashed. Distinct from a FAIL verdict — uses the deeper
  // red.700 from the shared map so "the evaluator broke" reads as a
  // separate failure mode from "the evaluator ran and said no".
  error: buildStatusTone("error", "ERROR"),
} as const;

/**
 * "no verdict" states — the evaluator never produced a real score, so the
 * big numeric label, the /1.00 suffix, and the score bar are all
 * meaningless and should be suppressed.
 */
export function isNoVerdict(status: EvalSummary["status"]): boolean {
  return status === "skipped" || status === "error";
}

export interface EvalRunHistoryEntry {
  score: number | boolean;
  timestamp: number;
  status: string;
}

export type EvalEntry = EvalSummary & {
  evaluationId?: string;
  evaluatorId?: string;
  evaluatorType?: string;
  spanName?: string;
  spanId?: string;
  reasoning?: string;
  label?: string;
  passed?: boolean;
  inputs?: Record<string, unknown>;
  errorMessage?: string;
  errorStacktrace?: string[];
  retries?: number;
  executionTime?: number;
  evalCost?: number;
  runHistory?: EvalRunHistoryEntry[];
  timestamp?: number;
};

export function formatInputValue(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Group key for stacking: evaluatorId if known, else fall back to name. */
export function evalGroupKey(e: EvalEntry): string {
  return e.evaluatorId ?? `name:${e.name}`;
}
