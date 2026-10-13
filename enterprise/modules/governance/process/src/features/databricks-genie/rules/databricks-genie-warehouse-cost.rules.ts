// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** The Genie puller's warehouse cost question: the statement, its reply and the window it asks about. */

import { PULLED_USAGE_HINT_KEY } from "@langwatch/enterprise-governance-contract";
import type { NormalizedPullEvent } from "@langwatch/enterprise-governance-contract";
import { Temporal, toEpochMs } from "@langwatch/time";
import { z } from "zod";

import {
  GENIE_CLIENT_APPLICATION,
  WAREHOUSE_COST_STRADDLE_LOOKBACK_MS,
  type WarehousePricedStatement,
  warehouseCostRowSchema,
} from "./warehouse-cost.rules.ts";

/**
 * Longer than a Genie list call, because this one asks the metastore to
 * aggregate two system tables and the warehouse may be asleep when it arrives.
 * A serverless warehouse cold-starts in seconds, but not always in five.
 */
export const WAREHOUSE_COST_TIMEOUT_MS = 60_000;

/**
 * Per-statement cost for the window, from the warehouse's own billing.
 *
 * Read it as three independent facts joined by the hour they share:
 *
 *   `sliced`      every statement the warehouse ran, Genie's or not, cut into
 *                 one row per hour it was awake in
 *   `hour_total`  how much execution time that hour held IN TOTAL
 *   `hour_dbu`    what the warehouse was billed for that hour, per SKU
 *
 * `hour_total` deliberately sums `sliced` rather than filtering to Genie. A
 * warehouse shared with dashboards and scheduled jobs whose denominator counted
 * only Genie's queries would hand Genie the entire warehouse bill. Live
 * validation put Genie at 13.3% of one workspace's warehouse compute; the rest
 * is real spend belonging to traffic nobody asked Genie for, and it stays
 * unattributed rather than being redistributed to whoever happens to be here.
 *
 * `priced` picks ONE price row per hour and SKU, preferring USD and then the
 * most recently effective. Without that the join fans out: a SKU listed in two
 * currencies would return the hour's bill twice and double every question in
 * it. Rows with no matching price come back with nulls rather than being
 * dropped, so the caller can say so instead of silently reporting zero.
 *
 * A statement is cut at every hour boundary it crosses, because the billing
 * table is: `system.billing.usage` charges each hour for the compute that
 * actually RAN in it. Bucketing a statement wholly into the hour it began — the
 * shape this query used to have — put a 40-minute job's whole runtime in its
 * start hour's denominator while 38 of those minutes were billed to the next
 * one, leaving that next hour's bill to divide among whatever happened to start
 * inside it. A one-second Genie question landing there could take the lot. The
 * error ran in one direction: toward over-charging short questions, which is
 * exactly what Genie sends.
 *
 * Three approximations survive, and this is what each costs:
 *
 *   Execution time is prorated across the hours by WALL-CLOCK overlap, because
 *   the table reports one `execution_duration_ms` per statement and never says
 *   which hour it was spent in. A statement that idles on a lock for 50 minutes
 *   and computes for 10 has those 10 minutes spread evenly over the hour it
 *   waited in. It moves a share between adjacent hours of the SAME statement;
 *   it cannot invent or lose one, so a statement's total share is unaffected
 *   and only its per-hour split is approximate.
 *
 *   A statement still running when the chunk's upper edge falls is priced from
 *   both sides — this chunk emits the hours below the edge, the next one emits
 *   the hours above it, and the sweep adds them. What does not survive is a
 *   tail whose chunk is HELD: an hour there with no bill yet stops the sweep,
 *   the question is emitted with the part that did price, and the re-read drops
 *   the hint rather than restating it. Bounded to statements that straddle a
 *   chunk edge AND run into an hour the workspace has not billed.
 *
 *   The look-back that catches statements which began BEFORE the window is
 *   bounded (`WAREHOUSE_COST_STRADDLE_LOOKBACK_MS`). A statement running longer
 *   than it is invisible to the window's first hours, whose denominators then
 *   under-count — the same direction as the original bug, and the reason the
 *   bound is a day rather than an hour.
 *
 * The row cap counts hour SLICES now, not statements: a warehouse whose
 * statements routinely span hours reaches it sooner. Whichever it counts, the
 * consequence is unchanged — the chunk is refused whole.
 */
