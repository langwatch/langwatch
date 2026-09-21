/**
 * How a judgement is addressed on the way out: the cursor a caller pages
 * with, the filters a query splits into WHERE and HAVING, and the row shape
 * ClickHouse answers with.
 */

import type { InstantEvalJudgmentStatus } from "@langwatch/instant-eval-contract";

import type {
  InstantEvalJudgment,
  InstantEvalJudgmentQuery,
} from "../instant-eval-judgments.repository.ts";

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
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
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

/**
 * The distribution a category column carries, shape-checked rather than cast:
 * the column holds whatever the judge wrote, and an array or a string-valued
 * map would otherwise reach the API typed as a distribution it is not.
 */
export function parseProbabilities(value: unknown): Readonly<Record<string, number>> | null {
  if (typeof value !== "string" || value === "") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const entries = Object.entries(parsed);
    return entries.every(
      ([, probability]) => typeof probability === "number" && Number.isFinite(probability),
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

const JUDGMENT_STATUSES: readonly string[] = ["judged", "skipped", "failed"];

function statusOf(value: string): InstantEvalJudgmentStatus {
  return JUDGMENT_STATUSES.includes(value) ? (value as InstantEvalJudgmentStatus) : "failed";
}

export function toJudgment(row: JudgmentRow): InstantEvalJudgment {
  return {
    traceId: row.TraceId,
    questionId: row.QuestionId,
    threadId: row.ThreadId,
    spanId: row.SpanId,
    kind: row.Kind,
    status: statusOf(row.Status),
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
 * The predicates one query needs, split by what each can read: a sort-key
 * filter goes in WHERE where the index uses it, a verdict filter in HAVING
 * because the verdict does not exist until the group is formed.
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

  const cursor = query.cursor === undefined ? null : decodeInstantEvalCursor(query.cursor);
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
    // has no yes, so `matched` over one of those is its judged rows.
    having.push(
      query.matched
        ? "(Passed = 1 OR (Kind != 'boolean' AND Status = 'judged'))"
        : "NOT (Passed = 1 OR (Kind != 'boolean' AND Status = 'judged'))",
    );
  }

  return { where, having, parameters };
}
