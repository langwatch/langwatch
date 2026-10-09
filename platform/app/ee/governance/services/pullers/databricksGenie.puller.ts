// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Databricks AI/BI Genie puller — the first adapter whose records exist for
 * VISIBILITY rather than for money (ADR-088 Decisions 1, 2 and 5).
 *
 * Genie is a natural-language analytics surface: a user asks a question, Genie
 * writes SQL against Unity Catalog and runs it. For governance that is the
 * whole point — the question and the generated SQL are the sensitive artefacts,
 * and until now they were invisible to the platform. Every other pulled source
 * answers "what did this cost"; this one answers "who asked what, and what SQL
 * did it run against our warehouse".
 *
 * It cannot be an `HttpPollingPullerAdapter` config. That adapter maps one flat
 * paginated feed through JSON paths, and Genie is a THREE-level walk —
 * spaces → conversations → messages — with a separate SCIM call to turn the
 * numeric author id into a person. A declarative field mapping has nowhere to
 * put a join.
 *
 * Three things about the upstream API that are load-bearing. The live evidence
 * tier at the bottom of the integration suite is what settles them against a
 * real workspace; it is skipped without a credential, so where a claim below
 * rests on the docs alone it says so:
 *
 *   `include_all=true` is NOT optional. Without it the conversations endpoint
 *   returns only the CALLER'S OWN conversations. A governance puller that
 *   omitted it would run green forever and report one user's activity as if it
 *   were the workspace's — the worst possible failure for this feature, because
 *   nothing anywhere would look wrong.
 *
 *   Cost is absent, and its absence is the design. Genie charges nothing per
 *   message; the SQL warehouse DBUs a question burns are billed through
 *   Databricks' own system tables, which this API does not expose. So the
 *   record carries zero — `provider_reported` because it is the provider's
 *   position and not a figure we derived, `estimate` because zero is honestly
 *   an approximation of what the warehouse actually charged. Claiming `exact`
 *   would assert we hold the invoice for a question we can only see half of.
 *
 *   A message is NOT immutable while it is being answered. Databricks fills
 *   `attachments` progressively, so a message read at `IN_PROGRESS` or
 *   `EXECUTING_QUERY` can carry the question without the generated SQL. The
 *   record is keyed on the message id and both sinks replace on it, so a later
 *   read overwrites rather than duplicating — but only if a later read happens,
 *   which is why the watermark stops just short of the oldest message that
 *   could still change (`isSettling`, `nextWatermark`) rather than moving to
 *   the sweep's start. Stopping altogether would be the easy version and the
 *   wrong one: a busy workspace always has something mid-answer, so the window
 *   would never advance at all.
 *
 *   The dimensions are the coordinates of the message itself and nothing about
 *   the author, so an identity that resolves differently on a later pull (a
 *   backfilled SCIM `externalId`, a renamed account) re-labels the record
 *   instead of minting a second one.
 */

import { createLogger } from "@langwatch/observability";
import { z } from "zod";

import { ssrfSafeFetch } from "~/utils/ssrfProtection";
import {
  allocateWarehouseCost,
  costReadFloorMs,
  GENIE_CLIENT_APPLICATION,
  GENIE_FREE_USAGE_SKU_MARKER,
  mergeWarehouseCost,
  WAREHOUSE_COST_MAX_HOLD_MS,
  WAREHOUSE_COST_STRADDLE_LOOKBACK_MS,
  type WarehousePricedStatement,
  warehouseCostChunks,
  warehouseCostPieces,
  warehouseCostRowSchema,
} from "./databricksWarehouseCost";
import {
  GENIE_SPACES_PATH,
  GenieHttpError,
  type GenieSpace,
  genieGet,
  walkGenieSpaces,
} from "./genieSpaces";
import { PULLED_USAGE_HINT_KEY } from "./pulledUsageRecord";
import {
  type NormalizedPullEvent,
  ProviderSignInError,
  type PullerAdapter,
  type PullResult,
  type PullRunOptions,
} from "./pullerAdapter";

const logger = createLogger("langwatch:governance:databricks-genie-puller");

const REQUEST_TIMEOUT_MS = 30_000;
const PAGE_SIZE = 100;

/**
 * What one run will read before handing the rest to the next one. The walk is
 * three levels deep, so this counts HTTP requests rather than pages of one
 * feed: a workspace with hundreds of conversations must not turn a single run
 * into an unbounded crawl of the whole history.
 */
const MAX_REQUESTS_PER_RUN = 400;

/** The ledger's model label. Genie is one product, not a family of models. */
const GENIE_MODEL = "databricks/genie" as const;

/**
 * The run held its place because the warehouse bill could not be read, and
 * said so in its result.
 *
 * A code rather than a sentence, on `PER_KEY_ATTRIBUTION_UNAVAILABLE`'s
 * precedent, so that it can survive a trip through storage once something
 * stores it. Today nothing does: the run returns it in `notices`, the tests
 * assert on it, and the worker that runs the adapter drops `notices` on the
 * floor — no screen and no person sees this code yet. The questions are still
 * recorded, unpriced, and the period is asked about again next run; the log
 * line beside it is where a reader finds out that the figure they are not
 * seeing is being waited for, not that it is zero.
 */
export const WAREHOUSE_COST_UNREADABLE = "warehouse_cost_unreadable" as const;

/**
 * The paid Genie bill line could not be read this run, and the run said so
 * in its result.
 *
 * Same shape and same standing as `WAREHOUSE_COST_UNREADABLE`, for the other
 * read: the bill was refused, the statement failed, or the source has the read
 * switched on with no warehouse to run it on. Returned in `notices`, asserted
 * by the tests, and read by nothing downstream yet. The read holds its own
 * place and asks again next run, for as long as `WAREHOUSE_COST_MAX_HOLD_MS`
 * allows.
 */
export const PAID_GENIE_BILL_UNREADABLE = "paid_genie_bill_unreadable" as const;

/**
 * The line a paid Genie bill row lands under, in the restatement key.
 *
 * A constant coordinate in `dimensions`, so a bill row can never share a key
 * with anything else this adapter emits for the same person and day — and so
 * the key says what it is, for whoever reads it back.
 */
const PAID_GENIE_BILL_LINE = "genie_bill" as const;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How far behind its own position the paid bill read starts each run.
 *
 * The bill is published per DAY, and a day's row keeps growing until the day
 * is over and the billing tables have caught up. A read that reached the end
 * of today therefore re-reads today and yesterday next time, so the row lands
 * whole; re-emitting a day REPLACES its ledger row rather than adding one, so
 * the re-read costs one request and never a double count. Two days covers the
 * day boundary plus the documented lag of the billing tables with room to
 * spare.
 */
const PAID_GENIE_BILL_SETTLING_LAG_MS = 2 * ONE_DAY_MS;

export const DATABRICKS_GENIE_ADAPTER_ID = "databricks_genie" as const;

/**
 * The only hosts a Genie workspace is ever served from, one per cloud.
 *
 * Databricks owns all three, so a customer cannot register a lookalike inside
 * them and no config can name one that is not theirs.
 */
const DATABRICKS_WORKSPACE_HOST_SUFFIXES = [
  ".azuredatabricks.net",
  ".cloud.databricks.com",
  ".gcp.databricks.com",
] as const;

/**
 * Whether a URL is a Databricks workspace origin we may attach a token to.
 *
 * This is an egress restriction, not a formatting check, and it exists because
 * of what `get()` does one line later: the decrypted workspace token goes out
 * as `Authorization: Bearer` to whatever host this string names. A plain
 * `z.string().url()` accepts `https://attacker.example.com`, and `ssrfSafeFetch`
 * will happily reach it — that helper rejects PRIVATE destinations, which is a
 * different threat and no defence against an attacker-owned public host.
 *
 * The reachable path needs no knowledge of the secret: the source's config is
 * readable, the credential travels in it as an opaque encrypted envelope, and
 * re-encryption is deliberately idempotent. So a principal who can edit a
 * source could hand the envelope back unchanged with a different
 * `workspaceUrl`, and the next scheduled run would decrypt a token they never
 * saw and post it to their host.
 *
 * Enforced on the write path (`assertPullDestinationAllowed`) rather than in
 * the schema below, so the rejection reaches whoever is making the change —
 * and so the adapter can still be pointed at a local fixture by its tests.
 */
export function isDatabricksWorkspaceOrigin(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  // Plain http would put the token on the wire in clear even for a real
  // workspace, and credentials in the URL are never part of a legitimate one.
  if (url.protocol !== "https:") return false;
  if (url.username !== "" || url.password !== "") return false;
  const host = url.hostname.toLowerCase();
  return DATABRICKS_WORKSPACE_HOST_SUFFIXES.some((suffix) =>
    host.endsWith(suffix),
  );
}

export const databricksGeniePullConfigSchema = z.object({
  adapter: z.literal(DATABRICKS_GENIE_ADAPTER_ID),
  /** Workspace base URL, e.g. `https://adb-1234567890.4.azuredatabricks.net`. */
  workspaceUrl: z.string().url(),
  /**
   * Which spaces to pull. Empty means "every space the credential can see",
   * which is the setting most customers want and the one that silently starts
   * covering a space the day someone creates it.
   */
  spaceIds: z.array(z.string()).default([]),
  /** ISO instant the very first run starts from. Later runs use the cursor. */
  startingAt: z.string().datetime().optional(),
  schedule: z.string().default("*/15 * * * *"),
  /**
   * A SQL warehouse this credential can run a query on. Naming it is what opts
   * the source into attributing the compute behind each question; leaving it
   * out keeps the source's records at a cost of zero, which is what Genie
   * itself charges.
   *
   * This is the executor, not the subject. The billing query reads every
   * warehouse the workspace's Genie questions actually ran on and prices each
   * hour against that warehouse's own bill — a space answers on whichever
   * warehouse it was authored against, and expecting that to be the one the
   * credential can sign in to is how a whole workspace prices at nothing. Any
   * warehouse the credential holds `CAN USE` on will do.
   *
   * It is optional because the grants it needs are not the ones the rest of this
   * adapter needs. Reading the billing tables requires `SELECT` on `system` from
   * a metastore administrator, and a workspace whose owner has not issued it
   * should still get its Genie activity rather than a failing source.
   */
  warehouseId: z.string().min(1).optional(),
  /**
   * Whether to also read the paid Genie bill line.
   *
   * Databricks bills paid Genie usage on its own line in
   * `system.billing.usage`, per person and per day, under
   * `billing_origin_product = 'GENIE'` — and with no warehouse id, which is
   * exactly why the warehouse allocation above can never see it. This is a
   * separate read of that line, walking on a position of its own
   * (`cursorSchema.paidBillReadThroughMs`), priced from list prices where one
   * is published and landing with its quantity and no amount where none is.
   *
   * Off by default and opt-in per source. It needs the same executor warehouse
   * and the same `SELECT` on `system` the warehouse read needs, and it lands
   * rows under a new key — a key cannot be changed once money sits under it,
   * so switching it on is a decision rather than a default.
   */
  readPaidGenieBill: z.boolean().default(false),
});
export type DatabricksGeniePullConfig = z.infer<
  typeof databricksGeniePullConfigSchema
>;

/**
 * How far back a completed sweep sets its watermark from the instant it began.
 *
 * The window is re-read on the next run, and that is the point. Genie's list
 * endpoints take no server-side time filter, so "new" is decided here against
 * `created_timestamp` — a value Databricks stamps on its own clock, not ours.
 * A watermark placed exactly at our sweep's start would drop any message whose
 * server timestamp landed a few seconds behind our clock. Re-reading five
 * minutes costs a handful of requests and dedups on the message id at both
 * sinks; the alternative silently loses messages at the boundary.
 */
const WATERMARK_LAG_MS = 5 * 60 * 1000;

/**
 * Longer than a Genie list call, because this one asks the metastore to
 * aggregate two system tables and the warehouse may be asleep when it arrives.
 * A serverless warehouse cold-starts in seconds, but not always in five.
 */
const WAREHOUSE_COST_TIMEOUT_MS = 60_000;

/**
 * A sign-in is one small POST. The job has five minutes for everything, so a
 * token endpoint that never answers must not be allowed to spend it: without a
 * bound of its own the run would hit the per-job deadline having read nothing
 * and report a timeout that names no cause.
 */
const TOKEN_TIMEOUT_MS = 15_000;

/**
 * What a Databricks OAuth token endpoint returns. Only `access_token` is
 * load-bearing — `expires_in` is not kept, because a token is minted per run
 * and never outlives it.
 */
const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
});

/**
 * The bearer to present on this run's Genie calls.
 *
 * A pasted workspace token expires about an hour after Databricks issues it,
 * so a source configured that way works when the admin saves it and is dead by
 * the next scheduled run, with nothing on the source to say why. A service
 * principal's client id and secret do not expire, so the source signs in at
 * the start of every run and the schedule keeps running unattended.
 *
 * A pasted token wins when both are present. Someone pasting one into a source
 * that already had a secret is rotating by hand — usually because the secret
 * stopped working — and silently preferring the secret would ignore the thing
 * they just did.
 *
 * Minted once per run rather than per request: the sweep walks several pages
 * across several spaces, and a token per request would multiply one sign-in by
 * the whole walk for no benefit, since the token outlives any single run.
 */
export async function resolveWorkspaceToken(params: {
  credentials: Record<string, string> | undefined;
  workspaceUrl: string;
  signal?: AbortSignal;
}): Promise<string> {
  const { credentials, workspaceUrl, signal } = params;

  const pasted = credentials?.token;
  if (pasted) return pasted;

  const clientId = credentials?.clientId;
  const clientSecret = credentials?.clientSecret;
  if (!clientId || !clientSecret) {
    throw new ProviderSignInError(
      "databricks genie puller needs either a workspace token in credentials.token, " +
        "or a service principal's credentials.clientId and credentials.clientSecret",
      { reason: "not_configured" },
    );
  }

  // HTTP Basic rather than the secret in the body: the header is not written
  // to the request line, so it stays out of proxy and access logs.
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const timeout = AbortSignal.timeout(TOKEN_TIMEOUT_MS);

  const response = await ssrfSafeFetch(
    `${workspaceUrl.replace(/\/+$/, "")}/oidc/v1/token`,
    {
      method: "POST",
      headers: {
        authorization: `Basic ${basic}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials&scope=all-apis",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      // This request carries the client secret itself, not a token minted
      // from it. Following a redirect here would hand it to the redirect
      // target, and the helper follows up to ten by default.
      followRedirects: false,
    },
  );

  if (!response.ok) {
    // The status alone, never the body: a token endpoint may echo the request
    // back, and this reason is logged and shown on the source.
    throw new ProviderSignInError(
      `databricks genie puller could not sign in: the workspace refused the ` +
        `service principal's credentials (HTTP ${response.status})`,
      { reason: "refused", status: response.status },
    );
  }

  const parsed = tokenResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    // A proxy or captive portal answering 200 with something that is not a
    // token must not be carried forward as one — it would fail later as an
    // unauthorised Genie call and read as a permissions problem.
    throw new ProviderSignInError(
      "databricks genie puller could not sign in: the workspace answered the " +
        "sign-in without an access token",
      { reason: "malformed_response" },
    );
  }

  return parsed.data.access_token;
}

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

