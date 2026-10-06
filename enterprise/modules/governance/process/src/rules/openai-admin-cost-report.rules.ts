// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The OpenAI Admin cost report read as data: the request each page is, the
 * durable cursor and where it resumes, one USD row as a priced event, and the
 * result a run returns. The puller runs it; nothing here does I/O.
 */

import {
  PULLED_USAGE_HINT_KEY,
  type OpenAiAdminPullConfig,
  type NormalizedPullEvent,
  type PullResult,
} from "@langwatch/enterprise-governance-contract";
import { Temporal, nowInstant, toEpochMs } from "@langwatch/time";
import { z } from "zod";

import * as AdminUsageReportAdapter from "./admin-usage-report.rules.ts";

/**
 * The Admin API root. NOT `api.chatgpt.com`, which is the Enterprise
 * Compliance API and answers 403 to an admin key — the mistake the source this
 * one replaces was built on.
 */
const API_BASE = "https://api.openai.com/v1/organization";

/**
 * The `limit` this adapter asks for, and NOT what it gets.
 *
 * 180 is the published contract value — OpenAI's own OpenAPI document gives it
 * as the cost report's maximum. The wire does not honour it and does not
 * complain either: asking `/costs` for `limit=32` answers HTTP 200 with 31
 * buckets, clamped silently rather than rejected (probe A14), and the probe
 * kit records the wire ceiling for daily cost buckets as 31 against the
 * published 180. Where the two disagree the wire is what an integration
 * receives, so a page here is about one month of daily buckets, not six.
 *
 * Not the USAGE endpoints' behaviour, which is the opposite and must not be
 * blurred with it: those DO reject an over-ceiling limit, naming a maximum per
 * bucket width (probe A13 — 1440 for `1m`, 168 for `1h`, 31 for `1d`). This
 * adapter never calls them.
 *
 * The value stays at 180 deliberately. Paging follows `next_page` rather than
 * a row count, so asking for more than the provider will give simply returns
 * the provider's page and costs nothing.
 */
const PAGE_LIMIT = 180;

/**
 * The only width the endpoint accepts — `1h` is refused naming `1d` as the
 * supported set. It is BOTH the request parameter and a restatement-key
 * dimension, and the two must never diverge: a width that varied would re-key
 * every unchanged bucket and record the same spend a second time.
 */
const COST_REPORT_BUCKET_WIDTH = "1d" as const;

/**
 * The dimensions the report is grouped by, which are also the restatement
 * key's coordinates. These four are the endpoint's entire enum — a deliberately
 * bogus value is refused with the full list — so there is no fifth to add and
 * nothing to drop: each one distinguishes rows the API returns separately, and
 * removing one would silently merge distinct spend under a last-write-wins key.
 */
const COST_GROUP_BY = ["project_id", "line_item", "user_id", "api_key_id"] as const;

/**
 * Below the provider's key-grouping floor (2025-12-06), the API refuses ANY
 * request that includes api_key_id — regardless of how many other dimensions
 * ride alongside it. Only user_id alone works for those older windows; adding
 * project_id or line_item back triggers the same 400.
 *
 * The person survives; project and line-item detail is lost alongside the key.
 */
const COST_GROUP_BY_WITHOUT_KEY = ["user_id"] as const;

/**
 * How far behind its watermark each run re-reads, so a bucket the provider
 * corrects can still land (ADR-122 Decision 9).
 *
 * A margin, not a measurement: OpenAI's restatement lag is unobserved, and the
 * sibling adapter documents about a day for Anthropic. It costs three daily
 * buckets on one request per run, and the restatement key makes the re-read
 * replace rather than add.
 */
const RESTATEMENT_LOOKBACK_DAYS = 3;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The durable cursor.
 *
 * `startingAt` is the window a fresh run reads from and `page` is OpenAI's own
 * token inside it, so a run cut off mid-window resumes mid-window.
 *
 * `query` is the identity of the request the cursor was minted under. The
 * provider binds a page token to its exact query and refuses it under any
 * other, and this adapter holds the cursor still on failure — so without the
 * binding one config edit mid-window would wedge the source permanently, every
 * retry replaying the same dead token.
 *
 * That binding is wire-verified (probes A32-A35) but UNCONTRACTED: OpenAI
 * publishes no promise about it, so it can change without a deprecation and
 * without anything here going red.
 *
 * `hasKeyGrouping` records whether the in-flight window is being read WITH
 * `api_key_id` in the group-by. It has to be durable for the same reason
 * `page` does: the token is bound to the group-by that produced it, so a run
 * resuming into a window that fell back to user_id-only must keep asking
 * with the same single dimension.
 */
