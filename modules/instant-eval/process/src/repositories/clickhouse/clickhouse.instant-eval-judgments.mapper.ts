/**
 * How a judgement is addressed on the way out: the cursor a caller pages
 * with, the two built reads, and the row shape ClickHouse answers with.
 */

import {
  clickhouseRead,
  type Condition,
  type ConditionOps,
  fn,
  param,
  type ReaderReadStatement,
  tenantScope,
} from "@langwatch/clickhouse-client/builder";
import type { InstantEvalJudgmentStatus } from "@langwatch/instant-eval-contract";

import type {
  InstantEvalJudgment,
  InstantEvalJudgmentQuery,
  InstantEvalJudgmentSampleQuery,
} from "../instant-eval-judgments.repository.ts";
import { instantEvalJudgments as judgments } from "./clickhouse.instant-eval-judgments.table.ts";

export const INSTANT_EVAL_JUDGMENTS_TABLE = "instant_eval_judgments" as const;

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

/** A verdict as the page answers it: the sort key as itself, every other column elected. */
export interface JudgmentRow {
  TraceId: string;
  QuestionId: string;
  SpanId: string;
  LatestThreadId: string;
  LatestKind: string;
  LatestStatus: string;
  LatestPassed: number | null;
  LatestScore: number | null;
  LatestLabel: string;
  LatestProbability: number | null;
  LatestProbabilities: string;
  LatestError: string;
  LatestOccurredAt: string;
}

/** Each verdict column at its latest `UpdatedAt`, under a `Latest…` key (no alias shadows). */
const latest = {
  LatestThreadId: fn.argMax(judgments.ThreadId, judgments.UpdatedAt),
  LatestKind: fn.argMax(judgments.Kind, judgments.UpdatedAt),
  LatestStatus: fn.argMax(judgments.Status, judgments.UpdatedAt),
  LatestPassed: fn.argMax(judgments.Passed, judgments.UpdatedAt),
  LatestScore: fn.argMax(judgments.Score, judgments.UpdatedAt),
  LatestLabel: fn.argMax(judgments.Label, judgments.UpdatedAt),
  LatestProbability: fn.argMax(judgments.Probability, judgments.UpdatedAt),
  LatestProbabilities: fn.argMax(judgments.Probabilities, judgments.UpdatedAt),
  LatestError: fn.argMax(judgments.Error, judgments.UpdatedAt),
  LatestOccurredAt: fn.toString(fn.argMax(judgments.OccurredAt, judgments.UpdatedAt)),
};

/**
 * argMax over the version column rather than FINAL: the dedup is eventual, and a page has to be
 * the latest version of each verdict without materialising every column of every granule.
 */
const VERDICT_COLUMNS = {
  TraceId: judgments.TraceId,
  SpanId: judgments.SpanId,
  QuestionId: judgments.QuestionId,
  ...latest,
};

type JudgmentWindow = Pick<
  InstantEvalJudgmentQuery,
  "projectId" | "runId" | "writtenFrom" | "writtenUntil"
>;

function inWindow<Ctes>(
  { and, eq, gte, lte }: ConditionOps<typeof INSTANT_EVAL_JUDGMENTS_TABLE, Ctes>,
  window: JudgmentWindow,
): Condition<typeof INSTANT_EVAL_JUDGMENTS_TABLE>[] {
  return [
    eq(judgments.RunId, window.runId),
    and(
      gte(judgments.CreatedAt, window.writtenFrom.epochMilliseconds),
      lte(judgments.CreatedAt, window.writtenUntil.epochMilliseconds),
    ),
  ];
}

/**
 * One page of verdicts, one row past it so "there is more" needs no second read. A sort-key
 * filter goes in WHERE where the index uses it, a verdict filter in HAVING because the verdict
 * does not exist until the group is formed.
 */
export function judgmentsPageRead(
  query: InstantEvalJudgmentQuery,
): ReaderReadStatement<JudgmentRow> {
  const page = clickhouseRead({ scope: tenantScope.single({ tenantId: query.projectId }) })
    .from(judgments)
    .select(VERDICT_COLUMNS)
    .where((ops) => ops.and(...inWindow(ops, query), ...sortKeyFilters(ops, query)))
    .groupBy(judgments.TraceId, judgments.SpanId, judgments.QuestionId);
  const filtered =
    query.status === undefined && query.matched === undefined
      ? page
      : page.having((ops) => ops.and(...verdictFilters(ops, query)));
  return filtered
    .orderBy(judgments.TraceId)
    .orderBy(judgments.SpanId)
    .orderBy(judgments.QuestionId)
    .limit(query.limit + 1)
    .build();
}