/**
 * The most rows one cost read will accept.
 *
 * The cap is a guard against holding a whole busy warehouse's hour-by-hour
 * detail in memory, not a sampling decision. Hitting it means the answer is
 * missing statements we cannot identify, so the read is refused whole rather
 * than used: a partial answer prices some questions and silently leaves the
 * rest at nothing.
 *
 * The cap applies per CHUNK, not per window — see `WAREHOUSE_COST_CHUNK_MS`. That
 * is what keeps a refusal survivable: only the day that tripped it goes
 * unpriced, the days read before it keep their cost, and the watermark stops
 * there so the refused day is asked about again rather than being recorded at
 * zero for good.
 */
export const WAREHOUSE_COST_ROW_LIMIT = 50_000;

export const WAREHOUSE_COST_STATEMENT = `
WITH ran AS (
  SELECT
    statement_id,
    client_application,
    -- Projected for the final WHERE only — the outer scope sees the CTE's
    -- output, not the base table. \`hour_total\` deliberately ignores it: the
    -- share's denominator is the WHOLE warehouse, so the CTE must keep every
    -- statement and the Genie filter must wait until after the totals.
    query_source.genie_space_id AS genie_space_id,
    execution_duration_ms,
    compute.warehouse_id AS warehouse_id,
    start_time,
    -- \`end_time\` is nullable; the duration reconstructs it when it is missing.
    -- GREATEST pins the result at or after \`start_time\`, which is not defensive
    -- tidiness: \`sequence()\` below RAISES on a stop before its start, so one
    -- clock-skewed row would fail the whole read rather than skew one share.
    GREATEST(
      COALESCE(
        end_time,
        timestamp_millis(unix_millis(start_time) + execution_duration_ms)
      ),
      start_time
    ) AS ended_at
  FROM system.query.history
  -- Wider than the window on purpose: a statement that BEGAN before it is still
  -- burning compute inside it, and an hour whose denominator omits that
  -- statement over-states everyone else's share of the hour.
  WHERE start_time >= :scan_from_ts
    AND start_time < :to_ts
    AND execution_duration_ms IS NOT NULL
    AND compute.warehouse_id IS NOT NULL
),
sliced AS (
  SELECT
    r.statement_id,
    r.client_application,
    r.genie_space_id,
    r.warehouse_id,
    r.start_time,
    h.usage_hour,
    -- The statement's execution time, prorated onto THIS hour by how much of its
    -- wall clock fell inside it. \`div\` and not \`/\`: Spark's \`/\` returns a
    -- DOUBLE, and no float may enter the money path. Truncation errs downward,
    -- so the slices of a statement never add up to more than it ran.
    --
    -- The zero-wall branch is not a divide-by-zero guard bolted on: a statement
    -- whose end lands on its start explodes to exactly one hour, so handing that
    -- hour the whole duration is the correct answer, not a fallback.
    CASE
      WHEN unix_millis(r.ended_at) <= unix_millis(r.start_time)
        THEN r.execution_duration_ms
      ELSE (
        r.execution_duration_ms * GREATEST(
          0,
          LEAST(unix_millis(r.ended_at), unix_millis(h.usage_hour) + 3600000)
            - GREATEST(unix_millis(r.start_time), unix_millis(h.usage_hour))
        )
      ) div (unix_millis(r.ended_at) - unix_millis(r.start_time))
    END AS execution_ms_in_hour
  FROM ran r
  -- The last hour is half-open, because \`sequence\` includes its stop value and
  -- an hour is not. A statement ending at exactly 10:00:00.000 worked in hour
  -- 09 and not at all in hour 10, and every hourly scheduled query ends on a
  -- boundary. Emitting that empty hour is not merely untidy: if the warehouse
  -- shut down at 10:00 no bill for hour 10 will ever arrive, the null SKU reads
  -- as "not billed yet", and one such statement holds the whole source at this
  -- chunk until the seven-day hold expires.
  --
  -- Backing the stop off by a millisecond cannot invert the range: it is only
  -- done when the statement ran for at least that long, and a statement that
  -- did not still needs its one hour to land somewhere.
  LATERAL VIEW explode(
    sequence(
      date_trunc('HOUR', r.start_time),
      date_trunc('HOUR',
        CASE
          WHEN unix_millis(r.ended_at) > unix_millis(r.start_time)
            THEN timestamp_millis(unix_millis(r.ended_at) - 1)
          ELSE r.start_time
        END
      ),
      INTERVAL 1 HOUR
    )
  ) h AS usage_hour
  -- Hours outside the window are dropped after the split, not before it: the
  -- split needs the statement's real span to divide, the totals only want the
  -- hours this read is answering for.
  --
  -- This clip is also what decides which chunk answers for which row, and it
  -- has to be the HOUR rather than the statement's start. Chunks tile the
  -- window, so every hour falls in exactly one of them and every statement-hour
  -- is emitted exactly once — a statement that begins near the end of a chunk
  -- comes back from the next one too, carrying the hours it burned there.
  -- Gating on \`start_time\` instead looks like the same duplicate-avoidance
  -- rule and is not: it hands the straddler wholly to the chunk it began in,
  -- which has already dropped every hour past its own end, while the next chunk
  -- counts that statement in its denominators and then excludes it from its
  -- rows. Those hours are then billed to nobody and still dilute every other
  -- question's share of them, permanently and silently, at every interior chunk
  -- boundary a backfill crosses.
  WHERE h.usage_hour >= :from_ts
    AND h.usage_hour < :to_ts
),
hour_total AS (
  SELECT usage_hour, warehouse_id, SUM(execution_ms_in_hour) AS total_ms
  FROM sliced
  GROUP BY usage_hour, warehouse_id
),
hour_dbu AS (
  SELECT
    date_trunc('HOUR', usage_start_time) AS usage_hour,
    usage_metadata.warehouse_id AS warehouse_id,
    sku_name,
    SUM(usage_quantity) AS dbu
  FROM system.billing.usage
  WHERE usage_start_time >= :from_ts
    AND usage_start_time < :to_ts
    AND usage_unit = 'DBU'
    AND usage_metadata.warehouse_id IS NOT NULL
  GROUP BY 1, 2, 3
),
priced AS (
  SELECT usage_hour, warehouse_id, sku_name, currency_code, billable_usd
  FROM (
    SELECT
      d.usage_hour,
      d.warehouse_id,
      d.sku_name,
      p.currency_code,
      CAST(d.dbu * p.pricing.effective_list.default AS DECIMAL(38, 12)) AS billable_usd,
      ROW_NUMBER() OVER (
        PARTITION BY d.usage_hour, d.warehouse_id, d.sku_name
        ORDER BY CASE WHEN p.currency_code = 'USD' THEN 0 ELSE 1 END,
                 p.price_start_time DESC
      ) AS pick
    FROM hour_dbu d
    LEFT JOIN system.billing.list_prices p
      ON p.sku_name = d.sku_name
     AND d.usage_hour >= p.price_start_time
     AND (p.price_end_time IS NULL OR d.usage_hour < p.price_end_time)
  )
  WHERE pick = 1
)
SELECT
  w.statement_id                        AS statement_id,
  CAST(w.usage_hour AS STRING)          AS usage_hour,
  CAST(w.execution_ms_in_hour AS STRING) AS execution_ms_in_hour,
  CAST(t.total_ms AS STRING)            AS hour_total_ms,
  CAST(pr.billable_usd AS STRING)       AS hour_billable_usd,
  pr.currency_code                      AS currency_code,
  pr.sku_name                           AS sku_name
FROM sliced w
JOIN hour_total t
  ON t.usage_hour = w.usage_hour AND t.warehouse_id = w.warehouse_id
-- LEFT, not inner, and that is the whole fix for the zero-cost stall. An inner
-- join drops any Genie statement whose hour is not in \`system.billing.usage\`
-- yet, and that table lands minutes to days behind the question. Dropped, a
-- not-yet-billed statement is indistinguishable from a genuinely free one: both
-- are simply absent, the chunk reads as fully priced, the watermark moves past
-- them, and the fixed settling re-read never reaches back far enough to correct
-- them — a permanent zero. Kept, a not-yet-billed statement returns with a null
-- \`sku_name\`, which the allocator reads as "seen but unbilled" and holds the
-- watermark for until its bill lands (or the max hold expires).
LEFT JOIN priced pr
  ON pr.usage_hour = w.usage_hour AND pr.warehouse_id = w.warehouse_id
-- A union, because each half alone is a cliff. The label is a display string
-- the provider can rename or localize at will; the space id is structural but
-- observed on 103/103 Genie statements over 60 days, not documented as
-- guaranteed. Either change alone silently shrinks the priced set to zero —
-- together, both have to break at once.
WHERE (w.genie_space_id IS NOT NULL OR w.client_application = :genie_app)
LIMIT ${WAREHOUSE_COST_ROW_LIMIT}
`;

