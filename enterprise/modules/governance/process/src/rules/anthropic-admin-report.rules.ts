// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The Anthropic Admin API's usage and cost reports, read as data: the request
 * each page is, the durable cursor, the usage row as a priced event, and the
 * refusal a page whose rows collide earns. The puller runs it; nothing here
 * does I/O.
 */

import {
  PULLED_USAGE_HINT_KEY,
  type AnthropicAdminPullConfig,
  type NormalizedPullEvent,
} from "@langwatch/enterprise-governance-contract";
import { nowInstant, Temporal, toEpochMs } from "@langwatch/time";
import { z } from "zod";

import * as AdminUsageReportAdapter from "./admin-usage-report.rules.ts";

const API_BASE = "https://api.anthropic.com/v1/organizations";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * How far a cost cursor rewinds on a restatement: Anthropic revises a day's cost
 * for up to three days, so a resumed run re-reads that window rather than trusting
 * the stored watermark.
 */
const COST_RESTATEMENT_LOOKBACK_DAYS = 3;

/** The hint this adapter attaches under `PULLED_USAGE_HINT_KEY`, read back. */
interface EmittedUsageHint {
  dimensions?: Record<string, string>;
  tokensCacheRead?: number;
  tokensCacheWrite?: number;
}

/**
 * The cost report is daily-only, so its width is a constant rather than a
 * setting. It is BOTH the request parameter and the restatement-key dimension,
 * and the two must be the same value: a width that varied with config would
 * re-key every unchanged cost bucket the moment an operator edited it, and the
 * same spend would be recorded a second time under the new key.
 */
