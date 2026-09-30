// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Anthropic Admin API puller — the first adapter that produces priced usage
 * records rather than audit rows (ADR-088 Decision 7).
 *
 * It cannot be an `HttpPollingPullerAdapter` config like the compliance
 * pullers are. Those map a flat audit-log entry through JSON paths; this API
 * returns time BUCKETS, each holding a list of group-by results, and the
 * bucket's coordinates (period, granularity, workspace, model) are what the
 * restatement key is built from. A declarative field mapping has nowhere to
 * put that.
 *
 * Two reports, and a source pulls exactly one of them:
 *
 *   usage_report/messages — token counts per bucket, no cost. We price it
 *                           ourselves, so every record is `computed` /
 *                           `estimate`.
 *   cost_report           — Anthropic's own cost figure, per bucket, as a
 *                           decimal string denominated in CENTS. Converted to
 *                           USD at this boundary and recorded as
 *                           `provider_reported` / `estimate` — estimate
 *                           because the report excludes Priority Tier usage,
 *                           so it is the provider's figure but not the full
 *                           invoice.
 *
 * Never both. The same spend arriving down both paths would be counted twice,
 * and the supersede rule that would let them coexist is named and deferred in
 * ADR-088 Decision 6. The config makes the choice, and there is no "both".
 *
 * Restatement falls out of this for free: Anthropic revises a bucket in place,
 * under the same coordinates, so a corrected pull produces the same dimension
 * hash with a later `observedAt` and replaces rather than adds.
 */

import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import {
  DispatchError,
  parseRetryAfterMs,
} from "~/server/event-sourcing/queues/dispatchError";
import { ssrfSafeFetch } from "~/utils/ssrfProtection";
import { PULLED_USAGE_HINT_KEY } from "./pulledUsageRecord";
import type {
  NormalizedPullEvent,
  PullerAdapter,
  PullResult,
  PullRunOptions,
} from "./pullerAdapter";

const logger = createLogger("langwatch:governance:anthropic-admin-puller");

const API_BASE = "https://api.anthropic.com/v1/organizations";
const ANTHROPIC_VERSION = "2023-06-01";
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * A run stops here rather than paginating forever. Anthropic pages a bucket
 * window, so the cap bounds one run's work; the cursor carries the rest into
 * the next one.
 */
const MAX_PAGES_PER_RUN = 20;

/**
 * The cost report is daily-only, so its width is a constant rather than a
 * setting. It is BOTH the request parameter and the restatement-key dimension,
 * and the two must be the same value: a width that varied with config would
 * re-key every unchanged cost bucket the moment an operator edited it, and the
 * same spend would be recorded a second time under the new key.
 */
const COST_REPORT_BUCKET_WIDTH = "1d" as const;

/**
 * The group-by sets, named once because they are load-bearing twice: they are
 * the request parameters AND part of the cursor's query identity below.
 *
 * Usage asks for every dimension its restatement key is built from —
 * `service_tier` and `context_window` included, because the API returns null
 * for any field not in `group_by`, and a dimension that is always "" collapses
 * batch and long-context usage onto standard usage under one key.
 */
const USAGE_GROUP_BY = [
  "model",
  "workspace_id",
  "api_key_id",
  "service_tier",
  "context_window",
] as const;
/** The cost report only supports these two. */
const COST_GROUP_BY = ["workspace_id", "description"] as const;

export const ANTHROPIC_ADMIN_ADAPTER_ID = "anthropic_admin" as const;

export const anthropicAdminPullConfigSchema = z.object({
  adapter: z.literal(ANTHROPIC_ADMIN_ADAPTER_ID),
  /**
   * Which report this source pulls. Deliberately not a set: pulling both
   * would report the same spend twice under different bases, and nothing
   * reconciles them yet.
   */
  report: z.enum(["usage", "cost"]),
  /** Anthropic's bucket granularity. It is part of the restatement key. */
  bucketWidth: z.enum(["1m", "1h", "1d"]).default("1d"),
  /** ISO instant the very first run starts from. Later runs use the cursor. */
  startingAt: z.string().datetime().optional(),
  schedule: z.string().default("0 * * * *"),
});
export type AnthropicAdminPullConfig = z.infer<
  typeof anthropicAdminPullConfigSchema
>;

/**
 * The durable cursor. `startingAt` is the watermark a fresh run resumes from
 * and `page` is Anthropic's own token inside that window, so a run cut off
 * mid-window resumes mid-window instead of re-reading it.
 *
 * `query` is the identity of the request the cursor was minted under.
 * Anthropic returns 400 when a page token is replayed with changed query
 * params, and this adapter holds the cursor still on failure — so without the
 * binding, one config edit mid-window would wedge the source permanently:
 * every retry replays the same dead token.
 *
 * What a mismatch does depends on whether re-reading can SUPERSEDE:
 *
 * COST sources discard the whole cursor, watermark included, and re-read from
 * the configured start. Cost identity (`costEvent`'s dimensions plus the
 * pinned bucket width) is independent of config and unchanged by this fix, so
 * a re-read emits the same `source_event_id`s and restatement replaces the
 * old rows in place. That is what repairs the 100x figures — mature sources
 * resume from their watermark, so the wrong rows behind it would otherwise
 * never be re-read. After the first re-pull the cursor carries the current
 * identity and the rewind never fires again — until the configuration itself
 * changes: the configured `startingAt` is part of the cost identity, so
 * WIDENING it later mints a mismatch and the rewind fires once more, reaching
 * the deeper window. That is the operator's repair lever for sources whose
 * first post-deploy run only covered the default window.
 *
 * USAGE sources drop only the unsafe page token and resume as close to where
 * the token pointed as the cursor can certify. Usage identity is NOT stable
 * across a query change — it embeds the config bucket width, and this fix
 * itself added `serviceTier` and `contextWindow` to it — so anything re-read
 * under the new query is emitted under new keys BESIDE the old rows rather
 * than superseding them: every re-read bucket is double-counted spend.
 * That is why `watermark` exists: a run cut off mid-window (deadline or
 * MAX_PAGES_PER_RUN) records the newest bucket it actually emitted, and a
 * usage mismatch resumes from there — re-reading at most the one bucket the
 * token was sitting inside. Cursors minted before `watermark` existed carry
 * only the window start, so their in-flight window (bounded by
 * MAX_PAGES_PER_RUN) is re-read ONCE under the new keys — a bounded,
 * one-shot duplication, accepted over skipping the rest of the window.
 * History behind the window stays as written (the flat-cache zeros and
 * collapsed tiers are a documented, bounded wrong).
 */