/**
 * The Statement Execution API's reply, as far as this adapter cares.
 *
 * `data_array` is rows of strings — the API stringifies every value, including
 * the decimal this query casts — which is exactly what money needs, because a
 * float never exists anywhere along the path.
 */
export const warehouseCostResponseSchema = z.object({
  status: z.object({
    state: z.string(),
    error: z.object({ message: z.string() }).partial().optional(),
  }),
  manifest: z
    .object({
      schema: z
        .object({
          columns: z.array(z.object({ name: z.string() })).optional(),
        })
        .optional(),
      /** How many rows the query produced, which is not how many arrived. */
      total_row_count: z.number().optional(),
    })
    .optional(),
  result: z
    .object({
      data_array: z.array(z.array(z.string().nullable())).optional(),
      /**
       * Present when the answer did not fit in one chunk.
       *
       * An `INLINE` answer is capped by size as well as by row count, so a
       * reply can be short of the `LIMIT` and still be missing rows. This is
       * the only field that says so.
       */
      next_chunk_index: z.number().optional(),
    })
    .optional(),
});

/**
 * The columns `WAREHOUSE_COST_STATEMENT` selects, in order.
 *
 * The API answers in `JSON_ARRAY` form — rows are positional, with the names
 * only in the manifest — so reading a row means trusting that its fourth value
 * is still the hour's total. Every value here is a string, which means a
 * reordered SELECT would not fail any parse: it would quietly price questions
 * off the wrong column. `execution_ms_in_hour` and `hour_total_ms` are now
 * adjacent and both whole milliseconds, so a swap between them is a share of
 * exactly one that nothing else would catch. Checking the manifest turns that
 * into a refusal.
 */