export const cursorSchema = z.object({
  startingAt: z.string(),
  page: z.string().nullable().default(null),
  query: z.string().nullable().default(null),
  /**
   * Newest bucket already emitted from the in-flight window. Null once the
   * window drains, at which point `startingAt` itself is the resume point.
   */
  watermark: z.string().nullable().default(null),
  hasKeyGrouping: z.boolean().default(true),
  /**
   * True when the previous window drained with user-only grouping and the
   * cursor was set to retry with key grouping. Tells parseCursor to skip the
   * restatement lookback so the first keyed window does not overlap with the
   * last user-only window — overlapping would emit different source_event_ids
   * for the same buckets and double the reported spend.
   */
  keyGroupingUpgrade: z.boolean().default(false),
});

export interface ParsedCursor {
  /** What this run asks the provider for — the stored start moved back by the
   *  restatement look-back, unless a page token pins it. */
  windowStart: string;
  /**
   * What to persist when the run ends WITHOUT a page token in hand.
   *
   * Deliberately not `windowStart`. Writing the looked-back value back would
   * make the look-back compound: a run that ends early with nothing to resume
   * from would save a start three days older than the one it was given, and
   * the next run would take three more off that. A source that keeps hitting
   * its deadline would walk steadily backwards until it was re-reading the
   * whole backfill window every run.
   */
  storedStart: string;
  page: string | null;
  watermark: string | null;
  hasKeyGrouping: boolean;
}

/** One group-by row inside a cost bucket. Unknown fields are tolerated so the
 *  raw payload keeps everything the provider sent. */
export const costResultSchema = z
  .object({
    /**
     * Denominated in DOLLARS, unlike the Anthropic sibling's cents. Kept as a
     * string from here on so a sub-cent figure never passes through a float.
     */
    amount: z.object({
      value: z.union([z.string(), z.number()]).transform(String),
      currency: z.string(),
    }),
    line_item: z.string().nullable().default(null),
    project_id: z.string().nullable().default(null),
    /**
     * The provider's opaque id ("user-…") for the person the row is billed
     * to. The row ALSO carries a `user_email` beside it — verified against
     * saved raw responses (2026-08-25, re-confirmed 2026-09-06: 2,720/2,720
     * rows populated) — and this adapter deliberately reads the id, not the
     * address: the id is stable, and a raw email is heavier on a money row
     * (erasure, exposure). `.passthrough()` below carries the address as far
     * as this function and no further: `costEvent` drops it before the row is
     * stringified into `raw_payload`, so the address is never stored.
     *
     * Null whenever the row was not grouped by user, so it is read through
     * `dimension()` like every other coordinate.
     */
    user_id: z.string().nullable().default(null),
    api_key_id: z.string().nullable().default(null),
  })
  .passthrough();

export const bucketSchema = z.object({
  /** Epoch SECONDS, not an ISO instant. */
  start_time: z.number(),
  end_time: z.number().optional(),
  results: z.array(z.unknown()).default([]),
});

export const pageSchema = z.object({
  data: z.array(bucketSchema).default([]),
  has_more: z.boolean().default(false),
  next_page: z.string().nullable().default(null),
});

/**
 * One page, read or refused. `hasBankedProgress` says whether the refusal
 * arrived with earlier pages of the same run already read — see
 * `mustBankRefusal`.
 */
export type PageRead =
  | {
      ok: true;
      events: NormalizedPullEvent[];
      nextPage: string | null;
      watermark: string | null;
      hasKeyGrouping: boolean;
    }
  | { ok: false; hasBankedProgress: boolean };

/**
 * What a run returns when a page could not be read.
 *
 * With earlier pages banked it returns what a run stopped short by the
 * deadline returns — the events read so far, and a cursor resuming at the
 * page still owed — with the refusal counted. `errorCount: 1` beside an
 * ADVANCED cursor is what the worker reads as a partial success: the events
 * are written, the cursor is persisted.
 *
 * With nothing banked the INCOMING cursor comes back unchanged, which is
 * what fails the run so the outbox retries the same window. Returning it in
 * BOTH cases was the bug: a refusal on page three ended every run with no
 * forward progress at all, so the next run asked for page one again and was
 * refused at page three again, for as long as the window needed more than
 * one page.
 */
export function pageUnread({
  hasBankedProgress,
  events,
  stoppedShort,
  incomingCursor,
}: {
  hasBankedProgress: boolean;
  events: NormalizedPullEvent[];
  stoppedShort: () => PullResult;
  incomingCursor: string | null;
}): PullResult {
  if (hasBankedProgress) return { ...stoppedShort(), errorCount: 1, unreadPage: true as const };
  return { events, cursor: incomingCursor, errorCount: 1 };
}

