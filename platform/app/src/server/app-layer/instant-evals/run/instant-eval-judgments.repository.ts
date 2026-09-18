/**
 * Where a run's judgements are kept, and how they are read back.
 *
 * Writes are insert-only into a ReplacingMergeTree keyed by
 * `(TenantId, RunId, TraceId, QuestionId)`, which is what makes a redelivered
 * page safe: the same page judged twice re-inserts the same keys with the same
 * values, and the merge collapses them. The page intent writes here BEFORE it
 * records the page as judged, so a crash between the two costs a redelivery
 * rather than a lost page.
 *
 * Reads are keyset-paged on `(TraceId, QuestionId)`, which is the sort key's
 * own order after the run, so a page is a range scan rather than an offset. The
 * cursor is opaque to a caller and carries both halves, because one trace has a
 * row per question and a cursor on the trace alone would skip or repeat.
 *
 * Every query filters `TenantId` first and bounds `CreatedAt`, which the run's
 * own timestamps supply. Without the time bound a read by run id walks every
 * partition, including the cold ones.
 *
 * @see ../../../clickhouse/migrations/00097_create_instant_eval_judgments.sql
 * @see ../../../../../specs/instant-evals/instant-eval-api.feature
 */

import { createLogger } from "@langwatch/observability";

import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import type {
  InstantEvalJudgmentRecord,
  InstantEvalJudgmentStatus,
} from "./judgments";

const TABLE_NAME = "instant_eval_judgments" as const;

const logger = createLogger("langwatch:instant-evals:judgments-repository");

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
  readonly writtenFrom: Date;
  readonly writtenUntil: Date;
  readonly limit: number;
  /** Only this question's judgements. */
  readonly questionId?: string;
  /** Only judgements that matched, or only those that did not. */
  readonly matched?: boolean;
  readonly status?: InstantEvalJudgmentStatus;
  /** The cursor a previous page returned. */
  readonly cursor?: string;
  /** Only these traces, which is how a sample reads its own rows. */
  readonly traceIds?: readonly string[];
}

export interface InstantEvalJudgmentsRepository {
  insert(records: readonly InstantEvalJudgmentRecord[]): Promise<void>;
  page(query: InstantEvalJudgmentQuery): Promise<InstantEvalJudgmentPage>;
}

/** `TraceId` and `QuestionId`, packed into one opaque token. */
export function encodeInstantEvalCursor(judgment: {
  traceId: string;
  questionId: string;
}): string {
  return Buffer.from(
    JSON.stringify([judgment.traceId, judgment.questionId]),
    "utf8",
  ).toString("base64url");
}

/** The cursor's two halves, or `null` when it is not one of ours. */
export function decodeInstantEvalCursor(
  cursor: string,
): { traceId: string; questionId: string } | null {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [traceId, questionId] = parsed;
    if (typeof traceId !== "string" || typeof questionId !== "string") {
      return null;
    }
    return { traceId, questionId };
  } catch {
    return null;
  }
}

function parseProbabilities(
  value: unknown,
): Readonly<Record<string, number>> | null {
  if (typeof value !== "string" || value === "") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, number>)
      : null;
  } catch {
    return null;
  }
}

interface JudgmentRow {
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

function toJudgment(row: JudgmentRow): InstantEvalJudgment {
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
function buildFilters(query: InstantEvalJudgmentQuery): {
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
    where.push("(TraceId, QuestionId) > ({after:String}, {afterQ:String})");
    parameters.after = cursor.traceId;
    parameters.afterQ = cursor.questionId;
  }

  if (query.status !== undefined) {
    having.push("Status = {status:String}");
    parameters.status = query.status;
  }
  if (query.matched !== undefined) {
    // A match is a boolean question that passed; the other kinds have no yes to
    // count, so "matched" over them means the judge answered at all.
    having.push(
      query.matched
        ? "(Passed = 1 OR (Kind != 'boolean' AND Status = 'judged'))"
        : "NOT (Passed = 1 OR (Kind != 'boolean' AND Status = 'judged'))",
    );
  }

  return { where, having, parameters };
}

export class ClickHouseInstantEvalJudgmentsRepository
  implements InstantEvalJudgmentsRepository
{
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async insert(records: readonly InstantEvalJudgmentRecord[]): Promise<void> {
    const [first] = records;
    if (!first) return;

    // One tenant per call, and checked rather than trusted: this one value
    // chooses which ClickHouse the whole batch is written to, so a batch that
    // ever mixed tenants would land one project's judgements in another's. A
    // plain Error on purpose, since it is a broken internal invariant.
    const tenantId = first.TenantId;
    const foreign = records.find((record) => record.TenantId !== tenantId);
    if (foreign) {
      throw new Error(
        `instant_eval_judgments batch mixes tenants (${tenantId} and ${foreign.TenantId}); refusing to write`,
      );
    }

    const client = await this.resolveClient(tenantId);
    await client.insert({
      table: TABLE_NAME,
      values: records.map((record) => ({
        ...record,
        OccurredAt: new Date(record.OccurredAt),
        CreatedAt: new Date(record.CreatedAt),
        UpdatedAt: new Date(record.UpdatedAt),
      })),
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
    });
    logger.debug(
      { tenantId, runId: first.RunId, count: records.length },
      "Instant Eval judgements written",
    );
  }

  async page(
    query: InstantEvalJudgmentQuery,
  ): Promise<InstantEvalJudgmentPage> {
    const { where, having, parameters } = buildFilters(query);
    const client = await this.resolveClient(query.projectId);
    // One row past the page, so "there is more" needs no second query.
    const limit = query.limit + 1;

    const result = await client.query({
      // argMax over the version column rather than FINAL: the dedup is
      // eventual, and a page has to be the latest version of each verdict
      // without materialising every column of every granule.
      query: `
        SELECT
          TraceId,
          QuestionId,
          argMax(ThreadId, UpdatedAt) AS ThreadId,
          argMax(SpanId, UpdatedAt) AS SpanId,
          argMax(Kind, UpdatedAt) AS Kind,
          argMax(Status, UpdatedAt) AS Status,
          argMax(Passed, UpdatedAt) AS Passed,
          argMax(Score, UpdatedAt) AS Score,
          argMax(Label, UpdatedAt) AS Label,
          argMax(Probability, UpdatedAt) AS Probability,
          argMax(Probabilities, UpdatedAt) AS Probabilities,
          argMax(Error, UpdatedAt) AS Error,
          argMax(OccurredAt, UpdatedAt) AS OccurredAt
        FROM ${TABLE_NAME}
        WHERE TenantId = {tenantId:String}
          AND RunId = {runId:String}
          AND CreatedAt >= {writtenFrom:DateTime64(3)}
          AND CreatedAt <= {writtenUntil:DateTime64(3)}
          ${where.map((condition) => `AND ${condition}`).join("\n          ")}
        GROUP BY TraceId, QuestionId
        ${having.length > 0 ? `HAVING ${having.join(" AND ")}` : ""}
        ORDER BY TraceId, QuestionId
        LIMIT {limit:UInt32}
      `,
      query_params: {
        ...parameters,
        tenantId: query.projectId,
        runId: query.runId,
        writtenFrom: query.writtenFrom,
        writtenUntil: query.writtenUntil,
        limit,
      },
      format: "JSON",
    });

    const rows = (await result.json<JudgmentRow>()).data;
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      judgments: page.map(toJudgment),
      ...(rows.length > query.limit && last
        ? { nextCursor: encodeInstantEvalCursor(toJudgment(last)) }
        : {}),
    };
  }
}