export const WAREHOUSE_COST_COLUMNS = [
  "statement_id",
  "usage_hour",
  "execution_ms_in_hour",
  "hour_total_ms",
  "hour_billable_usd",
  "currency_code",
  "sku_name",
] as const;

/**
 * What one cost reply turned out to be worth.
 *
 * The two refusals are kept apart because the caller can do something about
 * one of them and nothing about the other. `cut_short` means rows exist that
 * did not arrive — asking about a smaller window can get them, so the window
 * is re-asked in pieces before it is held. `failed` means the question was
 * not answered at all; a smaller window would be refused the same way, so the
 * pieces are not tried and the window is held as it is. Both holds age on the
 * same clock, `costHeldSinceMs`, and both run out at
 * `WAREHOUSE_COST_MAX_HOLD_MS`: a workspace whose billing tables simply
 * cannot be read holds for that long, is reported as unreadable meanwhile,
 * and then moves on with its questions left unpriced rather than pinning the
 * source to one instant for good.
 *
 * Collapsing the two — which is what a bare `null` did — is what let a busy
 * first sweep record a month of questions at zero and move on.
 */
export type WarehouseCostRead =
  | {
      outcome: "priced";
      costByStatementId: Map<string, WarehousePricedStatement>;
      /**
       * At least one statement in this window was seen but has no billing row
       * yet — its cost has not settled. The window priced, but not wholly, so
       * the watermark must hold here rather than move past the unbilled
       * statement and record it at zero for good.
       */
      owed: boolean;
    }
  /** More rows exist than arrived. A smaller question would carry them. */
  | { outcome: "cut_short" }
  /**
   * The answer never came back: cancelled for exceeding its time limit, given
   * up on by this end, or refused by something that will not still be refusing
   * next run.
   *
   * Split out from `failed` because the two are opposites in the only way that
   * matters here — whether asking again is worth anything. Collapsed together
   * they were, and a workspace whose billing tables are merely slow had the
   * whole unpriced remainder of its window written off at zero for good.
   */
  | { outcome: "timed_out" }
  /**
   * Answered, and the answer was no. Asking about LESS would be answered no
   * the same way, so the pieces are not tried — but the period is still held
   * rather than written off, because the questions in it have no amount and
   * moving past them would make that permanent. See `priceWarehouseCostChunk`.
   */
  | { outcome: "failed" };

