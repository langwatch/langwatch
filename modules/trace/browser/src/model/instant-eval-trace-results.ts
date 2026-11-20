/**
 * How the drawer reads a trace's kept Instant Evals results (ADR-189 section 3): the question,
 * its verdict in words, and who asked, with which judge and when.
 * @see modules/trace/specs/trace-instant-eval-results.feature
 */
import type {
  InstantEvalTraceResultSource,
  InstantEvalTraceResultWire,
} from "@langwatch/instant-eval-contract";

const SOURCE_LABELS: Readonly<Record<InstantEvalTraceResultSource, string>> = {
  ask: "Ask",
  run: "Run",
  dashboard: "Dashboard",
};

/** One row of the drawer's Instant Evals section. */
export interface InstantEvalResultEntry {
  readonly key: string;
  readonly question: string;
  readonly verdict: string;
  readonly status: InstantEvalTraceResultWire["status"];
  readonly sourceLabel: string;
  readonly judgeModel: string;
  /** Epoch milliseconds. */
  readonly judgedAt: number;
  /** Absent for the trace's own text. */
  readonly spanId?: string;
  readonly judgedColumn: string;
}

/** The verdict in words: a boolean's likelihood, a score, a category, or why there is none. */
export function instantEvalVerdictLabel(
  result: Pick<InstantEvalTraceResultWire, "status" | "probability" | "score" | "label">,
): string {
  if (result.status === "failed") return "Could not judge";
  if (result.status === "skipped") return "Skipped";
  if (result.probability !== null) return `${Math.round(result.probability * 100)}% yes`;
  if (result.score !== null) return `Score ${result.score}`;
  if (result.label !== null) return result.label;
  return "No answer";
}

/** One kept result as the drawer lists it. */
export function toInstantEvalResultEntry(
  result: InstantEvalTraceResultWire,
): InstantEvalResultEntry {
  return {
    key: JSON.stringify([result.spanId, result.judgedColumn, result.question, result.judgedAt]),
    question: result.question,
    verdict: instantEvalVerdictLabel(result),
    status: result.status,
    sourceLabel: SOURCE_LABELS[result.source],
    judgeModel: result.judgeModel,
    judgedAt: result.judgedAt,
    ...(result.spanId === "" ? {} : { spanId: result.spanId }),
    judgedColumn: result.judgedColumn,
  };
}