const cursorSchema = z.object({
  startingAt: z.string(),
  page: z.string().nullable().default(null),
  query: z.string().nullable().default(null),
  /**
   * Newest bucket `starting_at` already emitted from the in-flight window,
   * recorded only while a page token is in hand. Null once the window drains
   * (`startingAt` itself becomes the resume point) and on cursors minted
   * before this field existed.
   */
  watermark: z.string().nullable().default(null),
});

/**
 * The configuration a cursor is bound to. Two concerns share it:
 *
 * 1. What Anthropic would reject a replayed page token over: the endpoint and
 *    every query parameter that rides beside `page`.
 * 2. For COST sources only, the repair window. The configured `startingAt`
 *    decides how far back a stale-cursor rewind reaches, so widening it on a
 *    source that has already run must mint a new identity — otherwise the
 *    cursor matches forever, the watermark replays, and the deeper history
 *    stays wrong with no way to reach it short of deleting the cursor by
 *    hand. Usage deliberately excludes it: usage never rewinds (see
 *    `cursorSchema`), so binding it there would only drop a live page token
 *    over an edit that changes nothing.
 */
function queryIdentity(config: AnthropicAdminPullConfig): string {
  return config.report === "usage"
    ? `usage:${config.bucketWidth}:${USAGE_GROUP_BY.join(",")}`
    : `cost:${COST_REPORT_BUCKET_WIDTH}:${COST_GROUP_BY.join(",")}:${config.startingAt ?? ""}`;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * How far behind its own watermark a COST read starts again.
 *
 * Anthropic keeps correcting a day's cost for a while after the day ends, and
 * a read that only ever moved forward held the FIRST figure it ever saw for a
 * day as the last one it would ever hold. That figure disagreed with the
 * provider's own console inside a week, and nothing in the pipeline could ever
 * notice: a day nobody re-reads is a day nobody can correct.
 *
 * Three days, the same margin the sibling OpenAI connection already pays, and
 * it costs the same single request per run — the window is wider, not the
 * number of asks. Re-reading is only safe because a cost restatement REPLACES:
 * the same day and group produce the same restatement key on every run, so a
 * corrected figure lands ON the earlier one rather than beside it. Usage rows
 * carry no such promise, which is why this is applied to cost alone.
 */
const COST_RESTATEMENT_LOOKBACK_DAYS = 3;

/**
 * Where a run ASKS from, given where it had got to.
 *
 * Never before the day the connection was told to begin at — a look-back that
 * reached past it would ask about a period the customer did not connect us
 * for — and never forward of the watermark itself, which would skip days.
 *
 * Kept apart from the position that gets SAVED. Reading from further back is
 * the whole point; recording that we had only got that far is the defect it
 * would otherwise introduce.
 */
function costRequestStart({
  stored,
  config,
}: {
  stored: string;
  config: AnthropicAdminPullConfig;
}): string {
  const storedMs = Date.parse(stored);
  if (Number.isNaN(storedMs)) return stored;

  const configuredStart = config.startingAt ?? defaultStartingAt("cost");
  const floorMs = Date.parse(configuredStart);
  const lookedBackMs = storedMs - COST_RESTATEMENT_LOOKBACK_DAYS * MS_PER_DAY;
  const notBeforeConfigured = Number.isNaN(floorMs)
    ? lookedBackMs
    : Math.max(lookedBackMs, floorMs);
  return new Date(Math.min(notBeforeConfigured, storedMs)).toISOString();
}

function parseCursor({
  cursor,
  config,
}: {
  cursor: string | null;
  config: AnthropicAdminPullConfig;
}): ParsedCursor {
  if (cursor) {
    try {
      const parsed = cursorSchema.parse(JSON.parse(cursor));
      if (parsed.query === queryIdentity(config)) {
        return {
          startingAt: parsed.startingAt,
          // Mid-window, with a page token in hand, the ask must stay exactly
          // what that token was minted against or the provider refuses it.
          // Only a drained cursor gets the look-back.
          requestStart:
            config.report === "cost" && parsed.page === null
              ? costRequestStart({ stored: parsed.startingAt, config })
              : parsed.startingAt,
          page: parsed.page,
          watermark: parsed.watermark,
        };
      }
      // Also covers cursors minted before query-binding existed (`query`
      // null): this change itself widened the group_by set and fixed the
      // cents→USD conversion, so everything those cursors certify was
      // written by the old code.
      return staleCursorRestart({ parsed, config });
    } catch {
      logger.warn(
        { cursor },
        "unreadable anthropic admin cursor; restarting from the configured watermark",
      );
    }
  }
  const fresh = config.startingAt ?? defaultStartingAt(config.report);
  // No look-back on a first run: there is nothing behind the configured start
  // to look back at, and the floor would return this same instant anyway.
  return {
    startingAt: fresh,
    requestStart: fresh,
    page: null,
    watermark: null,
  };
}

/**
 * A parsed cursor, and the two starts it implies.
 *
 * `startingAt` is the position ON RECORD — where the source has got to, and
 * the value a cut-off run writes back. `requestStart` is the instant this run
 * ASKS from, which for a drained cost cursor sits a few days behind it. They
 * were one field until a cost read started looking back, and collapsing them
 * again is what walks the saved position backwards on every run.
 */
interface ParsedCursor
  extends Pick<
    z.infer<typeof cursorSchema>,
    "startingAt" | "page" | "watermark"
  > {
  requestStart: string;
}

/**
 * Where a run resumes after its cursor failed the query-identity check.
 * The split between reports is the cursorSchema doc's supersede-vs-duplicate
 * distinction: cost re-reads restate, usage re-reads double-count.
 */
function staleCursorRestart({
  parsed,
  config,
}: {
  parsed: z.infer<typeof cursorSchema>;
  config: AnthropicAdminPullConfig;
}): ParsedCursor {
  if (config.report === "usage") {
    // No rewind: usage identity is not stable across a query change, so
    // re-reading history would duplicate spend rather than restate it.
    // The page token still has to go — it would 400 against the new
    // query params. Resume from the in-window watermark when the cursor
    // recorded one: that re-reads at most the bucket the token sat inside,
    // instead of every page of the window already emitted under the old
    // keys. Cursors without one (minted pre-`watermark`, or drained)
    // resume from the window start. A date that doesn't parse certifies no
    // history at all, so the configured start duplicates nothing — and
    // passing it through would 400 on every retry forever.
    logger.warn(
      { adapter: ANTHROPIC_ADMIN_ADAPTER_ID, report: config.report },
      "anthropic admin usage cursor was minted under a different query; dropping the page token and resuming from the newest bucket it certifies",
    );
    const resumeFrom = [parsed.watermark, parsed.startingAt].find(
      (candidate) => candidate !== null && !Number.isNaN(Date.parse(candidate)),
    );
    const usageRestart =
      resumeFrom ?? config.startingAt ?? defaultStartingAt(config.report);
    return {
      startingAt: usageRestart,
      requestStart: usageRestart,
      page: null,
      watermark: null,
    };
  }
  logger.warn(
    { adapter: ANTHROPIC_ADMIN_ADAPTER_ID, report: config.report },
    "anthropic admin cost cursor was minted under a different query or repair window; discarding it and re-reading from the start",
  );
  const configuredStart = config.startingAt ?? defaultStartingAt(config.report);
  // The EARLIER of the stored watermark and the configured start: the
  // rewind must never move the watermark FORWARD. A source that fell
  // behind (paused, erroring) holds a watermark older than the default
  // window, and snapping it to `configuredStart` would silently skip
  // everything in between.
  const watermarkMs = Date.parse(parsed.startingAt);
  const rewoundStart =
    Number.isNaN(watermarkMs) || Date.parse(configuredStart) <= watermarkMs
      ? configuredStart
      : parsed.startingAt;
  // A rewind has already reached back as far as it means to, so no look-back
  // is stacked on top of it.
  return {
    startingAt: rewoundStart,
    requestStart: rewoundStart,
    page: null,
    watermark: null,
  };
}

function encodeCursor({
  startingAt,
  page,
  query,
  watermark,
}: Omit<z.infer<typeof cursorSchema>, "query"> & {
  // Refined non-null: every cursor minted after query-binding carries the
  // query identity; only cursors READ from storage can lack it.
  query: string;
}): string {
  return JSON.stringify({ startingAt, page, query, watermark });
}

/**
 * A first run with no configured watermark.
 *
 * Cost reports use daily buckets with a ~1-day processing lag, so the most
 * recent *completed* bucket is ≥2 days ago.  Going back 3 days guarantees at
 * least one full bucket and avoids the 400 Anthropic returns when there is no
 * valid ending date after `starting_at`.
 *
 * Usage reports can have sub-day granularity, so 24 h is fine.
 */
function defaultStartingAt(report: "usage" | "cost"): string {
  const daysBack = report === "cost" ? 3 : 1;
  const d = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
  // Snap to midnight UTC so the timestamp aligns with daily bucket boundaries.
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/** Cap on how much of an error response body we log. */
const MAX_ERROR_BODY_BYTES = 4_096;

/**
 * Best-effort read of a non-OK response body, bounded so an unexpectedly
 * large payload doesn't blow up logs or memory.
 */
async function safeResponseText(response: {
  text(): Promise<string>;
}): Promise<string> {
  try {
    const raw = await response.text();
    if (raw.length <= MAX_ERROR_BODY_BYTES) return raw;
    return `${raw.slice(0, MAX_ERROR_BODY_BYTES)}… [truncated]`;
  } catch {
    return "";
  }
}

async function fetchPageError(
  response: { status: number; text(): Promise<string> },
  report: string,
): Promise<Error> {
  const detail = await safeResponseText(response);
  const suffix = detail ? `: ${detail}` : "";
  return new Error(
    `HTTP ${response.status} (anthropic ${report}_report)${suffix}`,
  );
}

/** One group-by row inside a usage bucket. Unknown fields are tolerated. */
const usageResultSchema = z
  .object({
    uncached_input_tokens: z.number().nonnegative().default(0),
    /**
     * The API nests cache creation, split by cache TTL. The flat
     * `cache_creation_input_tokens` fallback below is tolerance for a shape
     * the docs no longer show — the nested object wins whenever present.
     */
    cache_creation: z
      .object({
        ephemeral_1h_input_tokens: z.number().nonnegative().default(0),
        ephemeral_5m_input_tokens: z.number().nonnegative().default(0),
      })
      .passthrough()
      .nullish(),
    cache_creation_input_tokens: z.number().nonnegative().default(0),
    cache_read_input_tokens: z.number().nonnegative().default(0),
    output_tokens: z.number().nonnegative().default(0),
    model: z.string().nullable().default(null),
    workspace_id: z.string().nullable().default(null),
    api_key_id: z.string().nullable().default(null),
    service_tier: z.string().nullable().default(null),
    context_window: z.string().nullable().default(null),
  })
  .passthrough();

/**
 * Every cache-write token in a usage row, whichever shape carried it. The old
 * flat-only schema read the nested shape as 0 and the `.default(0)` masked it.
 */
function cacheWriteTokens(result: z.infer<typeof usageResultSchema>): number {
  if (result.cache_creation) {
    return (
      result.cache_creation.ephemeral_1h_input_tokens +
      result.cache_creation.ephemeral_5m_input_tokens
    );
  }
  return result.cache_creation_input_tokens;
}

/** One group-by row inside a cost bucket. `amount` is a decimal string. */
const costResultSchema = z
  .object({
    amount: z.union([z.string(), z.number()]).transform(String),
    currency: z.string().default("USD"),
    workspace_id: z.string().nullable().default(null),
    description: z.string().nullable().default(null),
    cost_type: z.string().nullable().default(null),
    model: z.string().nullable().default(null),
  })
  // Coordinates the cost key does NOT carry (context_window, service_tier,
  // token_type, inference_geo, and whatever the provider adds next) ride
  // through here under the provider's own names into `raw_payload`. They are
  // deliberately NOT declared: a declaration narrows the accepted contract,
  // so one unexpected value type would throw out of `bucketEvents` and wedge
  // the whole run, and a `.default(null)` would write keys into `raw_payload`
  // that the provider never sent. `assertRowsAreDistinguishable` names them
  // from the stored payload when two rows collide, which is all they are for.
  // They never widen the key, which is the restatement identity.
  .passthrough();

/**
 * Anthropic's `amount` is denominated in the currency's LOWEST unit — cents
 * for USD — as a decimal string: the docs' worked example is `"123.45"` in
 * USD meaning $1.23. The shift to dollars is index arithmetic on the string,
 * so no digit ever passes through a float on the way to the ledger.
 *
 * An amount that is not a decimal returns null rather than guessing — and
 * rather than throwing: a throw here escapes `runOnce`'s fetch-only error
 * handling, discards every event already read, and holds the cursor on a row
 * that would be malformed again on every retry, wedging the source
 * permanently. Same blast-radius call as the non-USD skip in `costEvent`.
 */
function centsToUsd(amount: string): string | null {
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(
    amount.trim(),
  );
  if (!match) {
    return null;
  }
  const [, sign = "", wholeRaw = "0", fraction = "", exponent] = match;
  if (exponent !== undefined) {
    // Exponent form ("1e-7") — from the schema's number branch stringifying a
    // float, or sent as a string outright. Shift the exponent instead of the
    // digits — the money parser downstream reads exponents exactly.
    const exponentValue = Number(exponent);
    if (!Number.isSafeInteger(exponentValue)) {
      // An exponent too large for exact arithmetic would collapse to
      // Infinity and emit "eInfinity". No real money amount lives out
      // there — treat it as malformed.
      return null;
    }
    return `${sign}${wholeRaw}${fraction ? `.${fraction}` : ""}e${
      exponentValue - 2
    }`;
  }
  // Three digits guarantee a whole part survives the two-digit shift.
  const whole = wholeRaw.padStart(3, "0");
  return `${sign}${whole.slice(0, -2)}.${whole.slice(-2)}${fraction}`;
}

const bucketSchema = z.object({
  starting_at: z.string(),
  ending_at: z.string().optional(),
  results: z.array(z.unknown()).default([]),
});

const pageSchema = z.object({
  data: z.array(bucketSchema).default([]),
  has_more: z.boolean().default(false),
  next_page: z.string().nullable().default(null),
});

/**
 * The later of two instants, ignoring one that cannot be parsed.
 *
 * `newestBucketStart` orders a page against itself. Anthropic promises no
 * order ACROSS pages either, so the run needs the same maximum one level up:
 * without it the last page read wins, and a final page whose newest bucket is
 * older than an earlier page's lowers the resume point below buckets this run
 * has already emitted.
 */
function laterInstant(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  const aMs = Date.parse(a);
  const bMs = Date.parse(b);
  if (Number.isNaN(bMs)) return a;
  if (Number.isNaN(aMs)) return b;
  return bMs > aMs ? b : a;
}

/**
 * The newest bucket start in one page.
 *
 * NOT the last element of the array. Anthropic does not promise an order
 * within a page, and reading the last bucket as the newest is only correct
 * while the page happens to ascend. On an out-of-order page it hands back an
 * earlier instant than one already emitted, so the watermark it mints re-reads
 * the window. Under an unchanged query that re-read restates rather than
 * duplicating — the ids carry the bucket and its dimensions — and the cost is
 * a window that stops advancing; it becomes duplicated spend on the usage
 * report only once a query change moves the keys (see `cursorSchema`). The
 * maximum is the only value every bucket on the page is at or behind, which is
 * exactly what a watermark has to mean.
 *
 * Instants that do not parse are ignored rather than compared as strings: a
 * value we cannot order cannot be certified as a resume point. A page where
 * none parse yields null, and null resumes from the window start — a re-read,
 * never a skip.
 */
function newestBucketStart(
  buckets: z.infer<typeof bucketSchema>[],
): string | null {
  let newest: string | null = null;
  let newestMs = Number.NEGATIVE_INFINITY;
  for (const bucket of buckets) {
    const ms = Date.parse(bucket.starting_at);
    if (Number.isNaN(ms) || ms <= newestMs) continue;
    newest = bucket.starting_at;
    newestMs = ms;
  }
  return newest;
}

/**
 * Dimension values are the identity of a bucket, so an absent one has to be a
 * STABLE token rather than an omitted key: dropping "workspace_id" from one
 * pull and including it as null on the next would mint two keys for one
 * bucket and double-count it.
 */
function dimension(value: string | null): string {
  return value ?? "";
}

/**
 * The dimension values as one `:`-delimited string, each value encoded first.
 *
 * `description` is free text Anthropic writes, and it can contain the
 * delimiter. Joined raw, `{description: "Claude: usage", costType: ""}` and
 * `{description: "Claude", costType: " usage"}` produce the identical string —
 * two distinct provider rows collapsing onto one `source_event_id`, which is
 * the OCSF sink's dedup key and the record's `itemKey`. Encoding each value
 * first makes the separator unambiguous.
 *
 * The restatement key is not affected: it hashes the dimensions map through
 * `JSON.stringify`, which escapes rather than concatenates. This is about the
 * human-readable identity that rides beside it.
 */
function dimensionPath(dimensions: Record<string, string>): string {
  return Object.values(dimensions).map(encodeURIComponent).join(":");
}

/** The hint this adapter attaches under `PULLED_USAGE_HINT_KEY`, read back. */
interface EmittedUsageHint {
  dimensions?: Record<string, string>;
  tokensCacheRead?: number;
  tokensCacheWrite?: number;
}

/**
 * The hint off an event this adapter emitted. `extra` is an untyped bag on the
 * shared event shape, so reading our own hint back needs the cast; every event
 * built below carries one.
 */
function emittedHint(event: NormalizedPullEvent): EmittedUsageHint | undefined {
  return event.extra?.[PULLED_USAGE_HINT_KEY] as EmittedUsageHint | undefined;
}

/**
 * Everything a row contributes to the ledger, with none of its identity.
 *
 * Two rows sharing a key AND this signature are interchangeable: whichever one
 * survives the upsert, the money and the quantities recorded are the same, so
 * a provider that repeats a row costs nothing. Two rows sharing a key and
 * differing here are two different figures competing for one cell, and only
 * the last one written survives.
 */
function amountSignature(event: NormalizedPullEvent): string {
  const hint = emittedHint(event);
  return JSON.stringify([
    event.cost_usd,
    event.tokens_input,
    event.tokens_output,
    hint?.tokensCacheRead ?? 0,
    hint?.tokensCacheWrite ?? 0,
  ]);
}

/**
 * Refuse a page whose own rows cannot be told apart.
 *
 * A row is stored under the dimensions `usageEvent`/`costEvent` build, and on
 * the cost report that set is narrower than what the endpoint hands back:
 * `costResultSchema` parses a `model` that no dimension carries, and the schema
 * is `passthrough`, so any further coordinate Anthropic breaks a row out by
 * without being asked — a tier, a token type, a region — is outside the key
 * too. Two such rows collapse onto one `source_event_id`, which is the sink's
 * dedup key, and the second silently overwrites the first: spend that was
 * fetched, parsed, and then dropped with nothing anywhere reporting a loss.
 *
 * WIDENING the key is not the fix, and deliberately not done here. The
 * dimensions ARE the restatement identity: adding one re-keys every cell
 * already stored, so every later correction would land beside the figure it
 * corrects instead of replacing it. That migration is owned separately. Until
 * it lands, the page fails loudly — the run records an error and an operator
 * sees a figure that is missing rather than one that is quietly wrong.
 *
 * A plain `Error`, not a `HandledError`: there is no named cause a caller can
 * act on, only a provider contract we did not anticipate.
 *
 * The message carries the count, the dimension NAMES, and the names of the
 * fields the colliding rows actually disagree on. Never the values — workspace
 * ids and free-text descriptions are customer billing coordinates, and this
 * string travels into logs and the source's error state. Naming the fields is
 * what turns "something outside the key" into a lead: the operator reads which
 * coordinate the provider split the row by without seeing whose spend it was.
 */
function assertRowsAreDistinguishable({
  events,
  report,
}: {
  events: NormalizedPullEvent[];
  report: AnthropicAdminPullConfig["report"];
}): void {
  const colliding = collidingRowsByKey(events);
  if (colliding.size === 0) return;
  const dimensionNames = Object.keys(emittedHint(events[0]!)?.dimensions ?? {});
  // Per key, never across keys: rows under two different keys differ in the
  // dimensions BY DESIGN, and naming those would report the key as its own
  // explanation.
  const differingNames = new Set<string>();
  for (const rows of colliding.values()) {
    for (const name of differingFieldNames(rows)) differingNames.add(name);
  }
  const differingClause =
    differingNames.size === 0
      ? ""
      : `; the colliding rows differ in ${[...differingNames].sort().join(", ")}`;
  throw new Error(
    `anthropic ${report}_report returned one page holding ${colliding.size} restatement key(s) shared by rows reporting different amounts; the key is built from ${dimensionNames.join(", ")}, so the provider is distinguishing these rows by something outside it and recording the page would drop spend${differingClause}`,
  );
}

/**
 * The rows behind each key that two or more of them report different amounts
 * under. Keys whose rows agree are not here: a provider repeating a row costs
 * nothing, whichever copy survives the upsert.
 */
function collidingRowsByKey(
  events: NormalizedPullEvent[],
): Map<string, NormalizedPullEvent[]> {
  const rowsByKey = new Map<string, NormalizedPullEvent[]>();
  const amountByKey = new Map<string, string>();
  const collidingKeys = new Set<string>();
  for (const event of events) {
    const key = event.source_event_id;
    const group = rowsByKey.get(key);
    if (group) group.push(event);
    else rowsByKey.set(key, [event]);
    const amount = amountSignature(event);
    const seen = amountByKey.get(key);
    if (seen === undefined) amountByKey.set(key, amount);
    else if (seen !== amount) collidingKeys.add(key);
  }
  return new Map(
    [...collidingKeys].map((key) => [key, rowsByKey.get(key) ?? []]),
  );
}

/**
 * The provider field NAMES on which rows sharing one key disagree.
 *
 * Read off `raw_payload`, which is the parsed provider row — the only place
 * the coordinates outside the key survive, since the dimensions are exactly
 * what the key already carries. `amount` will normally be among them: that is
 * the premise of the refusal rather than noise, and listing it costs a word
 * where suppressing it would need a hardcoded list of money fields to drift.
 *
 * A payload that does not parse into an object is skipped rather than guessed
 * at — an unnameable field is better than a wrong name, and the refusal
 * already stands on the key alone.
 */
function differingFieldNames(events: NormalizedPullEvent[]): string[] {
  const rows = events
    .map(parsedRawPayload)
    .filter((row): row is Record<string, unknown> => row !== null);
  const first = rows[0];
  if (first === undefined) return [];
  const names = new Set<string>();
  for (const row of rows.slice(1)) {
    for (const name of new Set([...Object.keys(first), ...Object.keys(row)])) {
      // Compared by serialized content rather than by identity, so a nested
      // object (the usage report's `cache_creation`) counts as equal when it
      // holds the same keys in the same order. Key order is not normalized:
      // a reordered-but-equal object would be named as differing, which only
      // adds a word to a message the amount mismatch already justified.
      // `undefined` and an explicit null are the same absence here.
      if (
        JSON.stringify(first[name] ?? null) !==
        JSON.stringify(row[name] ?? null)
      ) {
        names.add(name);
      }
    }
  }
  return [...names];
}

/** The parsed provider row an event carries, or null if it is not an object. */
function parsedRawPayload(
  event: NormalizedPullEvent,
): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(event.raw_payload);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * The request URL for one page of one report. Everything here except `page`
 * is what `queryIdentity` binds the cursor to — change one, change both.
 */
function reportUrl({
  config,
  startingAt,
  page,
}: {
  config: AnthropicAdminPullConfig;
  startingAt: string;
  page: string | null;
}): URL {
  const url = new URL(
    config.report === "usage"
      ? `${API_BASE}/usage_report/messages`
      : `${API_BASE}/cost_report`,
  );
  url.searchParams.set("starting_at", startingAt);
  if (config.report === "usage") {
    url.searchParams.set("bucket_width", config.bucketWidth);
    for (const dim of USAGE_GROUP_BY) {
      url.searchParams.append("group_by[]", dim);
    }
  } else {
    // The cost report is daily-only, so the width is pinned here rather than
    // taken from config. It has to match `COST_REPORT_BUCKET_WIDTH`, which
    // rides the restatement key: a width that could vary with config would
    // re-key unchanged cost buckets the moment an operator edited it, and
    // the same spend would be recorded twice.
    url.searchParams.set("bucket_width", COST_REPORT_BUCKET_WIDTH);
    for (const dim of COST_GROUP_BY) {
      url.searchParams.append("group_by[]", dim);
    }
  }
  if (page) url.searchParams.set("page", page);
  return url;
}

/**
 * Whether this run has spent the time it was given.
 *
 * A run with no deadline never has: `undefined` is "run until the window
 * drains", not "stop now".
 */
function hasSpentDeadline(deadlineMs: number | undefined): boolean {
  return deadlineMs !== undefined && Date.now() > deadlineMs;
}

/**
 * The window start to save when a run stops before the window has drained.
 *
 * With a page token in hand, save the window start actually asked with, so
 * that token is resumed against the same `starting_at` that minted it. With NO
 * token there is nothing to resume and nothing requires the rewound value —
 * and saving it would walk the cursor backwards, because `parseCursor` applies
 * the look-back a second time to any cursor whose page is null. Save the
 * position on record instead, which is the floor this cursor may never drop
 * below.
 */
function unfinishedWindowStart({
  page,
  requestStart,
  positionOnRecord,
}: {
  page: string | null;
  requestStart: string;
  positionOnRecord: string;
}): string {
  return page === null ? positionOnRecord : requestStart;
}

export class AnthropicAdminPuller
  implements PullerAdapter<AnthropicAdminPullConfig>
{
  readonly id: string = ANTHROPIC_ADMIN_ADAPTER_ID;

  validateConfig(config: unknown): AnthropicAdminPullConfig {
    return anthropicAdminPullConfigSchema.parse(config);
  }

  async runOnce(
    options: PullRunOptions,
    config: AnthropicAdminPullConfig,
  ): Promise<PullResult> {
    const events: NormalizedPullEvent[] = [];
    // The window start does not move within a run; only the page token and
    // the in-window watermark do. Separate variables rather than one
    // reassigned object, so a page advance mid-run can never quietly carry a
    // different `startingAt` with it. The watermark tracks the newest bucket
    // actually emitted, so a cut-off run records how far it really got —
    // that record is what lets a later identity mismatch resume near the
    // token instead of re-reading the window (see `cursorSchema`).
    const cursor = parseCursor({ cursor: options.cursor, config });
    /**
     * The instant this run ASKS from, which on a cost source is a few days
     * behind the position on record so a late restatement is picked up.
     *
     * The look-back was being computed and then thrown away: every request
     * went out at `cursor.startingAt`, so the repair window existed on paper
     * and never once reached the provider.
     */
    const requestStart = cursor.requestStart;
    /**
     * The position ON RECORD — how far the source has actually got. The floor
     * the saved cursor may never drop below, and NOT what this run asks from.
     */
    const positionOnRecord = cursor.startingAt;
    const query = queryIdentity(config);
    let page = cursor.page;
    let watermark = cursor.watermark;
    /**
     * The newest bucket emitted across EVERY page this run read, which is what
     * a drained window resumes from.
     *
     * Separate from `watermark` on purpose. `watermark` is the resume point a
     * run that was CUT OFF leaves behind, and pages beyond the cut are unread,
     * so raising it to a cross-page maximum could carry the next run past
     * buckets nobody has fetched. At the drain there is no unread page left in
     * the window, so the maximum is simply the newest thing emitted — and
     * taking it is what stops a trailing out-of-order page from lowering the
     * window start. Left lowered, a provider whose page order is stable
     * re-mints the same low start every run, the window never advances, and it
     * grows until it needs more than MAX_PAGES_PER_RUN to drain.
     */
    let newestEmitted = cursor.watermark;

    for (let pageCount = 0; pageCount < MAX_PAGES_PER_RUN; pageCount += 1) {
      if (hasSpentDeadline(options.deadlineMs)) {
        // Everything read so far is kept and the cursor says where to resume,
        // so a deadline costs latency rather than a window. It is still a
        // window left half-read, and saying nothing reads as complete.
        return {
          events,
          cursor: encodeCursor({
            startingAt: unfinishedWindowStart({
              page,
              requestStart,
              positionOnRecord,
            }),
            page,
            query,
            watermark,
          }),
          errorCount: 0,
          completeness: "truncated",
        };
      }

      const read = await this.readPage({
        config,
        startingAt: requestStart,
        page,
        options,
      });
      if (!read.ok) {
        // The unadvanced cursor is what makes the window get retried instead
        // of skipped. Never return a partial window as if it were complete.
        return { events, cursor: options.cursor, errorCount: 1 };
      }
      events.push(...read.events);
      watermark = read.watermark ?? watermark;
      newestEmitted = laterInstant(newestEmitted, read.watermark);

      if (read.nextPage === null) {
        // Drained. The next run starts from the newest bucket this run
        // emitted across all of its pages, so the window start only ever
        // moves forward — and the in-window watermark is retired:
        // `startingAt` itself is now the resume point.
        return {
          events,
          cursor: encodeCursor({
            // Floored at the position on record. Without this floor a run
            // that looked back and found nothing newer saves the day it
            // looked back TO, and the source walks three days backwards on
            // every run until it reaches the day it was first connected —
            // re-reading and re-emitting the whole history on the way. An
            // empty window, a credit, and a workspace somebody deleted all
            // produce exactly that page. This is the floor the sibling
            // connection already applies at its own drain.
            startingAt:
              laterInstant(newestEmitted, positionOnRecord) ?? positionOnRecord,
            page: null,
            query,
            watermark: null,
          }),
          errorCount: 0,
        };
      }
      page = read.nextPage;
    }

    logger.warn(
      { adapter: this.id, report: config.report },
      "anthropic admin hit MAX_PAGES_PER_RUN; the next run resumes from the cursor",
    );
    return {
      events,
      // As above: the start this run asked with, not the position on record,
      // so the unfinished window resumes where its page token points.
      cursor: encodeCursor({
        startingAt: requestStart,
        page,
        query,
        watermark,
      }),
      errorCount: 0,
      // A page token still in hand means the window was not drained.
      completeness: "truncated",
    };
  }

  /**
   * One page: fetched, parsed, and mapped to events.
   *
   * A transport failure is a returned `ok: false` rather than a throw, because
   * the caller has to answer it by holding the cursor still. A malformed
   * response is NOT caught here and still throws: a shape we do not recognise
   * is not a window to retry, it is a contract that moved.
   */
  private async readPage({
    config,
    startingAt,
    page,
    options,
  }: {
    config: AnthropicAdminPullConfig;
    startingAt: string;
    page: string | null;
    options: PullRunOptions;
  }): Promise<
    | {
        ok: true;
        events: NormalizedPullEvent[];
        nextPage: string | null;
        watermark: string | null;
      }
    | { ok: false }
  > {
    let body: unknown;
    try {
      body = await this.fetchPage({ config, startingAt, page, options });
    } catch (error) {
      // Keep Retry-After on the thrown error: the durable outbox already
      // schedules its next attempt no earlier than this provider minimum.
      // Returning only errorCount would discard both the wait and the cause.
      if (error instanceof DispatchError) throw error;
      logger.error(
        {
          adapter: this.id,
          report: config.report,
          error: error instanceof Error ? error.message : String(error),
        },
        "anthropic admin fetch failed; leaving the cursor where it was",
      );
      return { ok: false };
    }

    const parsed = pageSchema.parse(body);
    // `has_more` with no token to follow it is a contract violation, and the
    // one shape that must NOT be treated as drained. Reading it as drained
    // would advance the watermark past pages that were never fetched, and the
    // next run would start after them — silent loss of a window's spend, with
    // nothing anywhere reporting a failure. Same class as a malformed body,
    // so it gets the same answer: refuse rather than swallow.
    if (parsed.has_more && parsed.next_page === null) {
      throw new Error(
        `anthropic ${config.report}_report reported has_more with no next_page; advancing the watermark here would drop the rest of the window`,
      );
    }
    const events = parsed.data.flatMap((bucket) =>
      this.bucketEvents({ bucket, config }),
    );
    // Same class of refusal as the `has_more` check above: not a window to
    // retry, a shape whose rows we cannot store without losing one of them.
    assertRowsAreDistinguishable({ events, report: config.report });
    return {
      ok: true,
      events,
      nextPage: parsed.next_page,
      watermark: newestBucketStart(parsed.data),
    };
  }

  private async fetchPage({
    config,
    startingAt,
    page,
    options,
  }: {
    config: AnthropicAdminPullConfig;
    startingAt: string;
    page: string | null;
    options: PullRunOptions;
  }): Promise<unknown> {
    const apiKey = options.credentials?.token;
    if (!apiKey) {
      throw new Error(
        "anthropic admin puller requires an admin API key in credentials.token",
      );
    }

    const url = reportUrl({ config, startingAt, page });
    const signal = options.signal
      ? AbortSignal.any([
          options.signal,
          AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        ])
      : AbortSignal.timeout(REQUEST_TIMEOUT_MS);

    const response = await ssrfSafeFetch(url.toString(), {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        Accept: "application/json",
      },
      signal,
      // The header above is the customer's admin API key. The fetch helper
      // follows up to ten redirects by default and re-sends headers to each
      // host, so a redirect would hand the key to wherever it points.
      followRedirects: false,
    });
    if (response.status === 429) {
      // Draining the body keeps undici's connection poolable, but it is only
      // housekeeping and must never become the error that leaves this branch:
      // an unguarded reject would propagate INSTEAD of the DispatchError
      // below, and a plain Error fails the `instanceof DispatchError` guard in
      // the caller, so the run degrades to a generic failure and the outbox
      // falls back to its default backoff — throwing away the one thing this
      // branch exists to carry.
      await response.body?.cancel().catch(() => void 0);
      throw new DispatchError({
        message: "Anthropic rate limit exceeded (HTTP 429).",
        retryable: true,
        retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after")),
      });
    }
    if (response.status === 401 || response.status === 403) {
      // A refused key answers the same way on every retry, so it is not an
      // outage to wait out: `retryable: false` stops the ladder, and the
      // customer sentence names the one thing an admin can act on. The body
      // is drained and never read — a refusal from this endpoint can echo
      // request material, and nothing here should quote it.
      await response.body?.cancel().catch(() => void 0);
      throw new DispatchError({
        message: `HTTP ${response.status} (anthropic ${config.report}_report): key refused`,
        retryable: false,
        customerMessage:
          "Anthropic refused this key. Check the admin key and its permissions.",
      });
    }
    if (!response.ok) {
      throw await fetchPageError(response, config.report);
    }
    return await response.json();
  }

  /**
   * One bucket's group-by rows, each as its own priced usage event.
   *
   * `flatMap` over a nullable result rather than `map`: a cost row in a
   * currency the ledger cannot hold is dropped (see `costEvent`) instead of
   * unwinding the run, so the rest of the bucket still lands.
   */
  private bucketEvents({
    bucket,
    config,
  }: {
    bucket: z.infer<typeof bucketSchema>;
    config: AnthropicAdminPullConfig;
  }): NormalizedPullEvent[] {
    return bucket.results.flatMap((result) => {
      const event =
        config.report === "usage"
          ? this.usageEvent({
              result: usageResultSchema.parse(result),
              startingAt: bucket.starting_at,
              config,
            })
          : this.costEvent({
              result: costResultSchema.parse(result),
              startingAt: bucket.starting_at,
            });
      return event ? [event] : [];
    });
  }

  private usageEvent({
    result,
    startingAt,
    config,
  }: {
    result: z.infer<typeof usageResultSchema>;
    startingAt: string;
    config: AnthropicAdminPullConfig;
  }): NormalizedPullEvent {
    const dimensions = {
      report: "usage",
      bucketWidth: config.bucketWidth,
      model: dimension(result.model),
      workspaceId: dimension(result.workspace_id),
      apiKeyId: dimension(result.api_key_id),
      serviceTier: dimension(result.service_tier),
      contextWindow: dimension(result.context_window),
    };
    return {
      source_event_id: `usage:${startingAt}:${dimensionPath(dimensions)}`,
      event_timestamp: startingAt,
      // Empty on purpose, not an oversight. The usage report groups by model,
      // workspace, key, tier and context window — there is no person dimension
      // to ask for, so no row here names one. Person discovery skips a blank
      // actor, which is the right answer: inventing one would attribute the
      // whole workspace's tokens to a made-up name. Attribution for Anthropic
      // has to come from the key, elsewhere.
      actor: "",
      action: "usage_report",
      target: dimension(result.model),
      // Anthropic reports no cost on this report; we price the quantities.
      cost_usd: "0",
      tokens_input: result.uncached_input_tokens,
      tokens_output: result.output_tokens,
      raw_payload: JSON.stringify(result),
      extra: {
        [PULLED_USAGE_HINT_KEY]: {
          costBasis: "computed",
          dimensions,
          model: dimension(result.model),
          tokensCacheRead: result.cache_read_input_tokens,
          tokensCacheWrite: cacheWriteTokens(result),
        },
      },
    };
  }

  private costEvent({
    result,
    startingAt,
  }: {
    result: z.infer<typeof costResultSchema>;
    startingAt: string;
  }): NormalizedPullEvent | null {
    const dimensions = {
      report: "cost",
      // Pinned, NOT `config.bucketWidth`. This value rides the restatement
      // key, and the cost report is daily-only, so taking it from config would
      // let an operator's edit re-key every unchanged cost bucket and record
      // the same spend a second time.
      bucketWidth: COST_REPORT_BUCKET_WIDTH,
      workspaceId: dimension(result.workspace_id),
      description: dimension(result.description),
      costType: dimension(result.cost_type),
    };
    if (result.currency !== "USD") {
      // The ledger is nano-USD. Converting here would need a rate and a date,
      // and inventing either is how a wrong number becomes a confident one.
      //
      // Dropping the row rather than throwing is the blast-radius call: a
      // throw here unwinds the whole run, discarding every event already read
      // from earlier pages and returning no `PullResult` at all, so the cursor
      // this adapter is otherwise careful about is never reported. And the row
      // would be non-USD on every retry, so the run could never succeed —
      // one unsupported currency would wedge the source permanently.
      logger.error(
        { adapter: this.id, currency: result.currency, startingAt },
        "anthropic cost report row is not USD; skipping the row",
      );
      return null;
    }
    const amountUsd = centsToUsd(result.amount);
    if (amountUsd === null) {
      // Same reasoning as the non-USD skip above: one permanently malformed
      // row must cost one row, not the whole source. No raw amount in the
      // log — dimensions identify the row without echoing unparseable input.
      logger.error(
        { adapter: this.id, startingAt, dimensions },
        "anthropic cost report amount is not a decimal; skipping the row",
      );
      return null;
    }
    return {
      source_event_id: `cost:${startingAt}:${dimensionPath(dimensions)}`,
      event_timestamp: startingAt,
      // Empty on purpose, not an oversight — and unlike the OpenAI sibling,
      // which does name a person and fills this in. `COST_GROUP_BY` above is
      // the endpoint's whole set: workspace and description. The report carries
      // no user dimension at all, so there is nobody on the row to name and
      // person discovery correctly discovers nobody from Anthropic spend.
      actor: "",
      action: "cost_report",
      target: dimension(result.model),
      // Decimal string — no Number() coercion. The exact value rides through
      // to the pricing service via the hint below.
      cost_usd: amountUsd,
      tokens_input: 0,
      tokens_output: 0,
      raw_payload: JSON.stringify(result),
      extra: {
        [PULLED_USAGE_HINT_KEY]: {
          costBasis: "provider_reported",
          // Anthropic's own figure, but NOT the invoice: the cost report
          // excludes Priority Tier usage, so "exact" would overclaim.
          costStatus: "estimate",
          costUsd: amountUsd,
          dimensions,
          model: dimension(result.model),
        },
      },
    };
  }
}