/**
 * What one chunk of the cost walk decided. `done` stops the walk with a
 * ceiling — `pricedThroughMs` is where the watermark holds, `null` when the
 * chunk owes none — and `unreadable` says whether that hold is for a bill
 * that was refused outright, which the run reports as a notice. `!done`
 * carries the walk to the next chunk.
 */
export type WarehouseCostChunkOutcome =
  | { done: true; pricedThroughMs: number | null; unreadable: boolean }
  | { done: false };

export type WarehouseCostStatement = z.infer<typeof warehouseCostResponseSchema>;

/**
 * Statement states that mean the answer did not arrive in time, as opposed to
 * the workspace declining to give one.
 *
 * `CANCELED` is what `on_wait_timeout: "CANCEL"` produces, and it is by far the
 * common one. The other two are the shapes a reply takes when it is still being
 * worked on — which the request asks never to receive, so seeing one means the
 * assumption behind that request no longer holds, and treating it as a refusal
 * would write off a window nobody ever declined to price.
 */
export const WAREHOUSE_COST_UNFINISHED_STATES = new Set(["CANCELED", "PENDING", "RUNNING"]);

const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * The window this question is asked about, as bound parameters.
 *
 * Bound, never interpolated. The window arrives from a clock, but the statement
 * is a constant either way and this keeps it one.
 *
 * The warehouse id is deliberately absent. It says where this query runs, not
 * what it may answer about: a Genie space answers on the warehouse it was
 * authored against, which is routinely not the one the credential holds
 * `CAN USE` on, and filtering to the executor would price every question at
 * nothing.
 */
export function warehouseCostParameters(chunk: {
  fromMs: number;
  toMs: number;
}): { name: string; value: string; type: string }[] {
  return [
    // Whole hours, both ends. The warehouse is billed per hour and the
    // statements are bucketed per hour, but the two are filtered separately: a
    // window starting at 10:37 keeps hour 10's queries and drops hour 10's
    // bill, so every question in that hour prices at nothing — and on a re-read
    // that nothing would overwrite a cost an earlier run had already worked out
    // correctly.
    {
      name: "from_ts",
      value: Temporal.Instant.fromEpochMilliseconds(startOfHourMs(chunk.fromMs)).toString({
        fractionalSecondDigits: 3,
      }),
      type: "TIMESTAMP",
    },
    // Where the SCAN starts, which is earlier than where the answer starts.
    // Statements that began before the window still burn compute inside it, and
    // an hour whose denominator omits them over-states everyone else's share of
    // that hour.
    {
      name: "scan_from_ts",
      value: Temporal.Instant.fromEpochMilliseconds(
        startOfHourMs(chunk.fromMs) - WAREHOUSE_COST_STRADDLE_LOOKBACK_MS,
      ).toString({ fractionalSecondDigits: 3 }),
      type: "TIMESTAMP",
    },
    {
      name: "to_ts",
      value: Temporal.Instant.fromEpochMilliseconds(endOfHourMs(chunk.toMs)).toString({
        fractionalSecondDigits: 3,
      }),
      type: "TIMESTAMP",
    },
    {
      name: "genie_app",
      value: GENIE_CLIENT_APPLICATION,
      type: "STRING",
    },
  ];
}

