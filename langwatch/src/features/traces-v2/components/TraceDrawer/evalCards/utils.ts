import type { EvalSummary } from "../../../types/trace";

export const STATUS = {
  pass: {
    color: "green.solid",
    fg: "green.fg",
    bg: "green.subtle",
    label: "PASS",
  },
  warning: {
    color: "yellow.solid",
    fg: "yellow.fg",
    bg: "yellow.subtle",
    label: "WARN",
  },
  fail: {
    color: "red.solid",
    fg: "red.fg",
    bg: "red.subtle",
    label: "FAIL",
  },
  // Evaluator wasn't run — provider not configured, preconditions failed,
  // etc. This is a setup state, not a verdict; rendering a 0.00/1.00 score
  // alongside it (the old behavior) lied about what happened.
  skipped: {
    color: "fg.subtle",
    fg: "fg.muted",
    bg: "bg.muted",
    label: "SKIPPED",
  },
  // Evaluator crashed. Distinct from a FAIL verdict — there is no score
  // because the evaluator never produced one.
  error: {
    color: "orange.solid",
    fg: "orange.fg",
    bg: "orange.subtle",
    label: "ERROR",
  },
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
