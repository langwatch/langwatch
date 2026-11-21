/**
 * Where every trace-linked Instant Evals result is kept (ADR-189): append-only, and recalled by
 * trace, question, judge model and judged text before anything is judged again.
 * @see packages/clickhouse-migrations/migrations/00132_create_eval_results.sql
 */

import type {
  InstantEvalJudgmentStatus,
  InstantEvalResultSource,
} from "@langwatch/instant-eval-contract";

/** One row of `eval_results`, in the table's own spelling. Times are epoch milliseconds. */
export interface EvalResultRecord {
  readonly TenantId: string;
  readonly TraceId: string;
  readonly SpanId: string;
  readonly QuestionHash: string;
  /** The question as the customer wrote it: tenant data, never the judged text. */
  readonly Question: string;
  readonly Kind: string;
  readonly JudgeModel: string;
  readonly InputHash: string;
  readonly JudgedColumn: string;
  readonly KeyVersion: number;
  readonly Source: InstantEvalResultSource;
  readonly SourceId: string;
  readonly Status: InstantEvalJudgmentStatus;
  readonly Score: number | null;
  readonly Label: string;
  readonly Probability: number | null;
  readonly Probabilities: string;
  readonly Error: string;
  readonly OccurredAt: number;
  readonly JudgedAt: number;
  readonly UpdatedAt: number;
  /** The project's trace retention when written; 0 keeps the row until it is deleted. */
  readonly _retention_days: number;
}

/** What a recall matches one cell on; the judge model and key version are the batch's. */
export interface EvalResultsMatchKey {
  readonly traceId: string;
  /** Empty for a trace's text. */
  readonly spanId: string;
  readonly questionHash: string;
  readonly inputHash: string;
}

/** The verdict recall reuses: the latest judged row of one key. */
export interface RecalledEvalResult extends EvalResultsMatchKey {
  readonly sourceId: string;
  readonly score: number | null;
  readonly label: string | null;
  readonly probability: number | null;
  readonly probabilities: Readonly<Record<string, number>> | null;
  readonly judgedAt: number;
  readonly updatedAt: number;
}

export interface EvalResultsRecallQuery {
  readonly tenantId: string;
  readonly judgeModel: string;
  readonly keyVersion: number;
  readonly keys: readonly EvalResultsMatchKey[];
  /** Epoch milliseconds bounding the keys' trace times: what prunes the partitions. */
  readonly occurredFrom: number;
  readonly occurredUntil: number;
}

/** What a trace's drawer reads: one trace, the current key version, the trace's time window. */
export interface EvalResultsTraceQuery {
  readonly tenantId: string;
  readonly traceId: string;
  readonly keyVersion: number;
  /** Epoch milliseconds bounding the rows' trace times: what prunes the partitions. */
  readonly occurredFrom: number;
  readonly occurredUntil: number;
}

/** The latest result of one span, question and judged column on a trace. */
export interface EvalTraceResult {
  readonly spanId: string;
  readonly questionHash: string;
  readonly judgedColumn: string;
  readonly question: string;
  readonly kind: string;
  readonly status: InstantEvalJudgmentStatus;
  readonly probability: number | null;
  readonly score: number | null;
  readonly label: string | null;
  readonly judgeModel: string;
  readonly source: InstantEvalResultSource;
  readonly sourceId: string;
  readonly judgedAt: number;
  readonly updatedAt: number;
}

export interface EvalResultsRepository {
  /** Every row in as few inserts as the partition limit allows. */
  insert(records: readonly EvalResultRecord[]): Promise<void>;
  /**
   * Per key, the judged row with the latest `JudgedAt`, then `UpdatedAt`, then the greatest
   * `SourceId`. Failed and skipped rows are never returned: they must not block a retry.
   */
  findLatestJudged(query: EvalResultsRecallQuery): Promise<readonly RecalledEvalResult[]>;
  /**
   * Per span, question and judged column of one trace, newest first: the latest judged row by
   * `JudgedAt`, `UpdatedAt`, then `SourceId`, or the latest failed or skipped one where none was
   * judged. Monitor rows are never returned: the trace shows them from evaluation_runs.
   */
  findLatestByTrace(query: EvalResultsTraceQuery): Promise<readonly EvalTraceResult[]>;
  /** Judged rows, one per question per judged text, judged since `since` (epoch ms) when given. */
  countJudged(input: { projectIds: readonly string[]; since?: number }): Promise<number>;
}