/**
 * One USD cost row as a priced event. The caller has already refused a row
 * in any other currency.
 */
export function usdCostEvent({
  result,
  startingAt,
  hasKeyGrouping,
}: {
  result: z.infer<typeof costResultSchema>;
  startingAt: string;
  hasKeyGrouping: boolean;
}): NormalizedPullEvent {
  const dimensions: Record<string, string> = {
    report: "cost",
    bucketWidth: COST_REPORT_BUCKET_WIDTH,
    projectId: AdminUsageReportAdapter.dimension(result.project_id),
    lineItem: AdminUsageReportAdapter.dimension(result.line_item),
    userId: AdminUsageReportAdapter.dimension(result.user_id),
    // Present only when the window was read with the key dimension. Below
    // the provider's floor the coordinate is absent rather than empty: a
    // stable "" would be a claim about a key, and the map for a given bucket
    // is read one way or the other, never both.
    ...(hasKeyGrouping ? { apiKeyId: AdminUsageReportAdapter.dimension(result.api_key_id) } : {}),
  };

  // The provider's own dollars, verbatim. NOT cents: the Anthropic sibling
  // shifts a decimal here and porting that reports 100x the real spend.
  const amountUsd = result.amount.value;

  // Everything the provider sent EXCEPT the billed person's email address.
  // `.passthrough()` keeps unknown fields so a later question about a row can
  // be answered from what was stored; the address is the one field excluded,
  // because no screen, query or export reads it and keeping a raw address on
  // every money row only adds erasure and exposure surface. The opaque
  // `user_id` stays — it is the actor and the erasure key.
  const { user_email: _droppedEmail, ...retainedPayload } = result;

  return {
    source_event_id: `cost:${startingAt}:${AdminUsageReportAdapter.dimensionPath(dimensions)}`,
    event_timestamp: startingAt,
    /**
     * The person the row is billed to, as the provider's own opaque user id.
     * No directory is asked — the report already names them.
     *
     * Identity-safe by construction. `source_event_id` above and the
     * restatement key downstream are built from `dimensions`, which ALREADY
     * carries this exact value as `userId`; `actor` is in neither. So filling
     * it in re-keys nothing, lands no second row beside an existing one, and
     * cannot double-count a day's spend — a re-read of an old bucket restates
     * it in place and simply starts naming somebody.
     *
     * An id, not an address, and the erasure suppression list is keyed on
     * exactly this string, so the two agree: erasing this person suppresses
     * this id. The provider DOES send a `user_email` beside the id; it is
     * deliberately not the actor, and it is dropped from the retained payload
     * rather than stored, because nothing in the product reads it and an
     * address on a money row is pure liability.
     */
    actor: AdminUsageReportAdapter.dimension(result.user_id),
    action: "cost_report",
    target: AdminUsageReportAdapter.dimension(result.line_item),
    cost_usd: amountUsd,
    tokens_input: 0,
    tokens_output: 0,
    raw_payload: JSON.stringify(retainedPayload),
    extra: {
      // Raw provider ids, resolved never (ADR-088 Decision 13). The worker
      // spreads `extra` into the audit row's metadata extension, which is
      // where the shipped Genie attribution puts the same thing — so this
      // needs no change to the published event contract.
      actorUserId: AdminUsageReportAdapter.dimension(result.user_id),
      apiKeyId: AdminUsageReportAdapter.dimension(result.api_key_id),
      [PULLED_USAGE_HINT_KEY]: {
        costBasis: "provider_reported",
        // The provider's figure, but not the invoice: nothing establishes
        // that this report equals the bill, and the provider's own usage
        // surface already disagrees with it.
        costStatus: "estimate",
        costUsd: amountUsd,
        dimensions,
        model: AdminUsageReportAdapter.dimension(result.line_item),
      },
    },
  };
}

/**
 * The configuration a cursor is bound to: everything that rides beside `page`
 * in the request, plus the configured `startingAt`.
 *
 * `startingAt` is in here for the repair lever. It decides how far back a
 * stale-cursor rewind reaches, so widening it on a source that has already run
 * must mint a new identity — otherwise the cursor matches forever and the
 * deeper history is unreachable without deleting the cursor by hand. That
 * lever is the operator's answer to a correction that arrived later than
 * `RESTATEMENT_LOOKBACK_DAYS`.
 *
 * The floor fallback is deliberately NOT part of this. It is decided per
 * request from the provider's own refusal and carried on the cursor, so
 * binding it here would mint a new identity mid-window and discard a live
 * token over something the config never said.
 */