const WAREHOUSE_COST_STATEMENT = `
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
const warehouseCostResponseSchema = z.object({
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
const WAREHOUSE_COST_COLUMNS = [
  "statement_id",
  "usage_hour",
  "execution_ms_in_hour",
  "hour_total_ms",
  "hour_billable_usd",
  "currency_code",
  "sku_name",
] as const;

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
function warehouseCostParameters(chunk: {
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
      value: new Date(startOfHourMs(chunk.fromMs)).toISOString(),
      type: "TIMESTAMP",
    },
    // Where the SCAN starts, which is earlier than where the answer starts.
    // Statements that began before the window still burn compute inside it, and
    // an hour whose denominator omits them over-states everyone else's share of
    // that hour.
    {
      name: "scan_from_ts",
      value: new Date(
        startOfHourMs(chunk.fromMs) - WAREHOUSE_COST_STRADDLE_LOOKBACK_MS,
      ).toISOString(),
      type: "TIMESTAMP",
    },
    {
      name: "to_ts",
      value: new Date(endOfHourMs(chunk.toMs)).toISOString(),
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
type WarehouseCostRead =
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
type WarehouseCostChunkOutcome =
  | { done: true; pricedThroughMs: number | null; unreadable: boolean }
  | { done: false };

type WarehouseCostStatement = z.infer<typeof warehouseCostResponseSchema>;

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
const WAREHOUSE_COST_UNFINISHED_STATES = new Set([
  "CANCELED",
  "PENDING",
  "RUNNING",
]);

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
function unpricedFloor(chunk: { fromMs: number }): number {
  return chunk.fromMs - 1;
}

/**
 * The shape of a cost question, for the log line. Every defect this puller has
 * had was a timing one — too many questions for the run's deadline, or a wait
 * that sat inside the spread of how long answers take — and neither is visible
 * from an outcome alone, so each question records how wide it was.
 */
function warehouseCostObserved({
  adapter,
  warehouseId,
  chunk,
}: {
  adapter: string;
  warehouseId: string;
  chunk: { fromMs: number; toMs: number };
}) {
  return {
    adapter,
    warehouseId,
    askedFrom: new Date(startOfHourMs(chunk.fromMs)).toISOString(),
    askedTo: new Date(endOfHourMs(chunk.toMs)).toISOString(),
    askedHours: Math.round(
      (endOfHourMs(chunk.toMs) - startOfHourMs(chunk.fromMs)) / ONE_HOUR_MS,
    ),
  };
}

/**
 * The window is unpriced and we know why. Whether it is worth asking about
 * again is decided entirely here, and every state that is not a success used to
 * answer no. A statement cancelled for running past its wait is the one this
 * gets wrong most often: the warehouse was answering it perfectly well and
 * simply ran out of the time the request allowed, so the same question asked
 * again — or asked about less — answers fine.
 */
function readUnsuccessfulWarehouseCost({
  statement,
  log,
}: {
  statement: WarehouseCostStatement;
  log: Record<string, unknown>;
}): WarehouseCostRead {
  const unfinished = WAREHOUSE_COST_UNFINISHED_STATES.has(
    statement.status.state,
  );
  logger.warn(
    {
      ...log,
      state: statement.status.state,
      error: statement.status.error?.message,
    },
    unfinished
      ? "databricks warehouse cost query ran out of time; holding the window so it is asked again"
      : "databricks warehouse cost query did not succeed; the questions stay unpriced and the window is held",
  );
  return { outcome: unfinished ? "timed_out" : "failed" };
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
function warehouseAnswerCutShort({
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

/**
 * Turn one cost reply into per-statement cost, or refuse the whole reply.
 *
 * A refusal prices nothing from this reply — the questions are still recorded,
 * and a re-read leaves any cost an earlier run worked out alone. Refusing whole
 * is deliberate: a partial answer prices some questions and leaves the rest at
 * nothing, and nothing is indistinguishable from a question that genuinely cost
 * nothing.
 */
function readWarehouseCost({
  payload,
  adapter,
  warehouseId,
}: {
  payload: unknown;
  adapter: string;
  warehouseId: string;
}): WarehouseCostRead {
  const statement = warehouseCostResponseSchema.parse(payload);
  // Named for what it is. This warehouse ran the billing query; it is not the
  // warehouse whose compute the reply is about, and a log line that conflates
  // the two sends whoever reads it to the wrong workspace object.
  const log = { adapter, executorWarehouseId: warehouseId };

  if (statement.status.state !== "SUCCEEDED") {
    return readUnsuccessfulWarehouseCost({ statement, log });
  }

  // No manifest is a refusal, not a pass. The rows are positional and every
  // value in them is a string, so without the names there is nothing that could
  // tell a correct answer from a reordered one — which is the whole case this
  // check exists for. An answer we cannot check is one we cannot price from.
  const served = statement.manifest?.schema?.columns?.map((c) => c.name);
  if (!served || !WAREHOUSE_COST_COLUMNS.every((n, i) => served[i] === n)) {
    logger.error(
      { ...log, expected: WAREHOUSE_COST_COLUMNS, served },
      "databricks warehouse cost query answered with unexpected columns; refusing to price from it",
    );
    // Not `cut_short`: the answer arrived, it just could not be trusted. A
    // narrower window would be answered with the same columns.
    return { outcome: "failed" };
  }

  const data = statement.result?.data_array ?? [];

  if (warehouseAnswerCutShort({ statement, dataLength: data.length })) {
    logger.error(
      {
        ...log,
        rows: data.length,
        limit: WAREHOUSE_COST_ROW_LIMIT,
        totalRowCount: statement.manifest?.total_row_count,
        nextChunkIndex: statement.result?.next_chunk_index,
      },
      "databricks warehouse cost answer was cut short; refusing a partial answer",
    );
    return { outcome: "cut_short" };
  }

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

  // Every other refusal reaches the log through `skipped`. A row that would not
  // parse is the one case that would otherwise under-price in silence.
  if (unreadable > 0) {
    logger.warn(
      { ...log, unreadable, rows: data.length },
      "some databricks warehouse cost rows could not be read; those questions carry no cost",
    );
  }

  const { costByStatementId, skipped, owed } = allocateWarehouseCost({ rows });
  if (skipped.length > 0) {
    logger.warn(
      {
        ...log,
        skipped: skipped.length,
        // The reasons, not the rows: a workspace priced in one currency
        // produces one reason repeated a thousand times.
        reasons: [...new Set(skipped.map((entry) => entry.reason))],
        skus: [...new Set(skipped.map((entry) => entry.skuName))],
      },
      "some databricks warehouse compute could not be priced; those questions carry no cost",
    );
  }
  if (owed.size > 0) {
    logger.info(
      { ...log, owed: owed.size },
      "some databricks questions were seen but not billed yet; holding the watermark until their cost settles",
    );
  }
  return { outcome: "priced", costByStatementId, owed: owed.size > 0 };
}

/**
 * The paid Genie bill line, per person, per day, per price line.
 *
 * A separate statement from `WAREHOUSE_COST_STATEMENT`, and it has to be: that
 * one filters `usage_metadata.warehouse_id IS NOT NULL` because it prices
 * warehouse hours, and the rows this one reads carry no warehouse id at all.
 * Databricks bills Genie's own metered usage under
 * `billing_origin_product = 'GENIE'`, attributed to `identity_metadata.run_as`
 * — the identity the workload ran as, which is the job or query owner and not
 * necessarily the person who typed the question.
 * `usage_metadata.genie.surface` and `.channel` describe where the usage came
 * from.
 *
 * Grouped by person, day and SKU — and NOT by surface or channel. Those two are
 * how Databricks describes the usage, not what it bills, and the grouping here
 * is what becomes the row's identity downstream: a key cannot be changed once
 * money sits under it, so grouping on a description the provider is free to
 * add values to would mint a fresh row per description. They ride along as
 * labels, folded into a sorted list.
 *
 * Priced from `system.billing.list_prices`, LEFT joined: a SKU with no
 * published price (Genie's free line, `GENIE_FREE_USAGE`) comes back with its
 * quantity and a null amount, and lands that way — no price is not a price of
 * nothing. A SKU published AT zero is caught on the way in by
 * `withoutZeroPrice`, so it lands the same way rather than as a measured
 * zero. The price picked is the one in force during the day, dollars
 * preferred, latest start first; a price that changes part-way through a day
 * is applied to the whole day, which is the resolution the bill itself has.
 *
 * Dates are bound as DATE parameters rather than cast from timestamps, because
 * a cast goes through the session time zone and a UTC-midnight instant would
 * name the previous day in a workspace set west of Greenwich.
 */
const PAID_GENIE_BILL_STATEMENT = `
WITH genie_day AS (
  SELECT
    COALESCE(identity_metadata.run_as, '') AS run_as,
    usage_date,
    sku_name,
    SUM(usage_quantity) AS quantity,
    concat_ws(',', sort_array(collect_set(usage_metadata.genie.surface))) AS surfaces,
    concat_ws(',', sort_array(collect_set(usage_metadata.genie.channel))) AS channels
  FROM system.billing.usage
  WHERE billing_origin_product = 'GENIE'
    AND usage_date >= :from_date
    AND usage_date < :to_date
  GROUP BY 1, 2, 3
),
priced AS (
  SELECT run_as, usage_date, sku_name, quantity, surfaces, channels, currency_code, amount
  FROM (
    SELECT
      d.run_as,
      d.usage_date,
      d.sku_name,
      d.quantity,
      d.surfaces,
      d.channels,
      p.currency_code,
      CAST(d.quantity * p.pricing.effective_list.default AS DECIMAL(38, 12)) AS amount,
      ROW_NUMBER() OVER (
        PARTITION BY d.run_as, d.usage_date, d.sku_name
        ORDER BY CASE WHEN p.currency_code = 'USD' THEN 0 ELSE 1 END,
                 p.price_start_time DESC
      ) AS pick
    FROM genie_day d
    LEFT JOIN system.billing.list_prices p
      ON p.sku_name = d.sku_name
     AND p.price_start_time < CAST(date_add(d.usage_date, 1) AS TIMESTAMP)
     AND (p.price_end_time IS NULL OR p.price_end_time > CAST(d.usage_date AS TIMESTAMP))
  )
  WHERE pick = 1
)
SELECT
  run_as,
  CAST(usage_date AS STRING) AS usage_date,
  sku_name,
  CAST(quantity AS STRING)  AS quantity,
  CAST(amount AS STRING)    AS amount,
  currency_code,
  surfaces,
  channels