/**
 * The last instant still covered by what this run priced, given that `chunk` is
 * the first piece it could not.
 *
 * One millisecond before the chunk starts, and the millisecond is the whole
 * point. Both boundaries here are half-open in the same direction and that is
 * what makes the naive answer wrong: the cost query asks
 * `start_time >= :from_ts`, so a statement AT `chunk.fromMs` belongs to the
 * unpriced piece, while message enumeration keeps only `createdMs > sinceMs`,
 * so a watermark of `chunk.fromMs` drops a question asked at that same instant.
 * It would be emitted once at zero and then filtered out of every later run —
 * the exact permanence this ceiling exists to prevent, reintroduced on a
 * one-millisecond seam.
 *
 * Chunks are hour-aligned, so this only bites a question asked exactly on the
 * hour. That is rare and completely deterministic when it happens, which is the
 * worst combination to leave in: too rare to notice, permanent when it lands.
 */
export function unpricedFloor(chunk: { fromMs: number }): number {
  return chunk.fromMs - 1;
}

/**
 * The shape of a cost question, for the log line. Every defect this puller has
 * had was a timing one — too many questions for the run's deadline, or a wait
 * that sat inside the spread of how long answers take — and neither is visible
 * from an outcome alone, so each question records how wide it was.
 */
export function warehouseCostObserved({
  adapter,
  warehouseId,
  chunk,
}: {
  adapter: string;
  warehouseId: string;
  chunk: { fromMs: number; toMs: number };
}): {
  adapter: string;
  warehouseId: string;
  askedFrom: string;
  askedTo: string;
  askedHours: number;
} {
  return {
    adapter,
    warehouseId,
    askedFrom: Temporal.Instant.fromEpochMilliseconds(startOfHourMs(chunk.fromMs)).toString({
      fractionalSecondDigits: 3,
    }),
    askedTo: Temporal.Instant.fromEpochMilliseconds(endOfHourMs(chunk.toMs)).toString({
      fractionalSecondDigits: 3,
    }),
    askedHours: Math.round((endOfHourMs(chunk.toMs) - startOfHourMs(chunk.fromMs)) / ONE_HOUR_MS),
  };
}

/**
 * An answer can be cut short three ways, and only the first is obvious. A full
 * page means the LIMIT bit. A `next_chunk_index` means the reply was too large
 * to send at once and the rest is elsewhere — that one arrives *under* the
 * LIMIT, so a row count alone would call it complete. And a manifest that counts
 * more rows than arrived says so outright.
 *
 * Which statements are missing is exactly what none of these can tell us, so
 * pricing the ones that did arrive would put a confident zero on the rest.
 */
export function warehouseAnswerCutShort({
  statement,
  dataLength,
}: {
  statement: WarehouseCostStatement;
  dataLength: number;
}): boolean {
  const total = statement.manifest?.total_row_count;
  return (
    dataLength >= WAREHOUSE_COST_ROW_LIMIT ||
    statement.result?.next_chunk_index !== undefined ||
    (total !== undefined && total > dataLength)
  );
}

function startOfHourMs(ms: number): number {
  return Math.floor(ms / ONE_HOUR_MS) * ONE_HOUR_MS;
}

function endOfHourMs(ms: number): number {
  return Math.ceil(ms / ONE_HOUR_MS) * ONE_HOUR_MS;
}

/** One cost reply's rows, parsed; `unreadable` counts the rows that would not parse. */
export function warehouseCostRows(data: (string | null)[][]): {
  rows: z.infer<typeof warehouseCostRowSchema>[];
  unreadable: number;
} {
  let unreadable = 0;
  const rows = data.flatMap((columns) => {
    const parsed = warehouseCostRowSchema.safeParse({
      statementId: columns[0],
      usageHour: columns[1],
      executionMsInHour: columns[2],
      hourTotalMs: columns[3],
      hourBillableUsd: columns[4] ?? null,
      currencyCode: columns[5] ?? null,
      // Null is meaningful now, not an empty-string fallback: the LEFT JOIN
      // returns a null SKU for a statement whose hour has no billing row yet,
      // and the allocator reads that as "seen but unbilled".
      skuName: columns[6] ?? null,
    });
    if (!parsed.success) {
      unreadable += 1;
      return [];
    }
    return [parsed.data];
  });
  return { rows, unreadable };
}