export function queryIdentity(config: OpenAiAdminPullConfig): string {
  return `cost:${COST_REPORT_BUCKET_WIDTH}:${COST_GROUP_BY.join(",")}:${config.startingAt ?? ""}`;
}

/**
 * The window a drained cursor's next run reads from: the watermark, moved back
 * by the restatement look-back, but never before the configured start and
 * never forward of the watermark itself.
 */
export function windowStartFor({
  stored,
  config,
}: {
  stored: string;
  config: OpenAiAdminPullConfig;
}): string {
  const storedMs = toEpochMs(stored);
  if (Number.isNaN(storedMs)) return config.startingAt ?? defaultStartingAt();

  const floorMs = toEpochMs(config.startingAt ?? defaultStartingAt());
  const lookedBack = storedMs - RESTATEMENT_LOOKBACK_DAYS * MS_PER_DAY;
  const notBeforeConfigured = Number.isNaN(floorMs) ? lookedBack : Math.max(lookedBack, floorMs);
  return Temporal.Instant.fromEpochMilliseconds(Math.min(notBeforeConfigured, storedMs)).toString({
    fractionalSecondDigits: 3,
  });
}

/**
 * A first run with no configured start.
 *
 * Daily buckets with a processing lag, so three days back guarantees at least
 * one settled bucket. Snapped to midnight UTC to align with bucket boundaries.
 */
export function defaultStartingAt(): string {
  return nowInstant()
    .subtract({ milliseconds: 3 * MS_PER_DAY })
    .toZonedDateTimeISO("UTC")
    .startOfDay()
    .toInstant()
    .toString({ fractionalSecondDigits: 3 });
}

/**
 * Whether a 400 is the provider refusing to group by API key this far back.
 *
 * Gated on `param` AND `code` together, and never on the message. Both halves
 * are load-bearing: the endpoint's other rejections carry `param: "start_time"`
 * with `code: "invalid_type"` (an unparseable date), or `code:
 * "invalid_request_error"` with `param: null` (a missing date, an over-ceiling
 * limit). Only this refusal carries both. Reading the English instead would
 * make a sentence the provider is free to reword decide whether months of
 * history are attributed.
 */
export function isKeyGroupingRefusal(body: string): boolean {
  try {
    const parsed: unknown = JSON.parse(body);
    const envelope =
      parsed !== null && typeof parsed === "object" && "error" in parsed
        ? (parsed as { error: unknown }).error
        : parsed;
    if (envelope === null || typeof envelope !== "object") return false;
    const { param, code } = envelope as { param?: unknown; code?: unknown };
    return param === "start_time" && code === "invalid_request_error";
  } catch {
    return false;
  }
}

/** ISO instant for a bucket's epoch-seconds start. */
export function bucketStartIso(startTime: number): string {
  return Temporal.Instant.fromEpochMilliseconds(startTime * 1000).toString({
    fractionalSecondDigits: 3,
  });
}

/**
 * The request URL for one page. Everything here except `page` is what
 * `queryIdentity` binds the cursor to — change one, change both.
 *
 * `end_time` is deliberately absent. It is optional, and a window whose end
 * moves with the clock would invalidate every page token the moment the run
 * asked for the next page.
 */
export function reportUrl({
  startingAt,
  page,
  hasKeyGrouping,
}: {
  startingAt: string;
  page: string | null;
  hasKeyGrouping: boolean;
}): URL {
  const url = new URL(`${API_BASE}/costs`);
  const startMs = toEpochMs(startingAt);
  if (Number.isNaN(startMs)) {
    throw new Error(`openai admin puller cannot read a window start of "${startingAt}"`);
  }
  url.searchParams.set("start_time", String(Math.floor(startMs / 1000)));
  url.searchParams.set("bucket_width", COST_REPORT_BUCKET_WIDTH);
  url.searchParams.set("limit", String(PAGE_LIMIT));
  for (const dim of hasKeyGrouping ? COST_GROUP_BY : COST_GROUP_BY_WITHOUT_KEY) {
    url.searchParams.append("group_by[]", dim);
  }
  if (page) url.searchParams.set("page", page);
  return url;
}

function encodeCursor({
  startingAt,
  page,
  query,
  watermark,
  hasKeyGrouping,
  keyGroupingUpgrade,
}: Omit<z.infer<typeof cursorSchema>, "query"> & { query: string }): string {
  return JSON.stringify({
    startingAt,
    page,
    query,
    watermark,
    hasKeyGrouping,
    keyGroupingUpgrade,
  });
}