/** The filters on the sort key, which the WHERE reads through the index; the cursor among them. */
function sortKeyFilters<Ctes>(
  { oneOf, eq, gt }: ConditionOps<typeof INSTANT_EVAL_JUDGMENTS_TABLE, Ctes>,
  query: InstantEvalJudgmentQuery,
): Condition<typeof INSTANT_EVAL_JUDGMENTS_TABLE>[] {
  const terms: Condition<typeof INSTANT_EVAL_JUDGMENTS_TABLE>[] = [];
  if (query.questionId !== undefined) terms.push(eq(judgments.QuestionId, query.questionId));
  if (query.traceIds !== undefined) terms.push(oneOf(judgments.TraceId, query.traceIds));
  const cursor = query.cursor === undefined ? null : decodeInstantEvalCursor(query.cursor);
  if (cursor) {
    terms.push(
      gt(
        fn.tuple(judgments.TraceId, judgments.SpanId, judgments.QuestionId),
        fn.tuple(
          param.string(cursor.traceId),
          param.string(cursor.spanId),
          param.string(cursor.questionId),
        ),
      ),
    );
  }
  return terms;
}

/** The filters on the elected verdict, which only a HAVING can read. */
function verdictFilters<Ctes>(
  { and, or, not, eq, ne }: ConditionOps<typeof INSTANT_EVAL_JUDGMENTS_TABLE, Ctes>,
  { status, matched }: InstantEvalJudgmentQuery,
): Condition<typeof INSTANT_EVAL_JUDGMENTS_TABLE>[] {
  const terms: Condition<typeof INSTANT_EVAL_JUDGMENTS_TABLE>[] = [];
  if (status !== undefined) terms.push(eq(latest.LatestStatus, status));
  if (matched !== undefined) {
    // A match is a boolean question that passed. A score or category question has no yes, so
    // `matched` over one of those is its judged rows.
    const match = or(
      eq(latest.LatestPassed, 1),
      and(ne(latest.LatestKind, "boolean"), eq(latest.LatestStatus, "judged")),
    );
    terms.push(matched ? match : not(match));
  }
  return terms;
}

/**
 * A few whole traces of a run. The hash of the trace and the seed is the ordering: deterministic
 * for a given seed, so paging the same sample twice agrees, and different for the next call.
 */
export function judgmentsSampleRead(
  query: InstantEvalJudgmentSampleQuery,
): ReaderReadStatement<JudgmentRow> {
  const scope = tenantScope.single({ tenantId: query.projectId });
  const hash = fn.cityHash64(judgments.TraceId, param.uint64(query.seed));
  return clickhouseRead({ scope })
    .from(judgments)
    .with("sampled", (sub) => {
      const traces = sub
        .from(judgments)
        .select({ TraceId: judgments.TraceId })
        .where((ops) => ops.and(...inWindow(ops, query)))
        .groupBy(judgments.TraceId);
      const ordered = query.shouldPreferMatched
        ? traces.orderBy(fn.max(judgments.Passed), "DESC").orderBy(hash)
        : traces.orderBy(hash);
      return ordered.limit(query.traces);
    })
    .select(VERDICT_COLUMNS)
    .where((ops) =>
      ops.and(...inWindow(ops, query), ops.oneOf(judgments.TraceId, { cte: "sampled" })),
    )
    .groupBy(judgments.TraceId, judgments.SpanId, judgments.QuestionId)
    .orderBy(judgments.TraceId)
    .orderBy(judgments.SpanId)
    .orderBy(judgments.QuestionId)
    .build();
}

const JUDGMENT_STATUSES: readonly string[] = ["judged", "skipped", "failed"];

function statusOf(value: string): InstantEvalJudgmentStatus {
  return JUDGMENT_STATUSES.includes(value) ? (value as InstantEvalJudgmentStatus) : "failed";
}

export function toJudgment(row: JudgmentRow): InstantEvalJudgment {
  return {
    traceId: row.TraceId,
    questionId: row.QuestionId,
    threadId: row.LatestThreadId,
    spanId: row.SpanId,
    kind: row.LatestKind,
    status: statusOf(row.LatestStatus),
    passed: row.LatestPassed === null ? null : row.LatestPassed === 1,
    score: row.LatestScore,
    label: row.LatestLabel === "" ? null : row.LatestLabel,
    probability: row.LatestProbability,
    probabilities: parseProbabilities(row.LatestProbabilities),
    error: row.LatestError === "" ? null : row.LatestError,
    occurredAt: row.LatestOccurredAt,
  };
}
