/**
 * How a judgement is addressed on the way out: the cursor a caller pages
 * with, the filters a query splits into WHERE and HAVING, and the row shape
 * ClickHouse answers with.
 *
 * Separate from the repository so the class holds the two queries and nothing
 * else. What lives here is the part a caller can see: the cursor is opaque but
 * it is a contract, and which filter can use the index is a property of the
 * sort key rather than of the connection.
 *
 * @see ./instant-eval-judgments.repository.ts
 * @see ../../../clickhouse/migrations/00097_create_instant_eval_judgments.sql
 */

import type {
  InstantEvalJudgment,
  InstantEvalJudgmentQuery,
} from "./instant-eval-judgments.repository";
import type { InstantEvalJudgmentStatus } from "./judgments";

/** `TraceId`, `SpanId` and `QuestionId`, packed into one opaque token. */
export function encodeInstantEvalCursor(judgment: {
  traceId: string;
  spanId: string;
  questionId: string;
}): string {
  return Buffer.from(
    JSON.stringify([judgment.traceId, judgment.spanId, judgment.questionId]),
    "utf8",
  ).toString("base64url");
}

/** The cursor's three parts, or `null` when it is not one of ours. */
export function decodeInstantEvalCursor(
  cursor: string,
): { traceId: string; spanId: string; questionId: string } | null {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    if (!Array.isArray(parsed) || parsed.length !== 3) return null;
    const [traceId, spanId, questionId] = parsed;
    if (
      typeof traceId !== "string" ||
      typeof spanId !== "string" ||
      typeof questionId !== "string"
    ) {
      return null;
    }
    return { traceId, spanId, questionId };
  } catch {
    return null;
  }
}

export function parseProbabilities(
  value: unknown,
): Readonly<Record<string, number>> | null {
  if (typeof value !== "string" || value === "") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    // Shape-checked rather than cast: the column holds whatever the classifier
    // wrote, and an array or a string-valued map would otherwise reach the API
    // typed as a distribution it is not.
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
      return null;
    const entries = Object.entries(parsed);
    return entries.every(
      ([, probability]) =>
        typeof probability === "number" && Number.isFinite(probability),
    )
      ? Object.fromEntries(entries)
      : null;
  } catch {
    return null;
  }
}

export interface JudgmentRow {
  TraceId: string;
  QuestionId: string;
  ThreadId: string;
  SpanId: string;
  Kind: string;
  Status: string;
  Passed: number | null;
  Score: number | null;
  Label: string;
  Probability: number | null;
  Probabilities: string;
  Error: string;
  OccurredAt: string;
}

export function toJudgment(row: JudgmentRow): InstantEvalJudgment {
  return {
    traceId: row.TraceId,
    questionId: row.QuestionId,
    threadId: row.ThreadId,
    spanId: row.SpanId,
    kind: row.Kind,
    status: row.Status as InstantEvalJudgmentStatus,
    passed: row.Passed === null ? null : row.Passed === 1,
    score: row.Score,
    label: row.Label === "" ? null : row.Label,
    probability: row.Probability,
    probabilities: parseProbabilities(row.Probabilities),
    error: row.Error === "" ? null : row.Error,
    occurredAt: row.OccurredAt,
  };
}

/**
 * The predicates and bound parameters one query needs.
 *
 * Split by what each one can read. A filter on a sort-key column goes in
 * `WHERE`, where the index can use it; a filter on a verdict has to wait for
 * `HAVING`, because the verdict is an `argMax` over the versions of the row and
 * does not exist until the group is formed.
 */
export function buildFilters(query: InstantEvalJudgmentQuery): {
  where: string[];
  having: string[];
  parameters: Record<string, unknown>;
} {
  const where: string[] = [];
  const having: string[] = [];
  const parameters: Record<string, unknown> = {};

  if (query.questionId !== undefined) {
    where.push("QuestionId = {questionId:String}");
    parameters.questionId = query.questionId;
  }
  if (query.traceIds !== undefined) {
    where.push("TraceId IN ({traceIds:Array(String)})");
    parameters.traceIds = [...query.traceIds];
  }

  const cursor =
    query.cursor === undefined ? null : decodeInstantEvalCursor(query.cursor);
  if (cursor) {
    where.push(
      "(TraceId, SpanId, QuestionId) > ({after:String}, {afterS:String}, {afterQ:String})",
    );
    parameters.after = cursor.traceId;
    parameters.afterS = cursor.spanId;
    parameters.afterQ = cursor.questionId;
  }

  if (query.status !== undefined) {
    having.push("Status = {status:String}");
    parameters.status = query.status;
  }
  if (query.matched !== undefined) {
    // A match is a boolean question that passed. A score or category question
    // has no yes, so `matched` over one of those is the judged rows, which is
    // the same meaning `matchedByQuestion` carries for it.
    having.push(
      query.matched
        ? "(Passed = 1 OR (Kind != 'boolean' AND Status = 'judged'))"
        : "NOT (Passed = 1 OR (Kind != 'boolean' AND Status = 'judged'))",
    );
  }

  return { where, having, parameters };
}