/** Cursor emitted when a window drains (no more pages). */
function drainCursor({
  watermark,
  storedStart,
  hasKeyGrouping,
  query,
}: {
  watermark: string | null;
  storedStart: string;
  hasKeyGrouping: boolean;
  query: string;
}): Parameters<typeof encodeCursor>[0] {
  // The stored start never moves backwards: a retracted window whose newest
  // bucket predates the stored start must not rewind the source.
  const start = laterOf(watermark, storedStart);
  return {
    // When upgrading from user-only to keyed grouping, advance one bucket past
    // the watermark: that day was already emitted with user-only dimensions,
    // and re-reading it with keyed dimensions would produce a different
    // source_event_id, doubling that day.
    startingAt: !hasKeyGrouping
      ? Temporal.Instant.fromEpochMilliseconds(toEpochMs(start) + MS_PER_DAY).toString({
          fractionalSecondDigits: 3,
        })
      : start,
    page: null,
    query,
    watermark: null,
    hasKeyGrouping: true,
    keyGroupingUpgrade: !hasKeyGrouping,
  };
}

/** The later of two ISO instants, tolerating nulls and unparseable input. */
export function laterOf(a: string | null, b: string): string {
  if (a === null) return b;
  const aMs = toEpochMs(a);
  const bMs = toEpochMs(b);
  if (Number.isNaN(aMs)) return b;
  if (Number.isNaN(bMs)) return a;
  return bMs > aMs ? b : a;
}

/**
 * The run continued without per-key attribution, and said so.
 *
 * A code rather than a sentence: it is read by a source-health surface that
 * owns its own wording, and it has to survive a trip through storage. A log
 * line was the alternative and is not one — a reader looking at the source
 * cannot be shown a log.
 */
export const PER_KEY_ATTRIBUTION_UNAVAILABLE = "per_key_attribution_unavailable" as const;

/**
 * The notices field, or nothing at all.
 *
 * Absent rather than empty on a clean run, so a reader never has to tell an
 * adapter that reported no notices from one that reports none because it does
 * not know how.
 *
 * `hasLostKeyAttribution` is whether any page in THIS run came back without
 * per-key attribution. The fallback itself is correct — the money survives it,
 * undivided — but it left no trace, so a provider quietly widening what it
 * refuses would cost every customer their attribution in silence. Read off this
 * run's own pages rather than off the cursor: a window already being read
 * undivided is not this run's news to report.
 */
function runNotices(hasLostKeyAttribution: boolean): { notices?: string[] } {
  return hasLostKeyAttribution ? { notices: [PER_KEY_ATTRIBUTION_UNAVAILABLE] } : {};
}

/**
 * What a run that stopped before draining the window returns.
 *
 * Both ways out of the loop — the deadline and the page cap — leave the
 * same thing behind: every event read so far, a cursor pointing at where
 * to resume, and no error, because nothing failed. `truncated` is the part
 * that must not be forgotten at either exit; a half-read window that says
 * nothing is recorded as complete.
 *
 * The resume point: with a page token in hand it must be the window the
 * token was minted against; without one it is the start this run was GIVEN,
 * never the looked-back one — see `ParsedCursor.storedStart`.
 */
export function stoppedShortResult({
  events,
  cursor,
  page,
  query,
  watermark,
  hasKeyGrouping,
  hasLostKeyAttribution,
}: {
  events: NormalizedPullEvent[];
  cursor: ParsedCursor;
  page: string | null;
  query: string;
  watermark: string | null;
  hasKeyGrouping: boolean;
  hasLostKeyAttribution: boolean;
}): PullResult {
  return {
    events,
    cursor: encodeCursor({
      startingAt: page === null ? cursor.storedStart : cursor.windowStart,
      page,
      query,
      watermark,
      hasKeyGrouping,
      keyGroupingUpgrade: false,
    }),
    errorCount: 0,
    completeness: "truncated",
    ...runNotices(hasLostKeyAttribution),
  };
}

/** What a run whose window drained returns: the drain cursor, and nothing owed. */
export function drainedResult({
  events,
  cursor,
  watermark,
  hasKeyGrouping,
  query,
  hasLostKeyAttribution,
}: {
  events: NormalizedPullEvent[];
  cursor: ParsedCursor;
  watermark: string | null;
  hasKeyGrouping: boolean;
  query: string;
  hasLostKeyAttribution: boolean;
}): PullResult {
  return {
    events,
    cursor: encodeCursor(
      drainCursor({ watermark, storedStart: cursor.storedStart, hasKeyGrouping, query }),
    ),
    errorCount: 0,
    ...runNotices(hasLostKeyAttribution),
  };
}
