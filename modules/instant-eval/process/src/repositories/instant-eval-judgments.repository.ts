/**
 * Where a run's judgements are kept: insert-only, keyed so a redelivered page
 * re-inserts the same keys and the merge collapses them.
 * @see packages/clickhouse-migrations/migrations/00097_create_instant_eval_judgments.sql
 */

import type { InstantEvalJudgmentStatus } from "@langwatch/instant-eval-contract";
import type { Instant } from "@langwatch/time";

/** One row of `instant_eval_judgments`, in the table's own spelling. */
export interface InstantEvalJudgmentRecord {
  readonly TenantId: string;
  readonly RunId: string;
  readonly TraceId: string;
  readonly QuestionId: string;
  readonly ThreadId: string;
  readonly SpanId: string;
  readonly Kind: string;
  readonly Status: InstantEvalJudgmentStatus;
  readonly Passed: number | null;
  readonly Score: number | null;
  readonly Label: string;
  readonly Probability: number | null;
  readonly Probabilities: string;
  readonly Error: string;
  readonly OccurredAt: number;
  readonly CreatedAt: number;
  readonly UpdatedAt: number;
}

/** One judgement as a caller reads it. */
export interface InstantEvalJudgment {
  readonly traceId: string;
  readonly questionId: string;
  readonly threadId: string;
  readonly spanId: string;
  readonly kind: string;
  readonly status: InstantEvalJudgmentStatus;
  readonly passed: boolean | null;
  readonly score: number | null;
  readonly label: string | null;
  readonly probability: number | null;
  /** The full distribution of a category answer, parsed back from its JSON. */
  readonly probabilities: Readonly<Record<string, number>> | null;
  readonly error: string | null;
  readonly occurredAt: string;
}

/** One page of judgements, and where the next one starts. */
export interface InstantEvalJudgmentPage {
  readonly judgments: readonly InstantEvalJudgment[];
  /** Absent on the last page. */
  readonly nextCursor?: string;
}

export interface InstantEvalJudgmentQuery {
  readonly projectId: string;
  readonly runId: string;
  /** The window the run's judgements were written in. */
  readonly writtenFrom: Instant;
  readonly writtenUntil: Instant;
  readonly limit: number;
  readonly questionId?: string;
  /** Only judgements that matched, or only those that did not. */
  readonly matched?: boolean;
  readonly status?: InstantEvalJudgmentStatus;
  readonly cursor?: string;
  /** Only these traces, which is how a sample reads its own rows. */
  readonly traceIds?: readonly string[];
}

/** What a sample asks for, which is a few whole traces rather than a page. */
export interface InstantEvalJudgmentSampleQuery {
  readonly projectId: string;
  readonly runId: string;
  readonly writtenFrom: Instant;
  readonly writtenUntil: Instant;
  /** Traces to pick. Every judgement of a picked trace comes back. */
  readonly traces: number;
  /**
   * Put traces with a boolean match first: what a sample is read for is
   * whether the run answered the question that was meant, and the rows
   * carrying that answer are the ones that matched.
   */
  readonly shouldPreferMatched: boolean;
  /** Varies which traces a repeated call picks. */
  readonly seed: number;
}

export interface InstantEvalJudgmentsRepository {
  insert(records: readonly InstantEvalJudgmentRecord[]): Promise<void>;
  getPage(query: InstantEvalJudgmentQuery): Promise<InstantEvalJudgmentPage>;
  /**
   * A few whole traces of a run, chosen pseudo-randomly. Not the first page
   * of {@link InstantEvalJudgmentsRepository.getPage}: that is ordered by the
   * sort key, so a sample would only ever show one corner of the run.
   */
  findSample(query: InstantEvalJudgmentSampleQuery): Promise<readonly InstantEvalJudgment[]>;
  /** The usage report's figure: judgements written since `since` (epoch ms). */
  countUsage(input: { projectIds: readonly string[]; since?: number }): Promise<number>;
}