/**
 * The swept events with each question's share of the warehouse bill attached.
 *
 * Attached here rather than where the event is built, because the bill is one
 * query for the whole run and a message does not know what its statement cost
 * until that query has come back.
 *
 * Because the restatement key is the message's own coordinates and excludes
 * cost, re-emitting a message REPLACES its ledger row rather than adding a
 * second one. That is what lets a late-arriving cost correct an earlier zero —
 * and it is also why a re-read must never carry a cost it does not know.
 *
 * So the three cases are kept apart:
 *
 *   priced          → carry the cost.
 *   new, unpriced   → carry zero, as a question with no known cost always has.
 *   re-read, unpriced → carry NO usage hint at all, so the event is audit-only
 *                     and the ledger is not asked to write anything.
 *
 * That last case is the whole reason this function knows about the watermark.
 * A re-read happens only because the source is trying to learn a cost; if it
 * did not learn one — billing was refused, the hour is not published yet — then
 * emitting zero would overwrite a figure an earlier run had already worked out
 * correctly, and a few minutes of billing trouble would quietly wipe the spend
 * it could not confirm.
 */
export function withWarehouseCost({
  events,
  costByStatementId,
  costEnabled,
  watermarkMs,
}: {
  events: NormalizedPullEvent[];
  costByStatementId: Map<string, WarehousePricedStatement> | null;
  costEnabled: boolean;
  /** The watermark this run started from: anything at or below it is a re-read. */
  watermarkMs: number;
}): NormalizedPullEvent[] {
  if (!costEnabled) return events;

  return events.map((event) => withCost({ event, costByStatementId, watermarkMs }));
}

/** One event's share of the warehouse bill, or its hint removed, or it unchanged. */
function withCost({
  event,
  costByStatementId,
  watermarkMs,
}: {
  event: NormalizedPullEvent;
  costByStatementId: Map<string, WarehousePricedStatement> | null;
  watermarkMs: number;
}): NormalizedPullEvent {
  const extra = event.extra;
  if (!extra) return event;

  const hint = extra[PULLED_USAGE_HINT_KEY];
  if (typeof hint !== "object" || hint === null) return event;

  const statementId = extra.statementId;
  const priced =
    typeof statementId === "string" && statementId !== ""
      ? costByStatementId?.get(statementId)
      : undefined;

  if (priced !== undefined) {
    return {
      ...event,
      // The audit row's own cost field, a decimal string since the Zod
      // boundary stringified it — the same exact figure the ledger reads from
      // `costUsd` below, so neither surface ever sees a float.
      cost_usd: priced.costUsd,
      extra: {
        ...extra,
        // The share's raw ingredients, for the human reading the record: an
        // hourly bill charges for being awake, so a lone question on a quiet
        // warehouse absorbs the idle time and its correct cost looks absurd
        // without them. Display-only and OUTSIDE the hint below — derived
        // values in the hint would enter the restatement key and mint a new
        // ledger record per correction (ADR-088 Decision 5).
        warehouseHour: {
          totalExecutionMs: priced.hourTotalExecutionMs,
          billableUsd: priced.hourBillableUsd,
        },
        [PULLED_USAGE_HINT_KEY]: { ...hint, costUsd: priced.costUsd },
      },
    };
  }

  const askedAtMs = toEpochMs(event.event_timestamp);
  const isReread = Number.isFinite(askedAtMs) && askedAtMs <= watermarkMs;
  if (!isReread) return event;

  const { [PULLED_USAGE_HINT_KEY]: _dropped, ...auditOnly } = extra;
  return { ...event, extra: auditOnly };
}
