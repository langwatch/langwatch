/**
 * What recall reuses and what a judged miss is kept as (ADR-189 section 2): the latest judged
 * row of a key, the verdict it stands for, and the row a fresh judgement is written as.
 * @see modules/instant-eval/specs/instant-eval-results.feature
 */

import type {
  InstantEvalJudgmentStatus,
  InstantEvalResultSource,
} from "@langwatch/instant-eval-contract";
import type { InstantEvalVerdict } from "@langwatch/instant-eval-judge-contract";

import type {
  EvalResultRecord,
  RecalledEvalResult,
} from "../repositories/eval-results.repository.ts";
import { EVAL_RESULTS_KEY_VERSION, type EvalResultsCellKey } from "./eval-results-key.rules.ts";
import type { InstantEvalRunQuestion } from "./instant-eval-run-questions.rules.ts";

type EvalResultOrder = Pick<RecalledEvalResult, "judgedAt" | "updatedAt" | "sourceId">;

/**
 * Whether `candidate` is later than `current`: by `JudgedAt`, then `UpdatedAt`, then the
 * greatest `SourceId`, so two rows judged in the same millisecond still pick the same one.
 */
export function isLaterEvalResult({
  candidate,
  current,
}: {
  candidate: EvalResultOrder;
  current: EvalResultOrder;
}): boolean {
  if (candidate.judgedAt !== current.judgedAt) return candidate.judgedAt > current.judgedAt;
  if (candidate.updatedAt !== current.updatedAt) return candidate.updatedAt > current.updatedAt;
  return candidate.sourceId > current.sourceId;
}

/** The latest of one key's judged rows; empty when it has none. */
export function pickLatestEvalResult<T extends EvalResultOrder>(rows: readonly T[]): readonly T[] {
  let latest: T | undefined;
  for (const row of rows) {
    if (!latest || isLaterEvalResult({ candidate: row, current: latest })) latest = row;
  }
  return latest ? [latest] : [];
}

/** The verdict a recalled row stands for, filed under the question asking it now. */
export function recalledEvalResultVerdict({
  recalled,
  questionId,
}: {
  recalled: RecalledEvalResult;
  questionId: string;
}): InstantEvalVerdict {
  return {
    questionId,
    ...(recalled.probability === null ? {} : { probability: recalled.probability }),
    ...(recalled.score === null ? {} : { score: recalled.score }),
    ...(recalled.label === null ? {} : { label: recalled.label }),
    ...(recalled.probabilities === null ? {} : { probabilities: recalled.probabilities }),
  };
}

/** What one judge call answered for one question: a verdict, or the reason it gave none. */
export interface EvalResultOutcome {
  readonly verdict?: InstantEvalVerdict;
  readonly skippedReason?: string;
}

/** Answered is judged; a lost call failed; anything else the judge declined. */
function statusOf({ verdict, skippedReason }: EvalResultOutcome): InstantEvalJudgmentStatus {
  if (verdict) return "judged";
  return skippedReason === "classifier_failed" ? "failed" : "skipped";
}

/** One judged miss as the row it is kept as, stamped with the current key version. */
export function evalResultRecordOf({
  tenantId,
  key,
  question,
  judgeModel,
  source,
  outcome,
  judgedAt,
  retentionDays,
}: {
  tenantId: string;
  key: EvalResultsCellKey;
  question: Pick<InstantEvalRunQuestion, "kind" | "question">;
  judgeModel: string;
  source: { kind: InstantEvalResultSource; id: string };
  outcome: EvalResultOutcome;
  /** Epoch milliseconds; also the write clock. */
  judgedAt: number;
  retentionDays: number;
}): EvalResultRecord {
  const { verdict } = outcome;

  return {
    TenantId: tenantId,
    TraceId: key.traceId,
    SpanId: key.spanId,
    QuestionHash: key.questionHash,
    Question: question.question.instructions,
    Kind: question.kind,
    JudgeModel: judgeModel,
    InputHash: key.inputHash,
    JudgedColumn: key.judgedColumn,
    KeyVersion: EVAL_RESULTS_KEY_VERSION,
    Source: source.kind,
    SourceId: source.id,
    Status: statusOf(outcome),
    Score: verdict?.score ?? null,
    Label: verdict?.label ?? "",
    Probability: verdict?.probability ?? null,
    Probabilities: verdict?.probabilities ? JSON.stringify(verdict.probabilities) : "",
    Error: verdict ? "" : (outcome.skippedReason ?? ""),
    OccurredAt: key.occurredAt,
    JudgedAt: judgedAt,
    UpdatedAt: judgedAt,
    _retention_days: retentionDays,
  };
}