FROM priced
LIMIT ${WAREHOUSE_COST_ROW_LIMIT}
`;

/**
 * The columns `PAID_GENIE_BILL_STATEMENT` selects, in order. Checked against
 * the manifest for the same reason `WAREHOUSE_COST_COLUMNS` is: rows are
 * positional strings, and a reordered SELECT would file the quantity as the
 * amount without failing any parse.
 */
const PAID_GENIE_BILL_COLUMNS = [
  "run_as",
  "usage_date",
  "sku_name",
  "quantity",
  "amount",
  "currency_code",
  "surfaces",
  "channels",
] as const;

/** A decimal as the Statement Execution API renders one: digits, no float. */
const DECIMAL_STRING = /^-?\d+(\.\d+)?$/;

/**
 * One row of the paid bill: a person, a day, a price line, how much, and —
 * when a list price exists — what that is worth.
 */
const paidGenieBillRowSchema = z.object({
  /** Who ran the usage, as Databricks names them. Empty when it names nobody. */
  runAs: z.string(),
  usageDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  skuName: z.string().min(1),
  quantity: z.string().regex(DECIMAL_STRING),
  /** Null when no list price is published for the SKU on that day. */
  amount: z.string().regex(DECIMAL_STRING).nullable(),
  currencyCode: z.string().nullable(),
  surfaces: z.string(),
  channels: z.string(),
});
type PaidGenieBillRow = z.infer<typeof paidGenieBillRowSchema>;

/**
 * Whole days, both ends, as DATE parameters. The window arrives hour-aligned
 * from `warehouseCostChunks`; a day-aligned window in gives day boundaries
 * out, and the statement filters on `usage_date` half-open so consecutive
 * chunks never both carry the same day.
 */
function paidGenieBillParameters(chunk: {
  fromMs: number;
  toMs: number;
}): { name: string; value: string; type: string }[] {
  return [
    {
      name: "from_date",
      value: new Date(chunk.fromMs).toISOString().slice(0, 10),
      type: "DATE",
    },
    {
      name: "to_date",
      value: new Date(chunk.toMs).toISOString().slice(0, 10),
      type: "DATE",
    },
  ];
}

/**
 * What one bill reply turned out to be worth. The same four answers as
 * `WarehouseCostRead`, for the same reasons, with rows instead of shares.
 */
type PaidGenieBillRead =
  | { outcome: "priced"; rows: PaidGenieBillRow[] }
  | { outcome: "cut_short" }
  | { outcome: "timed_out" }
  | { outcome: "failed" };

/**
 * What one run of the paid bill read leaves behind for the cursor.
 *
 * `window` is null when no window was asked about at all — the read is off,
 * or on with no warehouse to run it on — so there is nothing to hold and no
 * hold to age. Otherwise `readThroughMs` is where the read's position lands:
 * the window's end when it finished, the start of the stopped piece when it
 * was `held`. `endMs` is where the position lands INSTEAD once a hold has
 * been aged out by `nextCursor`; carrying it here keeps that decision in the
 * one place that has the clock and the previous cursor.
 */
type PaidGenieBillOutcome = {
  events: NormalizedPullEvent[];
  window: { readThroughMs: number; endMs: number; held: boolean } | null;
  unreadable: boolean;
};

/**
 * Where a bill walk stopped short: the chunk or piece it could not read, and
 * whether that was a refusal rather than a period too large or too slow.
 */
type PaidGenieBillStop = {
  heldAt: { fromMs: number; toMs: number };
  unreadable: boolean;
};

/**
 * Turn one bill reply into rows, or refuse the whole reply. Refusing whole is
 * the same rule the warehouse read follows: a partial answer lands some of a
 * period's rows and leaves the rest absent, and absent is indistinguishable
 * from nobody having used Genie that day.
 */
function readPaidGenieBill({
  payload,
  adapter,
  warehouseId,
}: {
  payload: unknown;
  adapter: string;
  warehouseId: string;
}): PaidGenieBillRead {
  const statement = warehouseCostResponseSchema.parse(payload);
  const log = { adapter, executorWarehouseId: warehouseId, read: "genie_bill" };

  if (statement.status.state !== "SUCCEEDED") {
    const unfinished = WAREHOUSE_COST_UNFINISHED_STATES.has(
      statement.status.state,
    );
    logger.warn(
      {
        ...log,
        state: statement.status.state,
        error: statement.status.error?.message,
      },
      unfinished
        ? "databricks genie bill query ran out of time; holding the read so it is asked again"
        : "databricks genie bill query did not succeed; holding the read so it is asked again",
    );
    return { outcome: unfinished ? "timed_out" : "failed" };
  }

  const served = statement.manifest?.schema?.columns?.map((c) => c.name);
  if (!served || !PAID_GENIE_BILL_COLUMNS.every((n, i) => served[i] === n)) {
    logger.error(
      { ...log, expected: PAID_GENIE_BILL_COLUMNS, served },
      "databricks genie bill query answered with unexpected columns; refusing to read from it",
    );
    return { outcome: "failed" };
  }

  const data = statement.result?.data_array ?? [];
  if (warehouseAnswerCutShort({ statement, dataLength: data.length })) {
    logger.error(
      {
        ...log,
        rows: data.length,
        limit: WAREHOUSE_COST_ROW_LIMIT,
        totalRowCount: statement.manifest?.total_row_count,
        nextChunkIndex: statement.result?.next_chunk_index,
      },
      "databricks genie bill answer was cut short; refusing a partial answer",
    );
    return { outcome: "cut_short" };
  }

  let unreadable = 0;
  const rows = data.flatMap((columns) => {
    const parsed = paidGenieBillRowSchema.safeParse({
      runAs: columns[0] ?? "",
      usageDate: columns[1],
      skuName: columns[2],
      quantity: columns[3],
      amount: columns[4] ?? null,
      currencyCode: columns[5] ?? null,
      surfaces: columns[6] ?? "",
      channels: columns[7] ?? "",
    });
    if (!parsed.success) {
      unreadable += 1;
      return [];
    }
    return [withoutZeroPrice(parsed.data)];
  });
  if (unreadable > 0) {
    logger.warn(
      { ...log, unreadable, rows: data.length },
      "some databricks genie bill rows could not be read; those rows are not recorded",
    );
  }
  return { outcome: "priced", rows };
}

/**
 * A row priced at nothing lands with no amount, not with a zero.
 *
 * The statement's LEFT JOIN gives Genie's free line a null amount because no
 * list price exists for it — today. The day Databricks publishes that line at
 * zero, `quantity * 0` comes back as a well-formed decimal, passes the parse,
 * and lands as a measured zero dollars for usage nobody was billed for. The
 * same holds for any SKU listed at zero: a price of nothing is not a bill,
 * and the ledger reads a zero as one. So the free line (matched on the same
 * marker the warehouse allocation uses) and any zero amount are stripped to
 * quantity-only rows, which the record seam declines to price.
 */
function withoutZeroPrice(row: PaidGenieBillRow): PaidGenieBillRow {
  const free =
    row.skuName.includes(GENIE_FREE_USAGE_SKU_MARKER) ||
    (row.amount !== null && Number(row.amount) === 0);
  return free ? { ...row, amount: null, currencyCode: null } : row;
}

/**
 * One bill row as the event the ledger and the audit sink read.
 *
 * The identity the bill names in `run_as` is the actor — the owner the
 * workload ran as, not necessarily whoever asked the question, and the only
 * person Databricks puts on the charge. The price line is the model; there
 * is no agent, because the bill names no space and no warehouse ran it — a
 * warehouse id here would put compute on the agents screen as if it were a
 * thing people talk to. The day is the event's timestamp, so the record seam
 * buckets it under that day, and `dimensions` carries the person and the
 * price line and nothing else: surface and channel are labels on the row and
 * no part of its key. The rollup keys on TenantId, Day, CostSource, source,
 * Provider, Model, AgentId, CurrencyCode and RawActorId, and `Model` here is
 * the SKU where the warehouse allocation's is `databricks/genie`, so a bill
 * row and a warehouse row for the same person and day never share a cell.
 *
 * An amount only where a list price produced one. A row with none carries its
 * quantity and no `costUsd`, which the record seam declines to price — an
 * unpriced row, never a zero one.
 */
function paidGenieBillEvent(row: PaidGenieBillRow): NormalizedPullEvent {
  const currency = row.currencyCode ?? "USD";
  const money =
    row.amount === null
      ? {}
      : currency === "USD"
        ? { cost_usd: row.amount }
        : { cost_amount: row.amount, cost_currency: currency };
  const hintMoney =
    row.amount === null
      ? {}
      : { costUsd: row.amount, ...(currency === "USD" ? {} : { currency }) };

  return {
    source_event_id: `${PAID_GENIE_BILL_LINE}:${row.usageDate}:${row.skuName}:${row.runAs}`,
    event_timestamp: `${row.usageDate}T00:00:00.000Z`,
    actor: row.runAs,
    action: PAID_GENIE_BILL_LINE,
    target: row.skuName,
    ...money,
    tokens_input: 0,
    tokens_output: 0,
    raw_payload: JSON.stringify(row),
    extra: {
      runAs: row.runAs,
      usageDate: row.usageDate,
      skuName: row.skuName,
      quantity: row.quantity,
      surfaces: row.surfaces,
      channels: row.channels,
      priceCurrency: row.currencyCode ?? "",
      [PULLED_USAGE_HINT_KEY]: {
        costBasis: "provider_reported",
        // A list price, not the account's negotiated rate — an estimate by
        // construction, for the same reason the warehouse share is one.
        costStatus: "estimate",
        ...hintMoney,
        dimensions: {
          line: PAID_GENIE_BILL_LINE,
          runAs: row.runAs,
          skuName: row.skuName,
        },
        model: row.skuName,
      },
    },
  };
}

/**
 * Anything below this is epoch SECONDS; anything above it is epoch
 * MILLISECONDS. `1e11` splits them with no overlap that can occur in practice:
 * as milliseconds it is 1973-03-03, as seconds it is the year 5138.
 *
 * The unit is not documented. Databricks' own reference and its Genie guide
 * both example `created_timestamp` as `1719769718` — ten digits, seconds — while
 * most other Databricks APIs (Jobs, Dashboards) stamp milliseconds. We could
 * not settle it against a live workspace, and the failure mode of guessing
 * wrong is the one this adapter exists to avoid: a first run's watermark is
 * `now − 30 days`, so seconds read as milliseconds land in January 1970, sit
 * behind every watermark, and the source reports zero messages forever without
 * a single error. Detecting the unit costs one comparison and cannot be wrong
 * for any timestamp this century.
 */
const EPOCH_SECONDS_CEILING = 1e11;

/** Databricks' integer timestamp, in whichever unit it arrived, as epoch ms. */
function toEpochMs(value: number): number {
  return value < EPOCH_SECONDS_CEILING ? value * 1000 : value;
}

const ONE_HOUR_MS = 60 * 60 * 1000;

function startOfHourMs(ms: number): number {
  return Math.floor(ms / ONE_HOUR_MS) * ONE_HOUR_MS;
}

function endOfHourMs(ms: number): number {
  return Math.ceil(ms / ONE_HOUR_MS) * ONE_HOUR_MS;
}

/** The UTC midnight an instant falls after — the bill is published per day. */
function startOfDayMs(ms: number): number {
  return Math.floor(ms / ONE_DAY_MS) * ONE_DAY_MS;
}

/**
 * Statuses that mean the message will not change again.
 *
 * Genie populates `attachments` PROGRESSIVELY: a message is answerable while it
 * is still `PENDING_WAREHOUSE` or `EXECUTING_QUERY`, and the generated SQL —
 * the artefact this adapter exists to capture — may not be there yet. Reading
 * one mid-flight and letting the watermark move past it loses that SQL
 * permanently, because nothing ever asks for the message again.
 *
 * An UNRECOGNISED non-empty status counts as non-terminal on purpose. A status
 * Databricks adds later is far more likely to be another in-flight state than a
 * new way of being finished, and being wrong in this direction costs a re-read
 * where the other direction costs the record.
 *
 * A message with no status at all is left alone: some responses omit it, and
 * treating absent as in-flight would hold the watermark on every sweep forever.
 */
export const TERMINAL_MESSAGE_STATUSES: ReadonlySet<string> = new Set([
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "QUERY_RESULT_EXPIRED",
]);

/**
 * How long a message is given to settle before the sweep stops waiting for it.
 *
 * Holding the watermark is what makes an in-flight message get re-read, and a
 * message that never reaches a terminal status would hold it forever — turning
 * a bounded re-read into a permanent one over the whole window. After this it
 * is taken as it stands: whatever attachments it had are what we keep.
 */
const PENDING_SETTLE_GRACE_MS = 60 * 60 * 1000;

/** Whether this message may still gain the SQL we are here to record. */
function isSettling(status: string | null, createdMs: number): boolean {
  if (!status) return false;
  if (TERMINAL_MESSAGE_STATUSES.has(status)) return false;
  return Date.now() - createdMs < PENDING_SETTLE_GRACE_MS;
}

/**
 * The earlier of two watermark ceilings, treating null as "no ceiling".
 *
 * An unsettled message must not FREEZE the window, only hold it back to just
 * before itself. A workspace with real traffic has something mid-answer nearly
 * every time the sweep looks, so a boolean hold would stop `sinceMs` advancing
 * on exactly the workspaces that matter: the re-read window would grow by one
 * interval every interval until a sweep no longer fit in its request budget.
 */
function earliest(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

/**
 * The durable cursor.
 *
 * `sinceMs` is the watermark: a message is new when it was created after it.
 * `spaceId` is where a budget-truncated sweep resumes, so a large workspace
 * makes forward progress across runs instead of re-crawling from the top and
 * running out at the same place every time.
 */
const cursorSchema = z.object({
  sinceMs: z.number().int().nonnegative(),
  spaceId: z.string().nullable().default(null),
  /**
   * Where inside `spaceId` to resume, or null to start that space from the top.
   *
   * Space granularity alone is not enough. A space whose walk costs more than
   * one run's entire request budget could never be finished: every run would
   * restart it from the first conversation, run out at roughly the same place,
   * and the sweep would never advance past it — so no space ordered after it
   * would be swept either. Nothing was lost (the watermark is held), but
   * nothing arrived. This carries the position inside the space so each run
   * picks up where the last one stopped.
   */
  conversationId: z.string().nullable().default(null),
  /**
   * Whether anything was SKIPPED OVER earlier in the sweep now in flight.
   *
   * This is what separates "where do I carry on from" from "was this sweep
   * whole", and the two must not be the same answer. A space that 403s is
   * deliberately walked past so one unreadable space cannot cost the workspace
   * the others — but the resume point then moves beyond it, and once the sweep
   * finishes, nothing in the position alone remembers that a hole was left. The
   * watermark would advance over it.
   *
   * Making the resume point itself hang back at the hole fixes the loss and
   * buys starvation: a permanently unreadable space would pin the sweep there
   * forever and every space behind it would stop being read at all. So the
   * position keeps moving, and this flag — carried for as long as the sweep is
   * in flight — holds the watermark instead. A sweep with a gap finishes, keeps
   * its window, and starts over; nothing is lost and nothing is starved.
   */
  sweepHadGap: z.boolean().default(false),
  /**
   * Fingerprint of the space set the in-flight sweep is walking.
   *
   * Resuming skips every space before the resume point on the assumption that
   * an earlier run of this sweep already read them. That assumption breaks the
   * moment the resolved set GAINS a space sorting before the point — an admin
   * adding one to `spaceIds`, or a permission grant making one visible to
   * discovery. It would be skipped for the rest of the sweep, and the sweep
   * would then complete with no gap recorded and move the watermark over
   * everything in it.
   *
   * So the set is fingerprinted. A sweep that resumes into a different set is
   * not a resumption at all: the position is dropped and the sweep restarts
   * from the top, off the unchanged watermark, which re-reads everything.
   */
  spaceSetFingerprint: z.string().nullable().default(null),
  /**
   * The oldest message the sweep in flight saw that could still change, or
   * null. Carried across the sweep's runs so a message read on run one still
   * holds the window when run four finishes the sweep.
   */
  sweepOldestPendingMs: z.number().int().nonnegative().nullable().default(null),
  /**
   * When the sweep currently IN FLIGHT began, or null when none is.
   *
   * A sweep is not a run. The budget can cut one short and `spaceId` carries
   * it into the next run, so a large workspace is swept across several runs
   * over several scheduled ticks. The watermark has to anchor to when that
   * whole sweep started, which means the instant has to outlive the run that
   * stamped it — hence the cursor rather than a local.
   */
  sweepStartedAtMs: z.number().int().positive().nullable().default(null),
  /**
   * When the watermark first stopped for a bill it could not read, or null when
   * it is not stopped for one.
   *
   * The age of the hold, not its depth. A hold is a bet that the bill is merely
   * late, and the bet has to be callable: a day with more statements than one
   * reply can carry is cut short identically on every future run, and a hold
   * with no expiry pins the source to that instant forever while the sweep it
   * repeats grows wider each time. Depth cannot tell those apart — a first
   * sweep is legitimately thirty days back on its first run — so the instant
   * the hold BEGAN is what is carried, and it is cleared the moment a run
   * prices its window whole.
   *
   * Same shape as `sweepHadGap` above, and for the same reason: that flag
   * exists because making the resume point hang back at an unreadable space
   * bought starvation. This is the billing tables' version of the same trade.
   */
  costHeldSinceMs: z.number().int().positive().nullable().default(null),
  /**
   * How far the paid Genie bill read has reached, or null when it has never
   * finished a window — including when the read is switched off.
   *
   * The bill read's OWN position, and never the watermark's. The two reads
   * answer on different tables and fail independently: the warehouse
   * allocation holding for a late bill must not pin the bill line, and a bill
   * line cut short must not stop the watermark from moving over questions the
   * sweep read whole. A held bill read leaves this where the hold began, so
   * the next run asks about that period again; a finished one sets it to the
   * end of the window it read. `Math.max` on the way in keeps it monotonic.
   *
   * Written on a HELD first read as well as a finished one, and that is what
   * pins the floor: with no configured start the floor is "thirty days ago",
   * which is a different instant every run, so a first read that was refused
   * and wrote nothing would ask about a window that starts a day later each
   * day — losing a day of history per day while claiming to hold.
   */
  paidBillReadThroughMs: z
    .number()
    .int()
    .nonnegative()
    .nullable()
    .default(null),
  /**
   * When the paid bill read first stopped for a window it could not finish,
   * or null when it is not stopped for one.
   *
   * `costHeldSinceMs` for the other read, and for the same reason: a hold is
   * a bet that the bill is merely late, and a workspace that refuses the
   * billing tables every run would otherwise re-ask the same window forever.
   * Aged against `WAREHOUSE_COST_MAX_HOLD_MS`; once it runs out the position
   * moves to the end of the window that was asked about, the rows in it stay
   * unrecorded — with no amount, never zero — and the stamp is cleared so
   * the next hold ages from its own start. Cleared the moment a run reads its
   * window whole. Nullable with a default so a cursor written before the
   * field existed still parses.
   */
  paidBillHeldSinceMs: z.number().int().positive().nullable().default(null),
});
type GenieCursor = z.infer<typeof cursorSchema>;

/**
 * Where the watermark lands after a sweep.
 *
 * It moves ONLY on a complete sweep, and it is derived from when the sweep
 * BEGAN rather than from the newest message it saw. The difference is the
 * whole correctness argument: a sweep walks six spaces over some seconds or
 * minutes, and someone asking a question in space one while the sweep is
 * already reading space four is invisible to it. A watermark at the newest
 * message seen would sit AFTER that question's timestamp, and the next run
 * would filter it out — a message lost with nothing anywhere reporting a
 * failure. Anchored to the sweep's start, that question is still in the next
 * run's window.
 *
 * `sweepStartedAtMs` is the start of the SWEEP, which on a large workspace is
 * several runs back — not the start of the run calling this. Anchoring to the
 * current run would reintroduce the same loss on exactly the workspaces the
 * resume mechanism exists for: the gap between the first run and the last is
 * scheduling interval times the number of runs, and everything asked in an
 * already-swept space during that gap would be filtered out for good.
 *
 * `Math.max` against the previous value keeps it monotonic, so a clock that
 * steps backwards cannot rewind the window to the beginning of history.
 */
function nextWatermark({
  previousMs,
  sweepStartedAtMs,
  complete,
  oldestPendingMs,
  pricedThroughMs,
  holdExpired,
}: {
  previousMs: number;
  sweepStartedAtMs: number;
  complete: boolean;
  /**
   * The oldest message that may still change. The window stops just short of
   * it so it is read again, rather than stopping altogether — a busy workspace
   * always has something in flight, and freezing on that would grow the
   * re-read window without bound.
   */
  oldestPendingMs: number | null;
  /**
   * The instant past which this run could not work out what anything cost.
   *
   * A second ceiling, and it exists because a question recorded at zero is
   * indistinguishable from one that genuinely cost nothing. Moving the
   * watermark past a period whose bill we could have read but did not means no
   * later run ever looks at it again — later runs re-read only the settling
   * window — so the zero becomes the permanent answer. Stopping here costs a
   * re-read of a period already recorded, and re-emitting a message REPLACES
   * its ledger row, so the correct figure lands the moment the bill does.
   *
   * `null` when nothing is owed: the window priced whole, or the billing
   * question could not be answered at all and holding would stall forever.
   */
  pricedThroughMs: number | null;
  /**
   * Whether this hold has gone on long enough to stop being a bet on lateness.
   *
   * Decided by the caller from `costHeldSinceMs`, which the cursor carries —
   * same shape as `sweepHadGap`, and for the same reason: a hold with no way to
   * expire starves the thing it is protecting.
   */
  holdExpired: boolean;
}): number {
  if (!complete) return previousMs;
  const swept = sweepStartedAtMs - WATERMARK_LAG_MS;
  const pending =
    oldestPendingMs === null ? swept : Math.min(swept, oldestPendingMs - 1);
  // At, not just short of: `pricedThroughMs` is the END of the last period read
  // whole, so everything up to and including that instant has its cost.
  //
  // Only while the hold is still worth honouring. `holdExpired` is decided by
  // how LONG the watermark has been held, not by how far back it sits: a first
  // sweep starts thirty days behind and that is not a stall, whereas the same
  // instant refused for a week running is.
  const capped =
    pricedThroughMs === null || holdExpired
      ? pending
      : Math.min(pending, pricedThroughMs);
  // Never backwards. An unsettled message always sits above the previous
  // watermark (it passed that filter to be read at all), so this only guards
  // the arithmetic, but a watermark that could move back would re-read forever.
  //
  // It also absorbs the case where NOTHING priced: the cost read starts at or
  // below the watermark, so its ceiling lands under `previousMs` and the
  // watermark simply holds.
  return Math.max(previousMs, capped);
}

/**
 * The cursor's one invariant, enforced in the single place that mints one:
 * `conversationId` requires `spaceId`, and `spaceId` requires
 * `sweepStartedAtMs`.
 *
 * A resume point without the anchor it belongs to is worse than no resume
 * point. `runOnce` only treats a cursor as resuming when BOTH `spaceId` and
 * `sweepStartedAtMs` are set, so a cursor carrying a position but no anchor
 * would stamp a fresh anchor at now, still skip every space before the
 * position, complete, and then set the watermark from that fresh anchor —
 * losing everything it skipped. Cursors written before the anchor existed have
 * exactly that shape, so this is reachable rather than theoretical.
 */
function withoutOrphanedResume(cursor: GenieCursor): GenieCursor {
  if (cursor.sweepStartedAtMs !== null && cursor.spaceId !== null) {
    return cursor;
  }
  if (cursor.spaceId === null && cursor.conversationId === null) return cursor;
  logger.warn(
    { cursor },
    "databricks genie cursor carries a resume position with no sweep anchor; restarting the sweep from the top",
  );
  return {
    ...cursor,
    spaceId: null,
    conversationId: null,
    sweepHadGap: false,
    spaceSetFingerprint: null,
    // Safe to drop with the sweep it belonged to: `sinceMs` is untouched, so
    // the unsettled message is still inside the window the restart will read,
    // and the restarted sweep derives its own ceiling from it.
    sweepOldestPendingMs: null,
  };
}

function parseCursor(
  cursor: string | null,
  config: DatabricksGeniePullConfig,
): GenieCursor {
  if (cursor) {
    try {
      return withoutOrphanedResume(cursorSchema.parse(JSON.parse(cursor)));
    } catch {
      logger.warn(
        { cursor },
        "unreadable databricks genie cursor; restarting from the configured watermark",
      );
    }
  }
  return {
    sinceMs: configuredSinceMs(config),
    spaceId: null,
    conversationId: null,
    sweepHadGap: false,
    spaceSetFingerprint: null,
    sweepOldestPendingMs: null,
    sweepStartedAtMs: null,
    costHeldSinceMs: null,
    paidBillReadThroughMs: null,
    paidBillHeldSinceMs: null,
  };
}

/**
 * Where a read with no position yet starts: the configured instant, or the
 * last 30 days. Shared by the watermark's first run and the paid bill read's
 * first run, so switching the bill read on late still reads the same history
 * the source was told to begin at.
 */
function configuredSinceMs(config: DatabricksGeniePullConfig): number {
  const sinceMs = config.startingAt
    ? Date.parse(config.startingAt)
    : defaultSinceMs();
  return Number.isFinite(sinceMs) ? sinceMs : defaultSinceMs();
}

/** A first run with no configured watermark reads the last 30 days. */
function defaultSinceMs(): number {
  return Date.now() - 30 * 24 * 60 * 60 * 1000;
}

const conversationSchema = z
  .object({
    conversation_id: z.string(),
    title: z.string().nullable().default(null),
    created_timestamp: z.number().nullable().default(null),
  })
  .passthrough();

const conversationsPageSchema = z.object({
  conversations: z.array(conversationSchema).default([]),
  next_page_token: z.string().nullable().default(null),
});

/**
 * One Genie message. `attachments` is a union in the wire format — a text
 * reply, a generated query, a set of suggested follow-ups, a visualisation —
 * so everything but the id is optional and unknown members pass through.
 */
const attachmentSchema = z
  .object({
    attachment_id: z.string().optional(),
    query: z
      .object({
        query: z.string().nullable().default(null),
        description: z.string().nullable().default(null),
        statement_id: z.string().nullable().default(null),
        query_result_metadata: z
          .object({ row_count: z.number().nullable().default(null) })
          .passthrough()
          .nullable()
          .default(null),
      })
      .passthrough()
      .optional(),
    text: z
      .object({ content: z.string().nullable().default(null) })
      .passthrough()
      .optional(),
  })
  .passthrough();

const messageSchema = z
  .object({
    message_id: z.string(),
    conversation_id: z.string().nullable().default(null),
    space_id: z.string().nullable().default(null),
    /** Databricks' numeric account id for the author. Immutable. */
    user_id: z.number().nullable().default(null),
    /** The question, as the user typed it. */
    content: z.string().nullable().default(null),
    status: z.string().nullable().default(null),
    created_timestamp: z.number().nullable().default(null),
    attachments: z.array(attachmentSchema).nullable().default(null),
  })
  .passthrough();

const messagesPageSchema = z.object({
  messages: z.array(messageSchema).default([]),
  next_page_token: z.string().nullable().default(null),
});

const scimUserSchema = z
  .object({
    userName: z.string().nullable().default(null),
    externalId: z.string().nullable().default(null),
    displayName: z.string().nullable().default(null),
  })
  .passthrough();

/** Who asked, resolved once per run and reused across every message. */
interface GenieIdentity {
  /**
   * The stable identity key: the IdP's object id when the directory carries
   * one, the login name otherwise. `externalId` is written once at account
   * creation and is absent for accounts provisioned before SCIM was wired, so
   * it cannot be the sole key — an adapter that insisted on it would attribute
   * a real person's activity to nobody.
   */
  key: string;
  /** The email-shaped login, which is what `actor` means everywhere else. */
  email: string;
  externalId: string;
  displayName: string;
}

const UNKNOWN_IDENTITY: GenieIdentity = {
  key: "",
  email: "",
  externalId: "",
  displayName: "",
};

/**
 * The identity for a parsed SCIM user. Key precedence: the IdP object id when
 * the directory carries one, else the login email, else the raw numeric id —
 * see the `GenieIdentity.key` note for why `externalId` cannot stand alone.
 */
function genieIdentityFromScimUser(
  user: z.infer<typeof scimUserSchema>,
  userId: number,
): GenieIdentity {
  const email = user.userName ?? "";
  const externalId = user.externalId ?? "";
  return {
    key: externalId || email || String(userId),
    email,
    externalId,
    displayName: user.displayName ?? "",
  };
}

/**
 * Budgets one run's HTTP calls and its deadline in one place.
 *
 * Both limits mean the same thing to the caller — stop sweeping, keep what you
 * read, resume from the cursor — so they are one question rather than two
 * checks scattered through three nested loops.
 */
class RunBudget {
  private requests = 0;
  private readonly maxRequests: number;

  constructor(
    private readonly deadlineMs: number | undefined,
    maxRequests?: number,
  ) {
    this.maxRequests = maxRequests ?? MAX_REQUESTS_PER_RUN;
  }

  spend(): void {
    this.requests += 1;
  }

  exhausted(): boolean {
    if (this.requests >= this.maxRequests) return true;
    return this.deadlineMs !== undefined && Date.now() > this.deadlineMs;
  }

  /**
   * `exhausted`, asked on behalf of work that cannot be given up once it has
   * started: true when fewer than `reserveMs` of the deadline remain.
   *
   * `exhausted` is the wrong question before a long request. It only answers
   * once the deadline has ALREADY passed, and by then the worker has killed the
   * run and thrown away every event the sweep read — the request's own graceful
   * failure never gets to matter. Declining to start it is what keeps them.
   */
  exhaustedWithin(reserveMs: number): boolean {
    if (this.requests >= this.maxRequests) return true;
    return (
      this.deadlineMs !== undefined && Date.now() + reserveMs > this.deadlineMs
    );
  }
}

/**
 * What one sweep read, and whether it read all of it.
 *
 * TWO flags gate the watermark, and it needs both:
 *
 *   `complete` — the walk read everything it REACHED. False when the budget
 *   ran out, the deadline hit, or a listing was truncated; in every one of
 *   those cases the walk stopped where it was and the resume point says where.
 *
 *   `hadGap` — the walk reached PAST something it could not read. The resume
 *   point cannot express this, because the position moved beyond the hole.
 *
 * A sweep is whole only when it is complete AND had no gap. `hadGap` is
 * sweep-scoped here, not run-scoped: it is seeded from the in-flight cursor,
 * so a space skipped in run 1 still holds the watermark when run 4 finishes.
 */
interface SweepResult {
  events: NormalizedPullEvent[];
  complete: boolean;
  /** Which space to start at next run, when the budget cut this one short. */
  resumeSpaceId: string | null;
  /** Where inside that space to start, or null to take it from the top. */
  resumeConversationId: string | null;
  /**
   * Whether this run walked PAST something it could not read.
   *
   * Distinct from `complete`, which also covers the ordinary "ran out of
   * budget, will carry on next run" case. A gap is the case the resume point
   * cannot express, because the position moved beyond the hole — see
   * `cursorSchema.sweepHadGap`.
   */
  hadGap: boolean;
  /**
   * The oldest message this sweep saw that may still change, or null.
   *
   * A CEILING on the next watermark rather than a veto on it — see `earliest`.
   */
  oldestPendingMs: number | null;
  /** The space set this sweep is walking, for the next run to compare against. */
  spaceSetFingerprint: string;
}

/** One page of a Databricks list endpoint, and whether more were left unread. */
interface PagedRead<T> {
  items: T[];
  complete: boolean;
}

/**
 * The spaces to sweep in a deterministic order, plus where to start.
 *
 * Exactly the same argument as `conversationWalkPlan`, one level up, and for
 * exactly the same reason: resuming skips everything before the resume point,
 * which is only sound if a space cannot move across it between runs.
 * `/api/2.0/genie/spaces` carries no ordering guarantee either, so a space that
 * existed when the sweep began could sit after the resume point on one run and
 * before it on the next, never be read, and then fall outside the window once
 * the completed sweep advanced the watermark. Sorting on the immutable
 * `space_id` removes the dependency on the API's order.
 *
 * `resumable` is false when the space listing was itself truncated: a partial
 * list has no trustworthy position in it, so the sweep restarts from the top.
 */
function spaceWalkPlan({
  spaces,
  resumeSpaceId,
  resumeFingerprint,
}: {
  spaces: PagedRead<GenieSpace>;
  resumeSpaceId: string | null;
  resumeFingerprint: string | null;
}): {
  ordered: Array<GenieSpace>;
  startAt: number;
  resumable: boolean;
  fingerprint: string;
} {
  const ordered = [...spaces.items].sort((a, b) =>
    a.space_id < b.space_id ? -1 : a.space_id > b.space_id ? 1 : 0,
  );
  const fingerprint = ordered.map((s) => s.space_id).join("\u0000");
  // A set that changed under the sweep invalidates the position outright — see
  // `cursorSchema.spaceSetFingerprint`. Deletion alone is already safe (the
  // `Math.max` below restarts from the top), but an ADDITION sorting before the
  // resume point would be skipped and then dropped.
  const resumable =
    spaces.complete &&
    (resumeFingerprint === null || resumeFingerprint === fingerprint);
  // An id no longer in the list means the space was deleted since the cursor
  // was written; starting over only ever re-reads, and the watermark is held.
  const startAt =
    resumable && resumeSpaceId
      ? Math.max(
          ordered.findIndex((s) => s.space_id === resumeSpaceId),
          0,
        )
      : 0;
  return { ordered, startAt, resumable, fingerprint };
}

/**
 * One space's conversations in a deterministic order, plus where to start.
 *
 * The sort is the load-bearing part — see `spaceMessages` for why resuming is
 * only sound against an order we impose rather than the one the workspace
 * happened to return.
 *
 * `resumable` is false when the listing was itself cut short. A partial list
 * is only a PREFIX of the space's conversations, so a position inside it means
 * nothing: the conversations that would have sorted earlier may sit on a page
 * that was never read, and resuming into it would skip them permanently once
 * the sweep completed. Such a space restarts from the top instead — slower,
 * and still lossless.
 */
function conversationWalkPlan({
  conversations,
  resumeConversationId,
}: {
  conversations: PagedRead<z.infer<typeof conversationSchema>>;
  resumeConversationId: string | null;
}): {
  ordered: Array<z.infer<typeof conversationSchema>>;
  startAt: number;
  resumable: boolean;
} {
  const ordered = [...conversations.items].sort((a, b) =>
    a.conversation_id < b.conversation_id
      ? -1
      : a.conversation_id > b.conversation_id
        ? 1
        : 0,
  );
  const resumable = conversations.complete;
  // An id no longer in the list means the conversation was deleted since the
  // last run; starting the space over is safe for the same reason as a space.
  const startAt =
    resumable && resumeConversationId
      ? Math.max(
          ordered.findIndex((c) => c.conversation_id === resumeConversationId),
          0,
        )
      : 0;
  return { ordered, startAt, resumable };
}

/**
 * The result for a sweep that stopped early, on the given space.
 *
 * The resume point is dropped when the space listing was not resumable, which
 * restarts the sweep from the top rather than resuming into a position that was
 * never trustworthy.
 */
function sweptUpTo({
  events,
  space,
  at,
  hadGap,
  oldestPendingMs,
  spacePlan,
}: {
  events: NormalizedPullEvent[];
  space: GenieSpace;
  at: string | null;
  hadGap: boolean;
  oldestPendingMs: number | null;
  spacePlan: { resumable: boolean; fingerprint: string };
}): SweepResult {
  return {
    events,
    complete: false,
    resumeSpaceId: spacePlan.resumable ? space.space_id : null,
    resumeConversationId: spacePlan.resumable ? at : null,
    hadGap,
    oldestPendingMs,
    spaceSetFingerprint: spacePlan.fingerprint,
  };
}

/**
 * The result for a space walk that stopped early on a given conversation.
 *
 * The resume point is dropped when the plan says the space is not resumable
 * (a truncated listing), which turns the next run into a clean restart of the
 * space rather than a resume into a position that was never trustworthy.
 */
function stoppedAt({
  items,
  conversation,
  hadGap,
  oldestPendingMs,
  conversationPlan,
}: {
  items: NormalizedPullEvent[];
  conversation: z.infer<typeof conversationSchema>;
  hadGap: boolean;
  oldestPendingMs: number | null;
  conversationPlan: { resumable: boolean };
}): SpaceRead {
  return {
    items,
    complete: false,
    resumeConversationId: conversationPlan.resumable
      ? conversation.conversation_id
      : null,
    hadGap,
    oldestPendingMs,
  };
}

/** What one space's walk read, and where to pick it up if it was cut short. */
interface SpaceRead {
  items: NormalizedPullEvent[];
  complete: boolean;
  /**
   * The conversation to restart this space at, or null for "from the top".
   *
   * Null does not mean "finished" — read it together with `complete`. A space
   * whose conversation LISTING was itself cut short reports `complete: false`
   * with a null resume point, because a partial list has no trustworthy
   * position in it to resume from.
   *
   * `hadGap` says the walk carried on past a conversation it could not read,
   * which the resume point cannot express — see `cursorSchema.sweepHadGap`.
   */
  resumeConversationId: string | null;
  hadGap: boolean;
  /** The oldest message in this space that may still change, or null. */
  oldestPendingMs: number | null;
}

/**
 * A non-2xx from the workspace, carrying the status.
 *
 * The status is on the error rather than only in its message because one
 * caller has to branch on it: a 404 from SCIM is a permanent answer worth
 * caching, and every other code is a transient one that must not be.
 */
export class DatabricksGeniePuller
  implements PullerAdapter<DatabricksGeniePullConfig>
{
  readonly id: string = DATABRICKS_GENIE_ADAPTER_ID;

  /**
   * Requests one run may spend before handing the rest to the next.
   *
   * Production takes `MAX_REQUESTS_PER_RUN`. Tests lower it so "the budget runs
   * out at the Nth request" is a counted fact rather than a race against
   * wall-clock — the only way to drive a resume path deterministically. It sits
   * here rather than on `PullRunOptions` because no other adapter honours it,
   * and a knob on the shared contract that five of six adapters ignore is a
   * promise the next adapter author would reasonably believe.
   */
  private readonly maxRequests: number;

  constructor(options?: { maxRequests?: number }) {
    this.maxRequests = Math.max(
      1,
      options?.maxRequests ?? MAX_REQUESTS_PER_RUN,
    );
  }

  validateConfig(config: unknown): DatabricksGeniePullConfig {
    return databricksGeniePullConfigSchema.parse(config);
  }

  async runOnce(
    options: PullRunOptions,
    config: DatabricksGeniePullConfig,
  ): Promise<PullResult> {
    const token = await resolveWorkspaceToken({
      credentials: options.credentials,
      workspaceUrl: config.workspaceUrl,
      signal: options.signal,
    });

    const cursor = parseCursor(options.cursor, config);
    const budget = new RunBudget(options.deadlineMs, this.maxRequests);
    // Stamped BEFORE the first request when a FRESH sweep begins, and carried
    // unchanged through every run that resumes it. The next watermark is
    // derived from this instant, so anything created while the sweep is
    // running lands after it and is caught next time.
    //
    // Resuming is the case that matters: `spaceId` means a sweep is already in
    // flight, and re-stamping here would anchor the finished sweep to its LAST
    // run instead of its first, silently dropping everything asked in an
    // already-swept space in between. Reading the clock at the end of the run
    // would be the same bug, one step worse.
    const resuming =
      cursor.spaceId !== null && cursor.sweepStartedAtMs !== null;
    const sweepStartedAtMs = resuming ? cursor.sweepStartedAtMs! : Date.now();

    let sweep: SweepResult;
    try {
      sweep = await this.sweep({ config, token, options, budget, cursor });
    } catch (error) {
      // Only a failure to enumerate spaces reaches here — everything below it
      // is isolated. With no space list there is nothing to have read, so the
      // cursor stays put and the run is reported as failed.
      logger.error(
        {
          adapter: this.id,
          workspaceUrl: config.workspaceUrl,
          error: error instanceof Error ? error.message : String(error),
        },
        "databricks genie could not enumerate spaces; leaving the cursor where it was",
      );
      return { events: [], cursor: options.cursor, errorCount: 1 };
    }

    // After the sweep, not during it: the billing read covers the whole run at
    // once, and the window it asks about is the window the sweep actually read.
    // Asking first would either guess that window or ask per space. It is one
    // read of that window, taken a day at a time — see `warehouseCost`.
    const { costByStatementId, pricedThroughMs, unreadable } =
      await this.warehouseCost({
        config,
        token,
        options,
        budget,
        fromMs: costReadFloorMs({
          sinceMs: cursor.sinceMs,
          nowMs: sweepStartedAtMs,
          costEnabled: config.warehouseId !== undefined,
        }),
        toMs: Date.now(),
      });

    // The second, independent read: the paid Genie bill line, on its own
    // position. Only when the source switched it on; a source that did not
    // never posts the statement and its cursor field stays null.
    const paidBill: PaidGenieBillOutcome = config.readPaidGenieBill
      ? await this.paidGenieBill({ config, token, options, budget, cursor })
      : { events: [], window: null, unreadable: false };

    return {
      events: [
        ...withWarehouseCost({
          events: sweep.events,
          costByStatementId,
          costEnabled: config.warehouseId !== undefined,
          watermarkMs: cursor.sinceMs,
        }),
        ...paidBill.events,
      ],
      cursor: encode(
        // The cost read is part of what this run knows, so the watermark answers
        // to it as well as to the sweep. Without that, a window whose bill could
        // not be read is still recorded, still advanced past, and never revisited.
        nextCursor({
          previous: cursor,
          sweep,
          sweepStartedAtMs,
          pricedThroughMs,
          paidBillWindow: paidBill.window,
          nowMs: Date.now(),
        }),
      ),
      errorCount: 0,
      ...runNotices({
        unreadable,
        paidBillUnreadable: paidBill.unreadable,
      }),
    };
  }

  /**
   * The paid Genie bill line for the window this read owes, oldest first, a
   * week at a time, with a week that cannot be answered whole re-asked in days
   * — the same shape and the same helpers as `warehouseCost`, and the same hold
   * rule: cut short, timed out or refused, the walk stops and this read's own
   * position stays at the stopped piece, for as long as
   * `WAREHOUSE_COST_MAX_HOLD_MS` allows — `nextCursor` ages the hold and moves
   * the position to the window's end once it runs out. What is different is
   * what lands: every whole chunk or piece read before the stop lands its
   * rows; the answer that stopped short lands nothing, since which rows it
   * left out is exactly what it cannot say.
   *
   * Never throws, for the reason `warehouseCost` never does: the sweep's job
   * does not depend on this one.
   */
  private async paidGenieBill({
    config,
    token,
    options,
    budget,
    cursor,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: RunBudget;
    cursor: GenieCursor;
  }): Promise<PaidGenieBillOutcome> {
    const warehouseId = config.warehouseId;
    if (!warehouseId) {
      // Switched on with nothing to run it on. The statement needs a warehouse
      // to execute; without one the read cannot start, and the source has to
      // be told rather than left quietly reading nothing. No window either:
      // nothing was asked, so there is no place to hold and no hold to age.
      logger.warn(
        { adapter: this.id, workspaceUrl: config.workspaceUrl },
        "databricks genie bill read is switched on but the source names no warehouse to run it on",
      );
      return { events: [], window: null, unreadable: true };
    }

    // Day-aligned both ends: the bill is per day and the statement filters on
    // the date. Through the end of TODAY, so today's partial row lands and is
    // re-read next run — the settling lag on the way in is what re-reads it.
    const fromMs = startOfDayMs(
      cursor.paidBillReadThroughMs === null
        ? configuredSinceMs(config)
        : cursor.paidBillReadThroughMs - PAID_GENIE_BILL_SETTLING_LAG_MS,
    );
    const toMs = startOfDayMs(Date.now()) + ONE_DAY_MS;

    const rows: PaidGenieBillRow[] = [];
    for (const chunk of warehouseCostChunks({ fromMs, toMs })) {
      const stop = await this.walkPaidGenieBillChunk({
        config,
        token,
        options,
        budget,
        warehouseId,
        chunk,
        rows,
      });
      if (stop !== null) {
        return this.paidGenieBillHeld({
          rows,
          heldAt: stop.heldAt,
          windowEndMs: toMs,
          unreadable: stop.unreadable,
        });
      }
    }

    return {
      events: rows.map(paidGenieBillEvent),
      window: { readThroughMs: toMs, endMs: toMs, held: false },
      unreadable: false,
    };
  }

  /**
   * One chunk of the bill window: whether the run still has room for it, the
   * answer, and — when the answer is not whole — the pieces. Rows land on
   * `rows` as they answer. Returns where the walk stopped, or null once the
   * whole chunk has landed, the same split `priceWarehouseCostChunk` makes.
   */
  private async walkPaidGenieBillChunk({
    config,
    token,
    options,
    budget,
    warehouseId,
    chunk,
    rows,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: RunBudget;
    warehouseId: string;
    chunk: { fromMs: number; toMs: number };
    rows: PaidGenieBillRow[];
  }): Promise<PaidGenieBillStop | null> {
    if (budget.exhaustedWithin(WAREHOUSE_COST_TIMEOUT_MS)) {
      return { heldAt: chunk, unreadable: false };
    }
    const answer = await this.paidGenieBillChunk({
      config,
      token,
      options,
      budget,
      warehouseId,
      chunk,
    });
    if (answer.outcome === "priced") {
      rows.push(...answer.rows);
      return null;
    }
    if (answer.outcome === "failed") {
      return { heldAt: chunk, unreadable: true };
    }

    // Cut short or timed out: ask about less before holding, exactly as the
    // warehouse read does, so the days that answer on their own still land.
    const pieces = warehouseCostPieces(chunk);
    if (pieces.length === 0) {
      return { heldAt: chunk, unreadable: false };
    }
    return await this.walkPaidGenieBillPieces({
      config,
      token,
      options,
      budget,
      warehouseId,
      pieces,
      rows,
    });
  }

  /**
   * The pieces of a chunk that would not answer whole, in order. Every piece
   * that answers lands its rows; the first that does not stops the walk there,
   * so the days before it are never re-asked.
   */
  private async walkPaidGenieBillPieces({
    config,
    token,
    options,
    budget,
    warehouseId,
    pieces,
    rows,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: RunBudget;
    warehouseId: string;
    pieces: { fromMs: number; toMs: number }[];
    rows: PaidGenieBillRow[];
  }): Promise<PaidGenieBillStop | null> {
    for (const piece of pieces) {
      if (budget.exhaustedWithin(WAREHOUSE_COST_TIMEOUT_MS)) {
        return { heldAt: piece, unreadable: false };
      }
      const answer = await this.paidGenieBillChunk({
        config,
        token,
        options,
        budget,
        warehouseId,
        chunk: piece,
      });
      if (answer.outcome === "priced") {
        rows.push(...answer.rows);
        continue;
      }
      return { heldAt: piece, unreadable: answer.outcome === "failed" };
    }
    return null;
  }

  /**
   * The walk stopped at `heldAt`. Everything read before it lands; the
   * position holds at the start of the stopped piece so it is asked about
   * again — whether or not anything landed. A read that stopped at its very
   * first chunk holds at the window's floor, and writing that floor down is
   * what keeps it: a first run's floor is "thirty days ago" unless the source
   * was told otherwise, so a hold that wrote nothing would start a day later
   * on every run and quietly lose the day before it each time.
   */
  private paidGenieBillHeld({
    rows,
    heldAt,
    windowEndMs,
    unreadable,
  }: {
    rows: PaidGenieBillRow[];
    heldAt: { fromMs: number; toMs: number };
    windowEndMs: number;
    unreadable: boolean;
  }): PaidGenieBillOutcome {
    logger.warn(
      {
        adapter: this.id,
        heldFrom: new Date(heldAt.fromMs).toISOString(),
        heldTo: new Date(heldAt.toMs).toISOString(),
        landed: rows.length,
        unreadable,
      },
      "databricks genie bill read stopped short; holding its place so the period is asked about again",
    );
    return {
      events: rows.map(paidGenieBillEvent),
      window: { readThroughMs: heldAt.fromMs, endMs: windowEndMs, held: true },
      unreadable,
    };
  }

  /** One window of the bill line, read or refused. */
  private async paidGenieBillChunk({
    config,
    token,
    options,
    budget,
    warehouseId,
    chunk,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: RunBudget;
    warehouseId: string;
    chunk: { fromMs: number; toMs: number };
  }): Promise<PaidGenieBillRead> {
    const askedAtMs = Date.now();
    const observed = {
      adapter: this.id,
      warehouseId,
      read: "genie_bill",
      askedFrom: new Date(chunk.fromMs).toISOString(),
      askedTo: new Date(chunk.toMs).toISOString(),
    };
    try {
      const payload = await this.post({
        config,
        token,
        options,
        budget,
        path: "/api/2.0/sql/statements",
        body: {
          warehouse_id: warehouseId,
          statement: PAID_GENIE_BILL_STATEMENT,
          // Same wait as the warehouse read, for the same measured reason.
          wait_timeout: "50s",
          on_wait_timeout: "CANCEL",
          format: "JSON_ARRAY",
          disposition: "INLINE",
          parameters: paidGenieBillParameters(chunk),
        },
      });
      const read = readPaidGenieBill({
        payload,
        adapter: this.id,
        warehouseId,
      });
      logger.info(
        {
          ...observed,
          outcome: read.outcome,
          elapsedMs: Date.now() - askedAtMs,
          rows: read.outcome === "priced" ? read.rows.length : 0,
        },
        "databricks genie bill question answered",
      );
      return read;
    } catch (error) {
      // The same split as `warehouseCostChunk`: only an answer that will be
      // the same next run is a refusal.
      const unfinished =
        !(error instanceof GenieHttpError) ||
        error.status === 429 ||
        error.status >= 500;
      logger.warn(
        {
          ...observed,
          elapsedMs: Date.now() - askedAtMs,
          error: error instanceof Error ? error.message : String(error),
        },
        unfinished
          ? "databricks genie bill could not be reached; holding the read so it is asked again"
          : "databricks genie bill was refused; holding the read so it is asked again",
      );
      return { outcome: unfinished ? "timed_out" : "failed" };
    }
  }

  /**
   * Walks spaces → conversations → messages, keeping everything it manages to
   * read and reporting whether it read all of it.
   *
   * Each space, and each conversation within it, is isolated. One space the
   * credential cannot see must not cost the workspace the other five: this API
   * has no partial-failure response, so a 403 on space four would otherwise
   * unwind the run and discard three spaces' worth of already-read messages,
   * forever, because the next run would hit the same 403 at the same point.
   *
   * A failure does still suppress the watermark, so nothing behind the broken
   * space is skipped — the cost of a permanently unreadable space is a sweep
   * that keeps re-reading the rest, which is loud and lossless rather than
   * quiet and lossy.
   */
  private async sweep({
    config,
    token,
    options,
    budget,
    cursor,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: RunBudget;
    cursor: GenieCursor;
  }): Promise<SweepResult> {
    // One SCIM lookup per author per run, not per message. A conversation is
    // many messages by one person, so the naive version would ask the identity
    // provider the same question dozens of times inside one sweep.
    const identities = new Map<number, GenieIdentity>();
    const events: NormalizedPullEvent[] = [];

    const spaces = await this.resolveSpaces({ config, token, options, budget });
    let complete = spaces.complete;

    const spacePlan = spaceWalkPlan({
      spaces,
      resumeSpaceId: cursor.spaceId,
      resumeFingerprint: cursor.spaceSetFingerprint,
    });
    // Seeded from the sweep already in flight, so this means "this SWEEP walked
    // past something", not "this run did". The resume point keeps moving
    // forward so the rest of the workspace still gets swept; this is what stops
    // the watermark once the sweep finally finishes.
    let hadGap = cursor.sweepHadGap;
    // Seeded from the sweep in flight for the same reason as `hadGap`.
    let oldestPendingMs: number | null = cursor.sweepOldestPendingMs;

    for (let i = spacePlan.startAt; i < spacePlan.ordered.length; i += 1) {
      const space = spacePlan.ordered[i]!;
      // Only the space the cursor actually stopped in inherits the conversation
      // resume point. Every space after it is taken from the top.
      const resumeConversationId =
        space.space_id === cursor.spaceId ? cursor.conversationId : null;

      if (budget.exhausted()) {
        // Everything read so far is kept and the watermark is held. The
        // conversation position is handed back rather than dropped, so a run
        // that ends before it could touch this space does not undo the progress
        // an earlier run already made inside it.
        return sweptUpTo({
          events,
          space,
          at: resumeConversationId,
          hadGap,
          oldestPendingMs,
          spacePlan,
        });
      }

      const read = await this.spaceMessages({
        config,
        token,
        options,
        budget,
        space,
        // Not `cursor.sinceMs` directly: a source that prices its questions
        // reads further back than its watermark, because a question's compute
        // is published well after the question. The watermark itself is
        // untouched — `nextCursor` derives it from the cursor, not from this —
        // so this only ever widens what a run reads.
        // Read against the clock rather than the sweep's anchor: "far enough
        // back that the bill has landed" is a statement about now. A resumed
        // sweep carries an anchor that may be hours old, and deriving the floor
        // from it would widen the window for no benefit.
        sinceMs: costReadFloorMs({
          sinceMs: cursor.sinceMs,
          nowMs: Date.now(),
          costEnabled: config.warehouseId !== undefined,
        }),
        identities,
        resumeConversationId,
      });
      events.push(...read.items);
      complete = complete && read.complete;
      // A gap inside the space, or this whole space unreadable. Either way the
      // sweep is about to move past something it never saw.
      hadGap = hadGap || read.hadGap;
      oldestPendingMs = earliest(oldestPendingMs, read.oldestPendingMs);

      // Out of budget with this space unfinished — resume ON it, so its tail is
      // re-read rather than half-skipped. `read.resumeConversationId` narrows
      // that re-read to where it stopped, which is what lets a space bigger
      // than one run's whole budget finish across several runs.
      if (!read.complete && budget.exhausted()) {
        return sweptUpTo({
          events,
          space,
          at: read.resumeConversationId,
          hadGap,
          oldestPendingMs,
          spacePlan,
        });
      }
    }

    return {
      events,
      complete,
      resumeSpaceId: null,
      resumeConversationId: null,
      hadGap,
      oldestPendingMs,
      spaceSetFingerprint: spacePlan.fingerprint,
    };
  }

  /**
   * Every new message across one space's conversations, resumable partway.
   *
   * The conversation list is walked in a DETERMINISTIC order this method
   * imposes itself — sorted by `conversation_id` — rather than in whatever
   * order the workspace happened to return it. That sort is what makes
   * `resumeConversationId` safe.
   *
   * Resuming means skipping every conversation before the resume point, and
   * that is only sound if a conversation cannot MOVE across it between runs.
   * Databricks documents no ordering guarantee for this endpoint, so without a
   * sort of our own a conversation that existed when the sweep began could sit
   * after the resume point on one run and before it on the next, get skipped
   * for the rest of the sweep, and then be filtered out for good once the
   * completed sweep advanced the watermark past its messages. Sorting on an
   * immutable key removes the dependency on the API's ordering entirely.
   *
   * A conversation CREATED while the sweep is in flight may still sort before
   * the resume point and be skipped — and that is fine, because every message
   * in it is necessarily newer than `sweepStartedAtMs`, which is where the
   * watermark lands. The next sweep picks it up.
   */
  private async spaceMessages({
    config,
    token,
    options,
    budget,
    space,
    sinceMs,
    identities,
    resumeConversationId,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: RunBudget;
    space: GenieSpace;
    sinceMs: number;
    identities: Map<number, GenieIdentity>;
    resumeConversationId: string | null;
  }): Promise<SpaceRead> {
    const conversations = await this.listConversations({
      config,
      token,
      options,
      budget,
      space,
    });
    if (!conversations)
      // The whole space is unreadable. The sweep carries on to the others, so
      // this is a gap by definition.
      return {
        items: [],
        complete: false,
        resumeConversationId: null,
        hadGap: true,
        // Nothing was read, so nothing here is waiting to settle. `hadGap`
        // already holds the watermark for this space on its own.
        oldestPendingMs: null,
      };

    const conversationPlan = conversationWalkPlan({
      conversations,
      resumeConversationId,
    });
    const walked = await this.walkConversations({
      config,
      token,
      options,
      budget,
      space,
      sinceMs,
      identities,
      conversationPlan,
    });

    // A truncated LISTING keeps the space incomplete even when everything the
    // walk actually saw was read in full — there are pages of conversations it
    // never got to.
    return {
      ...walked,
      complete: walked.complete && conversations.complete,
    };
  }

  /**
   * Reads one space's conversations in the planned order, stopping when the
   * budget runs out.
   *
   * Stopping hands back the conversation to restart ON — not the one after it
   * — so a conversation whose message pages were cut partway is re-read rather
   * than half-skipped.
   */
  private async walkConversations({
    config,
    token,
    options,
    budget,
    space,
    sinceMs,
    identities,
    conversationPlan,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: RunBudget;
    space: GenieSpace;
    sinceMs: number;
    identities: Map<number, GenieIdentity>;
    conversationPlan: ReturnType<typeof conversationWalkPlan>;
  }): Promise<SpaceRead> {
    const events: NormalizedPullEvent[] = [];
    let complete = true;
    // Set when the walk carries on past a conversation it could not read.
    let hadGap = false;
    let oldestPendingMs: number | null = null;

    for (
      let i = conversationPlan.startAt;
      i < conversationPlan.ordered.length;
      i += 1
    ) {
      const conversation = conversationPlan.ordered[i]!;
      if (budget.exhausted()) {
        return stoppedAt({
          items: events,
          conversation,
          hadGap,
          oldestPendingMs,
          conversationPlan,
        });
      }

      const step = await this.readConversation({
        config,
        token,
        options,
        budget,
        space,
        conversation,
        sinceMs,
        identities,
      });

      events.push(...step.events);
      complete = complete && !step.unfinished;
      hadGap = hadGap || step.failed;
      // Not a gap: nothing was skipped. It only keeps the watermark behind this
      // message so the sweep comes back once the warehouse has answered.
      oldestPendingMs = earliest(oldestPendingMs, step.oldestPendingMs);

      // Out of budget with this conversation unfinished — resume ON it so its
      // tail is re-read. An isolated failure with budget still left falls
      // through and keeps going, so one broken conversation cannot wedge the
      // space; `hadGap` is what stops the watermark for it instead.
      if (step.unfinished && budget.exhausted()) {
        return stoppedAt({
          items: events,
          conversation,
          hadGap,
          oldestPendingMs,
          conversationPlan,
        });
      }
    }

    return {
      items: events,
      complete,
      resumeConversationId: null,
      hadGap,
      oldestPendingMs,
    };
  }

  /**
   * One conversation folded into the walk: what it produced, and how it ended.
   *
   * Isolated — a single conversation the credential cannot see, or one that
   * 429s, must not cost the space the rest of its conversations. `failed` is
   * that case and becomes a gap, which holds the watermark. `unfinished` also
   * covers a clean budget cut partway through its pages, which is NOT a gap
   * because the walk stops right there rather than stepping over anything.
   */
  private async readConversation({
    config,
    token,
    options,
    budget,
    space,
    conversation,
    sinceMs,
    identities,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: RunBudget;
    space: GenieSpace;
    conversation: z.infer<typeof conversationSchema>;
    sinceMs: number;
    identities: Map<number, GenieIdentity>;
  }): Promise<{
    events: NormalizedPullEvent[];
    unfinished: boolean;
    failed: boolean;
    /**
     * The oldest message in it that may still change, or null if none can.
     * A ceiling on the watermark, not a veto on it.
     */
    oldestPendingMs: number | null;
  }> {
    const read = await this.isolate({
      what: "messages",
      context: {
        spaceId: space.space_id,
        conversationId: conversation.conversation_id,
      },
      run: () =>
        this.conversationMessages({
          config,
          token,
          options,
          budget,
          space,
          conversation,
          sinceMs,
          identities,
        }),
    });
    return {
      events: read?.items ?? [],
      unfinished: read === null || !read.complete,
      failed: read === null,
      oldestPendingMs: read?.oldestPendingMs ?? null,
    };
  }

  /**
   * Every conversation in one space, or null when the space could not be read.
   *
   * Isolated: a space the credential cannot see must not cost the workspace
   * the others, so the caller turns a null into `complete: false` rather than
   * letting the failure unwind the whole sweep.
   */
  private async listConversations({
    config,
    token,
    options,
    budget,
    space,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: RunBudget;
    space: GenieSpace;
  }): Promise<PagedRead<z.infer<typeof conversationSchema>> | null> {
    return await this.isolate({
      what: "conversations",
      context: { spaceId: space.space_id },
      run: () =>
        this.paginate({
          config,
          token,
          options,
          budget,
          path: `/api/2.0/genie/spaces/${encodeURIComponent(space.space_id)}/conversations`,
          // Without this the endpoint answers with the CALLER'S OWN
          // conversations only, and a governance sweep would quietly report one
          // service account's activity as the workspace's.
          query: { include_all: "true" },
          parse: (body) => {
            const page = conversationsPageSchema.parse(body);
            return { items: page.conversations, next: page.next_page_token };
          },
        }),
    });
  }

  /** The configured spaces, or every space the credential can see. */
  private async resolveSpaces({
    config,
    token,
    options,
    budget,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: RunBudget;
  }): Promise<PagedRead<GenieSpace>> {
    if (config.spaceIds.length > 0) {
      // A pinned list still gets titles where they can be had. The title is
      // what a human reads on the governance screen — "ACME Revenue Analyst"
      // rather than `01f190cfd5c1…` — and a source that pinned its spaces
      // should not be the one that reads worse.
      //
      // Best-effort, and deliberately so: a credential permitted to read a
      // space's conversations but not to enumerate the workspace is a real
      // configuration, and it must keep working. A failed lookup costs the
      // label, never the records, so it neither fails the run nor marks the
      // sweep incomplete.
      const discovered = await this.isolate({
        what: "space titles",
        context: {},
        run: () => this.discoverSpaces({ config, token, options, budget }),
      });
      const titles = new Map(
        (discovered?.items ?? []).map((s) => [s.space_id, s.title]),
      );
      return {
        items: config.spaceIds.map((space_id) => ({
          space_id,
          title: titles.get(space_id) ?? null,
        })),
        complete: true,
      };
    }

    return await this.discoverSpaces({ config, token, options, budget });
  }

  /** Every Genie space the credential can enumerate. */
  private async discoverSpaces({
    config,
    token,
    options,
    budget,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: RunBudget;
  }): Promise<PagedRead<GenieSpace>> {
    // Through `walkGenieSpaces` rather than the local `paginate`, so the
    // on-demand agent listing and this sweep enumerate spaces the same way:
    // one endpoint, one schema, one cycle check. What stays here is the
    // stopping rule, which is the only part the two callers disagree on.
    const walk = await walkGenieSpaces({
      readPage: (query) =>
        this.get({
          config,
          token,
          options,
          budget,
          path: GENIE_SPACES_PATH,
          query,
        }),
      stop: () => budget.exhausted(),
      pageSize: PAGE_SIZE,
    });
    return { items: walk.spaces, complete: walk.complete };
  }

  /** Every new message in one conversation, mapped to events. */
  private async conversationMessages({
    config,
    token,
    options,
    budget,
    space,
    conversation,
    sinceMs,
    identities,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: RunBudget;
    space: GenieSpace;
    conversation: z.infer<typeof conversationSchema>;
    sinceMs: number;
    identities: Map<number, GenieIdentity>;
  }): Promise<
    PagedRead<NormalizedPullEvent> & { oldestPendingMs: number | null }
  > {
    const messages = await this.paginate({
      config,
      token,
      options,
      budget,
      path: `/api/2.0/genie/spaces/${encodeURIComponent(space.space_id)}/conversations/${encodeURIComponent(conversation.conversation_id)}/messages`,
      parse: (body) => {
        const page = messagesPageSchema.parse(body);
        return { items: page.messages, next: page.next_page_token };
      },
    });

    const events: NormalizedPullEvent[] = [];
    let oldestPendingMs: number | null = null;
    for (const message of messages.items) {
      const raw = message.created_timestamp;
      // A message with no timestamp cannot be placed against the watermark, and
      // emitting it would either re-emit it on every future sweep or file it
      // under `now`. Skipping it loses one row; the alternatives corrupt the
      // window for every row after it.
      if (raw === null || !Number.isFinite(raw)) {
        logger.warn(
          { adapter: this.id, messageId: message.message_id },
          "genie message has no created_timestamp; skipping",
        );
        continue;
      }
      const createdMs = toEpochMs(raw);
      if (createdMs <= sinceMs) continue;

      // Emitted either way — a question asked is a governance fact the moment
      // it is asked, and the OCSF sink replaces on message id, so the settled
      // version overwrites this one. What this buys is the guarantee that there
      // IS a next look: the watermark is kept behind the oldest message that
      // could still change, so the sweep comes back for it.
      if (isSettling(message.status, createdMs)) {
        oldestPendingMs = earliest(oldestPendingMs, createdMs);
      }

      events.push(
        this.messageEvent({
          message,
          space,
          conversation,
          createdMs,
          identity: await this.identityFor({
            config,
            token,
            options,
            budget,
            userId: message.user_id,
            identities,
          }),
        }),
      );
    }
    return { items: events, complete: messages.complete, oldestPendingMs };
  }

  /**
   * Walks one paginated Databricks list endpoint to the end, or to the budget.
   *
   * `complete: false` says pages were left unread. It is NOT an error and the
   * items already read are returned — the caller's job is to make sure the
   * watermark does not step over what is missing.
   *
   * A `next_page_token` that has already been seen in this walk is refused
   * rather than followed. Databricks pages by opaque token, so a token that
   * revisits a page is a contract violation, and following it would spend the
   * run's whole request budget re-reading the same pages and then report "out
   * of budget" — indistinguishable, from the outside, from a workspace that is
   * merely large. Same shape as `has_more` with no token, same answer.
   *
   * The whole set is tracked, not just the previous token: A → B → A is a
   * cycle too, and a check against only the last one walks it forever.
   */
  private async paginate<T>({
    config,
    token,
    options,
    budget,
    path,
    query,
    parse,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: RunBudget;
    path: string;
    query?: Record<string, string>;
    parse: (body: unknown) => { items: T[]; next: string | null };
  }): Promise<PagedRead<T>> {
    const items: T[] = [];
    let page: string | null = null;
    const seen = new Set<string>();

    for (;;) {
      if (budget.exhausted()) return { items, complete: false };

      const parsed = parse(
        await this.get({
          config,
          token,
          options,
          budget,
          path,
          query: {
            ...(query ?? {}),
            page_size: String(PAGE_SIZE),
            ...(page ? { page_token: page } : {}),
          },
        }),
      );
      items.push(...parsed.items);

      if (parsed.next === null) return { items, complete: true };
      if (seen.has(parsed.next)) {
        throw new Error(
          `databricks genie ${path} returned a page_token it had already served; refusing to re-read pages in a cycle`,
        );
      }
      seen.add(parsed.next);
      page = parsed.next;
    }
  }

  /**
   * Runs one unit of the walk, answering null instead of throwing.
   *
   * This is where "keep what we read" is actually implemented. The caller turns
   * a null into `complete: false`, which holds the watermark, so a failure
   * costs freshness rather than data.
   */
  private async isolate<T>({
    what,
    context,
    run,
  }: {
    what: string;
    context: Record<string, string>;
    run: () => Promise<T>;
  }): Promise<T | null> {
    try {
      return await run();
    } catch (error) {
      logger.error(
        {
          adapter: this.id,
          ...context,
          error: error instanceof Error ? error.message : String(error),
        },
        `databricks genie could not read ${what}; keeping the rest of the sweep and holding the watermark`,
      );
      return null;
    }
  }

  /**
   * The person behind a numeric author id, cached for the run.
   *
   * Only a 404 is remembered. A missing user is a permanent answer — the
   * account is gone, and asking again once per message would turn one deleted
   * user into hundreds of wasted calls. Anything else (a 429, a 503, a socket
   * reset) is transient, and caching THAT would take one unlucky moment and
   * silently strip the author off every remaining message in the run.
   *
   * Either way the event still lands. An unattributed question is worth
   * recording, and a directory hiccup must not cost the workspace its
   * visibility.
   */
  private async identityFor({
    config,
    token,
    options,
    budget,
    userId,
    identities,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: RunBudget;
    userId: number | null;
    identities: Map<number, GenieIdentity>;
  }): Promise<GenieIdentity> {
    if (userId === null) return UNKNOWN_IDENTITY;
    const cached = identities.get(userId);
    if (cached) return cached;

    try {
      const user = scimUserSchema.parse(
        await this.get({
          config,
          token,
          options,
          budget,
          path: `/api/2.0/preview/scim/v2/Users/${encodeURIComponent(String(userId))}`,
        }),
      );
      const identity = genieIdentityFromScimUser(user, userId);
      identities.set(userId, identity);
      return identity;
    } catch (error) {
      const gone = error instanceof GenieHttpError && error.status === 404;
      logger.warn(
        {
          adapter: this.id,
          userId,
          permanent: gone,
          error: error instanceof Error ? error.message : String(error),
        },
        "could not resolve a genie author through SCIM; recording the message unattributed",
      );
      // Only the permanent answer is remembered. A transient failure is left
      // uncached so the next message gets a fresh attempt.
      if (gone) identities.set(userId, UNKNOWN_IDENTITY);
      return UNKNOWN_IDENTITY;
    }
  }

  /**
   * One message → one visibility record.
   *
   * The dimensions are the message's own coordinates and nothing else. Not the
   * author: identity resolution can change between pulls (a backfilled
   * `externalId`, a renamed account) and an author in the key would mint a
   * SECOND record for a message that has not changed. Not the space title
   * either, for the same reason — it is a label an admin can edit.
   */
  private messageEvent({
    message,
    space,
    conversation,
    createdMs,
    identity,
  }: {
    message: z.infer<typeof messageSchema>;
    space: GenieSpace;
    conversation: z.infer<typeof conversationSchema>;
    createdMs: number;
    identity: GenieIdentity;
  }): NormalizedPullEvent {
    const generated = message.attachments?.find((a) => a.query?.query);
    const dimensions = {
      spaceId: space.space_id,
      conversationId: conversation.conversation_id,
      messageId: message.message_id,
    };

    return {
      source_event_id: message.message_id,
      event_timestamp: new Date(createdMs).toISOString(),
      // The login when the directory has one, the identity key otherwise. An
      // account with no `userName` still has an object id or a numeric id, and
      // an empty `actor` would drop it out of every actor-filtered SIEM view —
      // present-but-not-an-email beats absent.
      actor: identity.email || identity.key,
      action: "genie_query",
      target: space.title ?? space.space_id,
      // No amount at the point the message is built — not zero. Genie bills
      // nothing per message, and the warehouse compute behind it is not on
      // this API; a source that names a warehouse has that share attached
      // afterwards, once the run's billing read has answered (see
      // `withWarehouseCost`). Until then there is no bill to back a figure,
      // and a zero here is indistinguishable from a question that genuinely
      // cost nothing: the record seam reads `cost_usd` as the reported amount
      // when the hint names none, so a "0" would land on the ledger as a
      // measurement.
      tokens_input: 0,
      tokens_output: 0,
      raw_payload: JSON.stringify(message),
      extra: {
        spaceId: space.space_id,
        spaceTitle: space.title ?? "",
        conversationId: conversation.conversation_id,
        conversationTitle: conversation.title ?? "",
        messageId: message.message_id,
        status: message.status ?? "",
        // The two artefacts this adapter exists to surface.
        question: message.content ?? "",
        generatedSql: generated?.query?.query ?? "",
        statementId: generated?.query?.statement_id ?? "",
        rowCount: generated?.query?.query_result_metadata?.row_count ?? null,
        // The resolved author, all three forms. `actorKey` is the one to join
        // on; the other two are what a human reads.
        actorKey: identity.key,
        actorEmail: identity.email,
        actorExternalId: identity.externalId,
        actorDisplayName: identity.displayName,
        actorUserId: message.user_id === null ? "" : String(message.user_id),
        [PULLED_USAGE_HINT_KEY]: {
          costBasis: "provider_reported",
          // Never `exact`. The figure, when one is attached, is a share of an
          // hourly bill worked out from LIST prices, because the account's
          // negotiated rate is on no table this token can read.
          costStatus: "estimate",
          // No `costUsd` here, deliberately. The hint declares the message a
          // cost item and names its coordinates; the amount is attached by
          // `withCost` once the warehouse bill has answered, and a
          // provider-reported hint with no amount is one the record seam
          // declines to price — an unpriced question, never a zero one. A
          // source that names no warehouse has no bill to attach and stays
          // unpriced for good, which is the honest figure for it.
          dimensions,
          // The space IS the agent here — the configured thing people talk to
          // (#7881). Same value as `dimensions.spaceId`, deliberately: the
          // record seam keeps the agent out of the restatement key, and the
          // rollup's AgentId column gets it from this field alone.
          agentId: space.space_id,
          model: GENIE_MODEL,
        },
      },
    };
  }

  /**
   * What each Genie statement in the window cost, and how much of that window
   * the answer actually covers.
   *
   * Never throws, in any failure mode. This runs alongside a sweep whose job is
   * to record what people asked of the data, and that job does not depend on
   * this one: a workspace that has not granted the billing tables, or whose
   * metastore is briefly unavailable, should still get its activity. The
   * alternative trades the thing that always works for the thing that sometimes
   * does.
   *
   * The window is read a chunk at a time, oldest first, and the walk stops at
   * the first period it cannot price. `pricedThroughMs` is where it stopped,
   * and the caller keeps the watermark at or below it so that period is asked
   * about again next run instead of being written off. A first sweep spans
   * thirty days, and without that the whole month would be recorded at zero the
   * one time a busy warehouse tripped the row cap — permanently, because later
   * runs only re-read the settling window and would never look at those days
   * again.
   *
   * A chunk that cannot be answered whole is re-asked in days before the walk
   * gives up on it. Only a chunk that is REFUSED — the question reached billing
   * and billing said no — skips that, since asking the same question about less
   * gets the same no. A refusal still holds the watermark, exactly as an
   * answer cut short does: the questions in that period are recorded without
   * an amount, and moving past them would turn "not yet priced" into a figure
   * nothing later corrects. A credential that is refused forever is what the
   * hold's expiry (`WAREHOUSE_COST_MAX_HOLD_MS`) is for — the source moves on
   * after it, and the questions it leaves behind stay unpriced rather than
   * zero.
   *
   * `null` means no ceiling is owed: the whole window priced.
   */
  private async warehouseCost({
    config,
    token,
    options,
    budget,
    fromMs,
    toMs,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: RunBudget;
    fromMs: number;
    toMs: number;
  }): Promise<{
    costByStatementId: Map<string, WarehousePricedStatement> | null;
    /** The instant past which cost is not known. `null` owes no ceiling. */
    pricedThroughMs: number | null;
    /**
     * Whether the hold above is for a bill that was REFUSED rather than merely
     * late or large — the case a reader of the source has to be told about,
     * because waiting will not fix it on its own.
     */
    unreadable: boolean;
  }> {
    const warehouseId = config.warehouseId;
    if (!warehouseId) {
      return {
        costByStatementId: null,
        pricedThroughMs: null,
        unreadable: false,
      };
    }

    const costByStatementId = new Map<string, WarehousePricedStatement>();

    for (const chunk of warehouseCostChunks({ fromMs, toMs })) {
      const outcome = await this.priceWarehouseCostChunk({
        config,
        token,
        options,
        budget,
        warehouseId,
        chunk,
        costByStatementId,
      });
      if (outcome.done) {
        return {
          costByStatementId,
          pricedThroughMs: outcome.pricedThroughMs,
          unreadable: outcome.unreadable,
        };
      }
    }

    return { costByStatementId, pricedThroughMs: null, unreadable: false };
  }

  /**
   * One chunk of the sweep: whether the run still has room for it, the answer,
   * and — when the answer is not whole — the pieces. `done` stops the walk with
   * a ceiling; `!done` carries it to the next chunk.
   */
  private async priceWarehouseCostChunk({
    config,
    token,
    options,
    budget,
    warehouseId,
    chunk,
    costByStatementId,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: RunBudget;
    warehouseId: string;
    chunk: { fromMs: number; toMs: number };
    costByStatementId: Map<string, WarehousePricedStatement>;
  }): Promise<WarehouseCostChunkOutcome> {
    // Out of requests, or out of the time one more would need, with days still
    // unpriced. Those days are not refused, just unread, so the watermark holds
    // here and the next run starts its cost read where this one ran out — which
    // is what turns a month-long backfill into several runs that each progress.
    //
    // The time half has to be asked BEFORE the request, against the whole of
    // `WAREHOUSE_COST_TIMEOUT_MS`. A billing read still in flight when the
    // worker's deadline lands does not merely go unpriced: the worker kills the
    // run and discards the questions the sweep had already read, and the cursor
    // stays where it was, so the next run reads them and stalls in the same
    // place. Unpriced questions are recoverable; a run killed holding them is
    // the sweep done for nothing.
    if (budget.exhaustedWithin(WAREHOUSE_COST_TIMEOUT_MS)) {
      logger.warn(
        {
          adapter: this.id,
          warehouseId,
          pricedThrough: new Date(chunk.fromMs).toISOString(),
        },
        "databricks warehouse cost has no room left in this run; holding the watermark at the last priced day",
      );
      return {
        done: true,
        pricedThroughMs: unpricedFloor(chunk),
        unreadable: false,
      };
    }

    const read = await this.warehouseCostChunk({
      config,
      token,
      options,
      budget,
      warehouseId,
      chunk,
    });

    // The question itself was answered, and the answer was no. Asking about
    // less would be answered no the same way, so the pieces are not tried —
    // but the period is HELD, not written off. The questions in it are
    // recorded without an amount, and the watermark stops here so they are
    // asked about again: a warehouse that was deleted, a grant that was
    // revoked, or a token that lost its scope can all be put right, and the
    // day the bill answers is the day those questions get their figure.
    // Moving on instead would leave them unpriced forever with nothing
    // reporting it. `WAREHOUSE_COST_MAX_HOLD_MS` is what stops a refusal that
    // is never put right from pinning the source.
    if (read.outcome === "failed") {
      logger.error(
        {
          adapter: this.id,
          warehouseId,
          pricedThrough: new Date(chunk.fromMs).toISOString(),
        },
        "databricks warehouse cost could not be read; holding the watermark so the period is asked about again",
      );
      return {
        done: true,
        pricedThroughMs: unpricedFloor(chunk),
        unreadable: true,
      };
    }

    if (read.outcome === "priced") {
      // A statement is emitted for every chunk it burned compute in, carrying
      // that chunk's hours only, so a statement running across a boundary
      // arrives here twice with a different part of itself. `mergeWarehouseCost`
      // adds rather than replaces for exactly that reason — see the ownership
      // note on the hour clip in `WAREHOUSE_COST_STATEMENT`.
      mergeWarehouseCost({
        into: costByStatementId,
        from: read.costByStatementId,
      });
      // Priced, but not wholly: a statement here was seen and has no bill yet.
      // Hold the watermark at the chunk's start so the whole chunk is re-read
      // once billing lands, rather than moving past the unbilled statement and
      // recording it at zero for good. The statements that did price keep the
      // cost merged above; a re-read simply replaces their ledger rows with the
      // same figure. The hold is bounded by `WAREHOUSE_COST_MAX_HOLD_MS`, so a
      // statement that is never billed stops holding the source after that.
      if (read.owed) {
        return {
          done: true,
          pricedThroughMs: unpricedFloor(chunk),
          unreadable: false,
        };
      }
      return { done: false };
    }

    // Either more rows exist here than one reply can carry, or the answer did
    // not come back in time. Both are reasons to ask about LESS rather than to
    // give up on the period: surrendering the whole chunk costs every question
    // inside it its cost figure, including the days that would have answered on
    // their own.
    return this.warehouseCostChunkInPieces({
      config,
      token,
      options,
      budget,
      warehouseId,
      chunk,
      read,
      costByStatementId,
    });
  }

  /**
   * A chunk that could not be priced whole, re-asked in smaller pieces. Every
   * piece that answers is priced into the shared map; the walk stops at the
   * first that does not.
   *
   * Paid for only once a chunk has actually been refused, so a workspace whose
   * chunks answer never spends a request here. `done` tells the walk whether to
   * stop with a ceiling — some piece was refused, or the run ran out of room —
   * or carry on to the next chunk because every piece priced. When a piece is
   * refused the ceiling holds at that piece, not at the start of the chunk it
   * was in: the pieces answered before it keep their cost and are never asked
   * about again.
   */
  private async warehouseCostChunkInPieces({
    config,
    token,
    options,
    budget,
    warehouseId,
    chunk,
    read,
    costByStatementId,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: RunBudget;
    warehouseId: string;
    chunk: { fromMs: number; toMs: number };
    read: WarehouseCostRead;
    costByStatementId: Map<string, WarehousePricedStatement>;
  }): Promise<WarehouseCostChunkOutcome> {
    const pieces = warehouseCostPieces(chunk);
    logger.warn(
      {
        adapter: this.id,
        warehouseId,
        outcome: read.outcome,
        chunkFrom: new Date(chunk.fromMs).toISOString(),
        chunkTo: new Date(chunk.toMs).toISOString(),
        pieces: pieces.length,
      },
      "databricks warehouse cost could not price a period whole; asking about smaller pieces of it",
    );

    const walked =
      pieces.length === 0
        ? { heldAt: chunk, unreadable: false }
        : await this.walkWarehouseCostPieces({
            config,
            token,
            options,
            budget,
            warehouseId,
            pieces,
            costByStatementId,
          });

    if (walked.heldAt) {
      logger.error(
        {
          adapter: this.id,
          warehouseId,
          pricedThrough: new Date(walked.heldAt.fromMs).toISOString(),
          refusedTo: new Date(walked.heldAt.toMs).toISOString(),
          unreadable: walked.unreadable,
        },
        "databricks warehouse cost could not price a period even in pieces; holding the watermark so it is asked again",
      );
      return {
        done: true,
        pricedThroughMs: unpricedFloor(walked.heldAt),
        unreadable: walked.unreadable,
      };
    }

    return { done: false };
  }

  /**
   * The pieces in order: every piece that prices is merged — even one still
   * owing a bill keeps its billed hours' worth — and the first that stops the
   * walk (refused, owing, cut short, or outrunning the run's budget) is
   * returned as where the watermark holds. A refusal to a piece is still a
   * refusal to the question, and it is the same one whichever size it was
   * asked at: it holds at that piece like every other stop, and is flagged
   * `unreadable` so the run can say so. `heldAt: null` says every piece
   * priced whole.
   */
  private async walkWarehouseCostPieces({
    config,
    token,
    options,
    budget,
    warehouseId,
    pieces,
    costByStatementId,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: RunBudget;
    warehouseId: string;
    pieces: { fromMs: number; toMs: number }[];
    costByStatementId: Map<string, WarehousePricedStatement>;
  }): Promise<{
    heldAt: { fromMs: number; toMs: number } | null;
    unreadable: boolean;
  }> {
    for (const piece of pieces) {
      if (budget.exhaustedWithin(WAREHOUSE_COST_TIMEOUT_MS)) {
        return { heldAt: piece, unreadable: false };
      }

      const pieceRead = await this.warehouseCostChunk({
        config,
        token,
        options,
        budget,
        warehouseId,
        chunk: piece,
      });

      if (pieceRead.outcome === "failed") {
        return { heldAt: piece, unreadable: true };
      }
      if (pieceRead.outcome !== "priced") {
        return { heldAt: piece, unreadable: false };
      }
      // Merged BEFORE the owed check, the same order the full-chunk path
      // uses: a piece can be owed for one hour and priced for others, and the
      // priced shares belong to this run's records rather than to nothing. The
      // hold below re-reads the piece once billing settles, and that re-read
      // replaces the ledger rows with the same figure — so keeping the cost
      // now costs nothing later.
      mergeWarehouseCost({
        into: costByStatementId,
        from: pieceRead.costByStatementId,
      });
      // A statement in this piece has no bill yet. Hold at the piece, exactly
      // as a refusal to it would: the pieces before it kept their cost and are
      // never re-asked, and this one is re-read once its billing settles.
      if (pieceRead.owed) {
        return { heldAt: piece, unreadable: false };
      }
    }
    return { heldAt: null, unreadable: false };
  }

  /** One chunk of the window, priced or refused. */
  private async warehouseCostChunk({
    config,
    token,
    options,
    budget,
    warehouseId,
    chunk,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: RunBudget;
    warehouseId: string;
    chunk: { fromMs: number; toMs: number };
  }): Promise<WarehouseCostRead> {
    const askedAtMs = Date.now();
    const observed = warehouseCostObserved({
      adapter: this.id,
      warehouseId,
      chunk,
    });

    try {
      const payload = await this.post({
        config,
        token,
        options,
        budget,
        path: "/api/2.0/sql/statements",
        body: {
          warehouse_id: warehouseId,
          statement: WAREHOUSE_COST_STATEMENT,
          // One request, no polling. A query that cannot finish inside the
          // wait is cancelled, and the window it covered is held rather than
          // written off, so the next run asks about it again. Polling would
          // hold a run open on the slowest thing it does.
          //
          // Fifty seconds is the most the API accepts, and it is asked for
          // because the warehouse routinely needs more than the thirty this
          // used to allow. Measured against a real workspace on 2026-08-19,
          // five reads of a week each came back in 10.8s, 23.4s, 26.9s, 37.7s
          // and 22.0s — a thirty-second limit sits inside that spread and
          // cancels answers that were on their way.
          //
          // Still inside the client's own `WAREHOUSE_COST_TIMEOUT_MS`, which
          // stays the outer bound: the warehouse gives up before this end does,
          // so a cancelled statement is reported rather than merely abandoned.
          wait_timeout: "50s",
          on_wait_timeout: "CANCEL",
          format: "JSON_ARRAY",
          disposition: "INLINE",
          parameters: warehouseCostParameters(chunk),
        },
      });

      const read = readWarehouseCost({
        payload,
        adapter: this.id,
        warehouseId,
      });
      logger.info(
        {
          ...observed,
          outcome: read.outcome,
          elapsedMs: Date.now() - askedAtMs,
          statements:
            read.outcome === "priced" ? read.costByStatementId.size : 0,
          owed: read.outcome === "priced" ? read.owed : false,
        },
        "databricks warehouse cost question answered",
      );
      return read;
    } catch (error) {
      // The same split the statement states get, at the other door. A request
      // this end gave up on, or one the workspace could not serve right now,
      // says nothing about whether the window can ever be priced. Only an
      // answer that will be the same next run is a refusal: a token without
      // the grant, or a warehouse that no longer exists, is refused
      // identically until an admin puts it right. Both hold the window; the
      // difference is that a refusal skips the smaller pieces and is reported
      // to whoever reads the source, since waiting alone will not fix it.
      const unfinished =
        !(error instanceof GenieHttpError) ||
        error.status === 429 ||
        error.status >= 500;
      logger.warn(
        {
          ...observed,
          elapsedMs: Date.now() - askedAtMs,
          error: error instanceof Error ? error.message : String(error),
        },
        unfinished
          ? "databricks warehouse cost could not be reached; holding the window so it is asked again"
          : "databricks warehouse cost was refused; the questions stay unpriced and the window is held",
      );
      return { outcome: unfinished ? "timed_out" : "failed" };
    }
  }

  /** One authenticated POST, budgeted and abortable. */
  private async post({
    config,
    token,
    options,
    budget,
    path,
    body,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: RunBudget;
    path: string;
    body: unknown;
  }): Promise<unknown> {
    const url = new URL(path, config.workspaceUrl);

    const signal = options.signal
      ? AbortSignal.any([
          options.signal,
          AbortSignal.timeout(WAREHOUSE_COST_TIMEOUT_MS),
        ])
      : AbortSignal.timeout(WAREHOUSE_COST_TIMEOUT_MS);

    budget.spend();
    const response = await ssrfSafeFetch(url.toString(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
      // See the sibling call above: a redirect would carry this token onward.
      followRedirects: false,
    });
    if (!response.ok) {
      throw new GenieHttpError({
        status: response.status,
        statusText: response.statusText,
        path,
      });
    }
    return await response.json();
  }

  private async get({
    config,
    token,
    options,
    budget,
    path,
    query,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: RunBudget;
    path: string;
    query?: Record<string, string>;
  }): Promise<unknown> {
    // Spending the budget is this wrapper's whole job. The request itself is
    // shared with the on-demand agent listing, which has no budget to spend.
    budget.spend();
    return await genieGet({
      workspaceUrl: config.workspaceUrl,
      token,
      path,
      query,
      signal: options.signal,
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
  }
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
 *   new, unpriced   → carry the hint with NO amount, so the ledger declines
 *                     to write a figure: an unpriced question, never a zero
 *                     one. The amount lands on the re-read that prices it.
 *   re-read, unpriced → carry NO usage hint at all, so the event is audit-only
 *                     and the ledger is not asked to write anything.
 *
 * That last case is the whole reason this function knows about the watermark.
 * A re-read happens only because the source is trying to learn a cost; if it
 * did not learn one — billing was refused, the hour is not published yet — then
 * emitting anything would overwrite a figure an earlier run had already worked
 * out correctly, and a few minutes of billing trouble would quietly wipe the
 * spend it could not confirm.
 */
function withWarehouseCost({
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

  return events.map((event) =>
    withCost({ event, costByStatementId, watermarkMs }),
  );
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

  const askedAtMs = Date.parse(event.event_timestamp);
  const isReread = Number.isFinite(askedAtMs) && askedAtMs <= watermarkMs;
  if (!isReread) return event;

  const { [PULLED_USAGE_HINT_KEY]: _dropped, ...auditOnly } = extra;
  return { ...event, extra: auditOnly };
}

function encode(cursor: GenieCursor): string {
  return JSON.stringify(cursor);
}

/**
 * The notices field, or nothing at all.
 *
 * Absent rather than empty on a clean run, on `openaiAdmin.puller.ts`'s
 * precedent: a reader never has to tell an adapter that reported no notices
 * from one that reports none because it does not know how.
 */
function runNotices({
  unreadable,
  paidBillUnreadable,
}: {
  unreadable: boolean;
  paidBillUnreadable: boolean;
}): { notices?: string[] } {
  const notices = [
    ...(unreadable ? [WAREHOUSE_COST_UNREADABLE] : []),
    ...(paidBillUnreadable ? [PAID_GENIE_BILL_UNREADABLE] : []),
  ];
  return notices.length > 0 ? { notices } : {};
}

/**
 * The cursor one run hands to the next.
 *
 * The whole in-flight/finished distinction lives here: a sweep that still owes
 * a space keeps its position, its anchor and its gap flag; a sweep that is done
 * drops all three so the next run starts clean.
 */
function nextCursor({
  previous,
  sweep,
  sweepStartedAtMs,
  pricedThroughMs,
  paidBillWindow,
  nowMs,
}: {
  previous: GenieCursor;
  sweep: SweepResult;
  sweepStartedAtMs: number;
  /** Where cost knowledge ran out this run — see `nextWatermark`. */
  pricedThroughMs: number | null;
  /**
   * What the paid bill read did this run, or null when it asked about no
   * window. Its own position — see the cursor field — so it is folded here
   * and nowhere near `sinceMs` or the cost hold.
   */
  paidBillWindow: PaidGenieBillOutcome["window"];
  /** This run's clock, for ageing both holds. */
  nowMs: number;
}): GenieCursor {
  // `sweep.hadGap` is already sweep-scoped — it was seeded from this cursor —
  // so there is nothing to fold here. One name, one meaning, one place it
  // accumulates.
  const stillSweeping = sweep.resumeSpaceId !== null;

  // The hold starts the first run that owes a ceiling and survives across runs
  // that keep owing one; any run that prices its window whole clears it, so a
  // billing table that recovers costs nothing and the clock does not carry over
  // to the next thing that goes wrong.
  const costHeldSinceMs =
    pricedThroughMs === null ? null : (previous.costHeldSinceMs ?? nowMs);
  const holdExpired =
    costHeldSinceMs !== null &&
    nowMs - costHeldSinceMs > WAREHOUSE_COST_MAX_HOLD_MS;

  return {
    // A sweep that walked past something it never read is not whole, no matter
    // how tidily it finished. Holding the window costs a re-read of the same
    // period next sweep; advancing it would drop whatever was in the hole,
    // permanently.
    sinceMs: nextWatermark({
      previousMs: previous.sinceMs,
      sweepStartedAtMs,
      complete: sweep.complete && !sweep.hadGap,
      oldestPendingMs: sweep.oldestPendingMs,
      pricedThroughMs,
      holdExpired,
    }),
    spaceId: sweep.resumeSpaceId,
    // Meaningless without a space to resume into, so it is cleared with it
    // rather than left behind to be matched against some later sweep's space
    // by accident.
    conversationId: stillSweeping ? sweep.resumeConversationId : null,
    // Carried only while the sweep is still in flight; a finished sweep starts
    // the next one clean.
    sweepHadGap: stillSweeping ? sweep.hadGap : false,
    // Pinned to the position; a finished sweep starts the next one clean.
    spaceSetFingerprint: stillSweeping ? sweep.spaceSetFingerprint : null,
    // Carried only while the sweep is in flight. Once it finishes, the ceiling
    // has already been folded into `sinceMs` above and must not be re-applied.
    sweepOldestPendingMs: stillSweeping ? sweep.oldestPendingMs : null,
    // Held only while the sweep is still in flight, so the next run stamps a
    // fresh anchor rather than inheriting a stale one and re-reading forever.
    sweepStartedAtMs: stillSweeping ? sweepStartedAtMs : null,
    // Cleared once expired as well as once priced: the watermark has already
    // moved past the period, so leaving the stamp would expire every subsequent
    // hold on arrival and the retry would never work again.
    costHeldSinceMs: holdExpired ? null : costHeldSinceMs,
    // The bill read's own position and hold, folded here and nowhere near
    // `sinceMs` or the cost hold above.
    ...nextPaidBillPosition({ previous, paidBillWindow, nowMs }),
  };
}

/**
 * The paid bill read's position and hold for the next run.
 *
 * The hold is aged the same way as the cost hold, on its own stamp. A run that
 * asked about no window — the read is off, or on with no warehouse — clears
 * it: the source is not waiting on a bill, and a stamp left running against a
 * misconfiguration would expire the hold the moment the source was fixed.
 * Once expired, the position moves to the end of the window this run asked
 * about — the rows in it stay unrecorded, with no amount — and the stamp is
 * cleared so the next hold ages from its own start.
 *
 * The position never moves backwards: a run that asked about no window leaves
 * it exactly where the last run that did put it. A held read writes its floor
 * too — that is the whole point of the hold — and the max keeps the settling
 * look-back from walking the floor backwards a run at a time.
 */
function nextPaidBillPosition({
  previous,
  paidBillWindow,
  nowMs,
}: {
  previous: GenieCursor;
  paidBillWindow: PaidGenieBillOutcome["window"];
  nowMs: number;
}): Pick<GenieCursor, "paidBillReadThroughMs" | "paidBillHeldSinceMs"> {
  if (paidBillWindow === null) {
    return {
      paidBillReadThroughMs: previous.paidBillReadThroughMs,
      paidBillHeldSinceMs: null,
    };
  }
  const heldSinceMs = paidBillWindow.held
    ? (previous.paidBillHeldSinceMs ?? nowMs)
    : null;
  const expired =
    heldSinceMs !== null && nowMs - heldSinceMs > WAREHOUSE_COST_MAX_HOLD_MS;
  const readThroughMs = expired
    ? paidBillWindow.endMs
    : paidBillWindow.readThroughMs;
  return {
    paidBillReadThroughMs: Math.max(
      previous.paidBillReadThroughMs ?? 0,
      readThroughMs,
    ),
    paidBillHeldSinceMs: expired ? null : heldSinceMs,
  };
}