export const COST_REPORT_BUCKET_WIDTH = "1d" as const;

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
export const cursorSchema = z.object({
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

/** One group-by row inside a usage bucket. Unknown fields are tolerated. */
export const usageResultSchema = z
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

/** One group-by row inside a cost bucket. `amount` is a decimal string. */
export const costResultSchema = z
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

export const bucketSchema = z.object({
  starting_at: z.string(),
  ending_at: z.string().optional(),
  results: z.array(z.unknown()).default([]),
});

export const pageSchema = z.object({
  data: z.array(bucketSchema).default([]),
  has_more: z.boolean().default(false),
  next_page: z.string().nullable().default(null),
});

/**
 * A parsed cursor, and the two starts it implies.
 *
 * `startingAt` is the position ON RECORD — where the source has got to, and
 * the value a cut-off run writes back. `requestStart` is the instant this run
 * ASKS from, which for a drained cost cursor sits a few days behind it. They
 * were one field until a cost read started looking back, and collapsing them
 * again is what walks the saved position backwards on every run.
 */
export interface ParsedCursor extends Pick<
  z.infer<typeof cursorSchema>,
  "startingAt" | "page" | "watermark"
> {
  /**
   * The instant this run ASKS from, which on a cost source is a few days
   * behind the position on record so a late restatement is picked up.
   *
   * The look-back was being computed and then thrown away: every request
   * went out at `cursor.startingAt`, so the repair window existed on paper
   * and never once reached the provider.
   */
  requestStart: string;
}

export function usageEvent({
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
    model: AdminUsageReportAdapter.dimension(result.model),
    workspaceId: AdminUsageReportAdapter.dimension(result.workspace_id),
    apiKeyId: AdminUsageReportAdapter.dimension(result.api_key_id),
    serviceTier: AdminUsageReportAdapter.dimension(result.service_tier),
    contextWindow: AdminUsageReportAdapter.dimension(result.context_window),
  };
  return {
    source_event_id: `usage:${startingAt}:${AdminUsageReportAdapter.dimensionPath(dimensions)}`,
    event_timestamp: startingAt,
    // Empty on purpose, not an oversight. The usage report groups by model,
    // workspace, key, tier and context window — there is no person dimension
    // to ask for, so no row here names one. Person discovery skips a blank
    // actor, which is the right answer: inventing one would attribute the
    // whole workspace's tokens to a made-up name. Attribution for Anthropic
    // has to come from the key, elsewhere.
    actor: "",
    action: "usage_report",
    target: AdminUsageReportAdapter.dimension(result.model),
    // Anthropic reports no cost on this report; we price the quantities.
    cost_usd: "0",
    tokens_input: result.uncached_input_tokens,
    tokens_output: result.output_tokens,
    raw_payload: JSON.stringify(result),
    extra: {
      [PULLED_USAGE_HINT_KEY]: {
        costBasis: "computed",
        dimensions,
        model: AdminUsageReportAdapter.dimension(result.model),
        tokensCacheRead: result.cache_read_input_tokens,
        tokensCacheWrite: cacheWriteTokens(result),
      },
    },
  };
}

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
export function queryIdentity(config: AnthropicAdminPullConfig): string {
  return config.report === "usage"
    ? `usage:${config.bucketWidth}:${USAGE_GROUP_BY.join(",")}`
    : `cost:${COST_REPORT_BUCKET_WIDTH}:${COST_GROUP_BY.join(",")}:${config.startingAt ?? ""}`;
}

export function encodeCursor({
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
export function defaultStartingAt(report: "usage" | "cost"): string {
  const daysBack = report === "cost" ? 3 : 1;
  // Snap to midnight UTC so the timestamp aligns with daily bucket boundaries.
  return nowInstant()
    .subtract({ milliseconds: daysBack * 24 * 60 * 60 * 1000 })
    .toZonedDateTimeISO("UTC")
    .startOfDay()
    .toInstant()
    .toString({ fractionalSecondDigits: 3 });
}

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

/**
 * The request URL for one page of one report. Everything here except `page`
 * is what `queryIdentity` binds the cursor to — change one, change both.
 */
export function reportUrl({
  config,
  startingAt,
  page,
}: {
  config: AnthropicAdminPullConfig;
  startingAt: string;
  page: string | null;
}): URL {
  const url = new URL(
    config.report === "usage" ? `${API_BASE}/usage_report/messages` : `${API_BASE}/cost_report`,
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
    hint.tokensCacheRead ?? 0,
    hint.tokensCacheWrite ?? 0,
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
export function assertRowsAreDistinguishable({
  events,
  report,
}: {
  events: NormalizedPullEvent[];
  report: AnthropicAdminPullConfig["report"];
}): void {
  const colliding = collidingRowsByKey(events);
  if (colliding.size === 0) return;
  const dimensionNames = Object.keys(emittedHint(events[0]!).dimensions ?? {});
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
      : `; the colliding rows differ in ${[...differingNames].toSorted().join(", ")}`;
  throw new Error(
    `anthropic ${report}_report returned one page holding ${colliding.size} restatement key(s) ` +
      `shared by rows reporting different amounts; the key is built from ${dimensionNames.join(", ")}, ` +
      `so the provider is distinguishing these rows by something outside it and recording the page ` +
      `would drop spend${differingClause}`,
  );
}

/**
 * The rows behind each key that two or more of them report different amounts
 * under. Keys whose rows agree are not here: a provider repeating a row costs
 * nothing, whichever copy survives the upsert.
 */
function collidingRowsByKey(events: NormalizedPullEvent[]): Map<string, NormalizedPullEvent[]> {
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
  return new Map([...collidingKeys].map((key) => [key, rowsByKey.get(key) ?? []]));
}

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
export function costRequestStart({
  stored,
  config,
}: {
  stored: string;
  config: AnthropicAdminPullConfig;
}): string {
  const storedMs = toEpochMs(stored);
  if (Number.isNaN(storedMs)) return stored;

  const configuredStart = config.startingAt ?? defaultStartingAt("cost");
  const floorMs = toEpochMs(configuredStart);
  const lookedBackMs = storedMs - COST_RESTATEMENT_LOOKBACK_DAYS * MS_PER_DAY;
  const notBeforeConfigured = Number.isNaN(floorMs)
    ? lookedBackMs
    : Math.max(lookedBackMs, floorMs);
  return Temporal.Instant.fromEpochMilliseconds(Math.min(notBeforeConfigured, storedMs)).toString();
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
  const rows = events.flatMap((event) => rawPayloadRow(event));
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
      const differs = JSON.stringify(first[name] ?? null) !== JSON.stringify(row[name] ?? null);
      if (differs) {
        names.add(name);
      }
    }
  }
  return [...names];
}

/**
 * The hint off an event this adapter emitted. `extra` is an untyped bag on the
 * shared event shape, so reading our own hint back needs the cast; every event
 * built below carries one.
 */
function emittedHint(event: NormalizedPullEvent): EmittedUsageHint {
  return (event.extra?.[PULLED_USAGE_HINT_KEY] as EmittedUsageHint | undefined) ?? {};
}

/**
 * The later of two instants, ignoring one that cannot be parsed.
 *
 * `newestBucketStart` orders a page against itself. Anthropic promises no
 * order ACROSS pages either, so the run needs the same maximum one level up:
 * without it the last page read wins, and a final page whose newest bucket is
 * older than an earlier page's lowers the resume point below buckets this run
 * has already emitted.
 */
export function laterInstant(a: string | null, b: string): string {
  if (a === null) return b;
  const aMs = toEpochMs(a);
  const bMs = toEpochMs(b);
  if (Number.isNaN(bMs)) return a;
  if (Number.isNaN(aMs)) return b;
  return bMs > aMs ? b : a;
}

/** The provider row an event stored, or none when its payload is not a JSON object. */
function rawPayloadRow(event: NormalizedPullEvent): Record<string, unknown>[] {
  try {
    const value: unknown = JSON.parse(event.raw_payload);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? [value as Record<string, unknown>]
      : [];
  } catch {
    return [];
  }
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
export function unfinishedWindowStart({
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

/**
 * The window start a drained run saves: the newest bucket emitted across
 * EVERY page this run read, which is what a drained window resumes from.
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
export function drainedWindowStart({
  newestEmitted,
  positionOnRecord,
}: {
  newestEmitted: string | null;
  positionOnRecord: string;
}): string {
  // Floored at the position on record. Without this floor a run that
  // looked back and found nothing newer saves the day it looked back TO,
  // and the source walks three days backwards on every run until it
  // reaches the day it was first connected - re-reading and re-emitting
  // the whole history on the way. An empty window, a credit, and a
  // workspace somebody deleted all produce exactly that page. This is the
  // floor the sibling connection already applies at its own drain.
  return laterInstant(newestEmitted, positionOnRecord);
}
