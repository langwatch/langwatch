// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * OpenAI Admin API puller — organization spend, attributed to the person and
 * the API key it was billed to (ADR-122).
 *
 * Like the Anthropic Admin puller it cannot be an `HttpPollingPullerAdapter`
 * config: the endpoint returns time BUCKETS holding group-by rows, and the
 * bucket's coordinates are what the restatement key is built from. A flat
 * `Record<string, string>` field mapping has nowhere to put that, the
 * declarative adapter never sees an error body (which this one has to read),
 * and it carries no watermark of its own.
 *
 * One report and only one: `/v1/organization/costs`. The `/usage/*` surface
 * returns zero rows for spend this one bills, so pulling both would record the
 * same money twice under two bases with nothing to reconcile them (ADR-088
 * Decision 6 defers the supersede rule that would let them coexist).
 *
 * Three things separate this from its Anthropic sibling, and each is a bug
 * waiting to be reintroduced by copying the other file:
 *
 *   MONEY   `amount.value` is denominated in DOLLARS. Anthropic's equivalent
 *           field is cents and its adapter shifts the decimal. Doing that here
 *           reports 100x the real spend. Nothing in this file divides.
 *   TIME    Buckets are epoch SECONDS, not ISO instants.
 *   FLOOR   `group_by=api_key_id` is refused before a date the provider names.
 *           The window is kept and the dimension is dropped, so the person on
 *           the row survives for the whole history.
 *
 * Restatement is a trailing re-read: each run starts
 * `RESTATEMENT_LOOKBACK_DAYS` behind its watermark so a bucket the provider
 * revises still lands. Reading each bucket once would leave a wrong figure
 * permanent, and nothing downstream aggregates this ledger yet, so no operator
 * would ever be told.
 *
 * Spec: specs/ai-governance/puller-framework/openai-admin-cost.feature
 */

import { createLogger } from "@langwatch/observability";
import { z } from "zod";

import { ssrfSafeFetch } from "~/utils/ssrfProtection";
import { PULLED_USAGE_HINT_KEY } from "./pulledUsageRecord";
import type {
  NormalizedPullEvent,
  PullerAdapter,
  PullResult,
  PullRunOptions,
} from "./pullerAdapter";

const logger = createLogger("langwatch:governance:openai-admin-puller");

/**
 * The Admin API root. NOT `api.chatgpt.com`, which is the Enterprise
 * Compliance API and answers 403 to an admin key — the mistake the source this
 * one replaces was built on.
 */
const API_BASE = "https://api.openai.com/v1/organization";
const REQUEST_TIMEOUT_MS = 30_000;

/** A run stops here rather than paginating forever; the cursor carries the
 *  rest into the next one. At `PAGE_LIMIT` buckets a page this bounds a run at
 *  roughly ten years, so it is a runaway guard rather than a throttle. */
const MAX_PAGES_PER_RUN = 20;

/**
 * The API's own ceiling. Above it the request is REJECTED rather than clamped
 * ("Limit must be less than or equal to 180."), so this is a contract value,
 * not a preference. One page is about six months of daily buckets.
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
const COST_GROUP_BY = [
  "project_id",
  "line_item",
  "user_id",
  "api_key_id",
] as const;

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

export const OPENAI_ADMIN_ADAPTER_ID = "openai_admin" as const;

export const openaiAdminPullConfigSchema = z.object({
  adapter: z.literal(OPENAI_ADMIN_ADAPTER_ID),
  /**
   * A single-value enum rather than a bare constant, so a second report could
   * be added later without re-keying the rows this one wrote — `report` rides
   * the restatement key.
   */
  report: z.enum(["cost"]).default("cost"),
  /** ISO instant the very first run starts from. Later runs use the cursor. */
  startingAt: z.string().datetime().optional(),
  schedule: z.string().default("0 * * * *"),
});
export type OpenAiAdminPullConfig = z.infer<typeof openaiAdminPullConfigSchema>;

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
 * `hasKeyGrouping` records whether the in-flight window is being read WITH
 * `api_key_id` in the group-by. It has to be durable for the same reason
 * `page` does: the token is bound to the group-by that produced it, so a run
 * resuming into a window that fell back to user_id-only must keep asking
 * with the same single dimension.
 */
const cursorSchema = z.object({
  startingAt: z.string(),
  page: z.string().nullable().default(null),
  query: z.string().nullable().default(null),
  /**
   * Newest bucket already emitted from the in-flight window. Null once the
   * window drains, at which point `startingAt` itself is the resume point.
   */
  watermark: z.string().nullable().default(null),
  hasKeyGrouping: z.boolean().default(true),
});

interface ParsedCursor {
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
function queryIdentity(config: OpenAiAdminPullConfig): string {
  return `cost:${COST_REPORT_BUCKET_WIDTH}:${COST_GROUP_BY.join(",")}:${
    config.startingAt ?? ""
  }`;
}

function parseCursor({
  cursor,
  config,
}: {
  cursor: string | null;
  config: OpenAiAdminPullConfig;
}): ParsedCursor {
  if (cursor) {
    try {
      const parsed = cursorSchema.parse(JSON.parse(cursor));
      if (parsed.query === queryIdentity(config)) {
        return {
          // Mid-window (a page token in hand) the start must stay exactly what
          // the token was minted against. Only a cursor with no token in hand
          // gets the trailing re-read applied to it.
          windowStart:
            parsed.page === null
              ? windowStartFor({ stored: parsed.startingAt, config })
              : parsed.startingAt,
          storedStart: parsed.startingAt,
          page: parsed.page,
          watermark: parsed.watermark,
          hasKeyGrouping: parsed.hasKeyGrouping,
        };
      }
      return staleCursorRestart({ parsed, config });
    } catch {
      logger.warn(
        { adapter: OPENAI_ADMIN_ADAPTER_ID },
        "unreadable openai admin cursor; restarting from the configured start",
      );
    }
  }
  const fresh = config.startingAt ?? defaultStartingAt();
  return {
    windowStart: fresh,
    storedStart: fresh,
    page: null,
    watermark: null,
    hasKeyGrouping: true,
  };
}

/**
 * Where a run resumes after its cursor failed the query-identity check.
 *
 * Cost identity is independent of config — the dimensions come off the
 * provider's rows and the bucket width is pinned — so a re-read emits the same
 * `source_event_id`s and restatement replaces the old rows in place rather
 * than landing beside them. That makes rewinding safe, which is what turns
 * "widen the backfill start" into a working repair.
 */
function staleCursorRestart({
  parsed,
  config,
}: {
  parsed: z.infer<typeof cursorSchema>;
  config: OpenAiAdminPullConfig;
}): ParsedCursor {
  logger.warn(
    { adapter: OPENAI_ADMIN_ADAPTER_ID },
    "openai admin cursor was minted under a different query or repair window; discarding it and re-reading from the start",
  );
  const configuredStart = config.startingAt ?? defaultStartingAt();
  // The EARLIER of the stored watermark and the configured start: a rewind
  // must never move the watermark FORWARD. A source that fell behind holds a
  // watermark older than the default window, and snapping it forward would
  // silently skip everything in between.
  const storedMs = Date.parse(parsed.startingAt);
  const rewound =
    Number.isNaN(storedMs) || Date.parse(configuredStart) <= storedMs
      ? configuredStart
      : parsed.startingAt;
  return {
    windowStart: rewound,
    storedStart: rewound,
    page: null,
    watermark: null,
    hasKeyGrouping: true,
  };
}

/**
 * The window a drained cursor's next run reads from: the watermark, moved back
 * by the restatement look-back, but never before the configured start and
 * never forward of the watermark itself.
 */
function windowStartFor({
  stored,
  config,
}: {
  stored: string;
  config: OpenAiAdminPullConfig;
}): string {
  const storedMs = Date.parse(stored);
  if (Number.isNaN(storedMs)) return config.startingAt ?? defaultStartingAt();

  const floorMs = Date.parse(config.startingAt ?? defaultStartingAt());
  const lookedBack = storedMs - RESTATEMENT_LOOKBACK_DAYS * MS_PER_DAY;
  const notBeforeConfigured = Number.isNaN(floorMs)
    ? lookedBack
    : Math.max(lookedBack, floorMs);
  return new Date(Math.min(notBeforeConfigured, storedMs)).toISOString();
}

/**
 * A first run with no configured start.
 *
 * Daily buckets with a processing lag, so three days back guarantees at least
 * one settled bucket. Snapped to midnight UTC to align with bucket boundaries.
 */
function defaultStartingAt(): string {
  const d = new Date(Date.now() - 3 * MS_PER_DAY);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/** Cap on how much of an error response body we log. */
const MAX_ERROR_BODY_BYTES = 4_096;

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
function isKeyGroupingRefusal(body: string): boolean {
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

/** One group-by row inside a cost bucket. Unknown fields are tolerated so the
 *  raw payload keeps everything the provider sent. */
const costResultSchema = z
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
    user_id: z.string().nullable().default(null),
    user_email: z.string().nullable().default(null),
    api_key_id: z.string().nullable().default(null),
  })
  .passthrough();

const bucketSchema = z.object({
  /** Epoch SECONDS, not an ISO instant. */
  start_time: z.number(),
  end_time: z.number().optional(),
  results: z.array(z.unknown()).default([]),
});

const pageSchema = z.object({
  data: z.array(bucketSchema).default([]),
  has_more: z.boolean().default(false),
  next_page: z.string().nullable().default(null),
});

/**
 * Dimension values are the identity of a row, so an absent one has to be a
 * STABLE token rather than an omitted key: dropping a dimension from one pull
 * and including it as null on the next would mint two keys for one row and
 * double-count it.
 */
function dimension(value: string | null): string {
  return value ?? "";
}

/**
 * The dimension values as one `:`-delimited string, each value encoded first.
 *
 * `line_item` is free text the provider writes and can contain the delimiter.
 * Joined raw, two distinct rows can produce the identical string and collapse
 * onto one `source_event_id`, which is the OCSF sink's dedup key. Encoding
 * first makes the separator unambiguous. The restatement key is unaffected —
 * it hashes the map through `JSON.stringify`, which escapes rather than
 * concatenates — this is about the readable identity that rides beside it.
 */
function dimensionPath(dimensions: Record<string, string>): string {
  return Object.values(dimensions).map(encodeURIComponent).join(":");
}

/** ISO instant for a bucket's epoch-seconds start. */
function bucketStartIso(startTime: number): string {
  return new Date(startTime * 1000).toISOString();
}

/**
 * The request URL for one page. Everything here except `page` is what
 * `queryIdentity` binds the cursor to — change one, change both.
 *
 * `end_time` is deliberately absent. It is optional, and a window whose end
 * moves with the clock would invalidate every page token the moment the run
 * asked for the next page.
 */
function reportUrl({
  startingAt,
  page,
  hasKeyGrouping,
}: {
  startingAt: string;
  page: string | null;
  hasKeyGrouping: boolean;
}): URL {
  const url = new URL(`${API_BASE}/costs`);
  const startMs = Date.parse(startingAt);
  if (Number.isNaN(startMs)) {
    throw new Error(
      `openai admin puller cannot read a window start of "${startingAt}"`,
    );
  }
  url.searchParams.set("start_time", String(Math.floor(startMs / 1000)));
  url.searchParams.set("bucket_width", COST_REPORT_BUCKET_WIDTH);
  url.searchParams.set("limit", String(PAGE_LIMIT));
  for (const dim of hasKeyGrouping
    ? COST_GROUP_BY
    : COST_GROUP_BY_WITHOUT_KEY) {
    url.searchParams.append("group_by[]", dim);
  }
  if (page) url.searchParams.set("page", page);
  return url;
}

export class OpenAiAdminPuller implements PullerAdapter<OpenAiAdminPullConfig> {
  readonly id: string = OPENAI_ADMIN_ADAPTER_ID;

  validateConfig(config: unknown): OpenAiAdminPullConfig {
    return openaiAdminPullConfigSchema.parse(config);
  }

  async runOnce(
    options: PullRunOptions,
    config: OpenAiAdminPullConfig,
  ): Promise<PullResult> {
    const events: NormalizedPullEvent[] = [];
    const cursor = parseCursor({ cursor: options.cursor, config });
    // The window start does not move within a run; only the page token, the
    // watermark and the key-grouping fallback do.
    const startingAt = cursor.windowStart;
    const query = queryIdentity(config);
    let page = cursor.page;
    let watermark = cursor.watermark;
    let hasKeyGrouping = cursor.hasKeyGrouping;

    /**
     * What an unfinished run persists as its resume point. With a page token
     * in hand it must be the window the token was minted against; without one
     * it is the start this run was GIVEN, never the looked-back one — see
     * `ParsedCursor.storedStart`.
     */
    const resumeStart = () => (page === null ? cursor.storedStart : startingAt);

    for (let pageCount = 0; pageCount < MAX_PAGES_PER_RUN; pageCount += 1) {
      if (options.deadlineMs !== undefined && Date.now() > options.deadlineMs) {
        // Everything read so far is kept and the cursor says where to resume,
        // so a deadline costs latency rather than a window.
        return {
          events,
          cursor: encodeCursor({
            startingAt: resumeStart(),
            page,
            query,
            watermark,
            hasKeyGrouping,
          }),
          errorCount: 0,
        };
      }

      const read = await this.readPage({
        startingAt,
        page,
        hasKeyGrouping,
        options,
      });
      if (!read.ok) {
        // The unadvanced cursor is what makes the window get retried instead
        // of skipped. Never return a partial window as if it were complete.
        return { events, cursor: options.cursor, errorCount: 1 };
      }
      events.push(...read.events);
      hasKeyGrouping = read.hasKeyGrouping;
      watermark = laterOf(watermark, read.watermark);

      if (read.nextPage === null) {
        // Drained. The next run resumes from the newest bucket read, moved
        // back by the look-back when it starts.
        return {
          events,
          cursor: encodeCursor({
            // The stored start never moves backwards: a retracted window
            // whose newest bucket predates the stored start must not rewind
            // the source. laterOf picks the later of the two.
            startingAt:
              laterOf(watermark, cursor.storedStart) ?? cursor.storedStart,
            page: null,
            query,
            watermark: null,
            hasKeyGrouping: true,
          }),
          errorCount: 0,
        };
      }
      page = read.nextPage;
    }

    logger.warn(
      { adapter: this.id },
      "openai admin hit MAX_PAGES_PER_RUN; the next run resumes from the cursor",
    );
    return {
      events,
      cursor: encodeCursor({
        startingAt: resumeStart(),
        page,
        query,
        watermark,
        hasKeyGrouping,
      }),
      errorCount: 0,
    };
  }

  /**
   * One page: fetched, parsed, and mapped to events.
   *
   * A transport failure is a returned `ok: false` rather than a throw, because
   * the caller has to answer it by holding the cursor still. A malformed
   * response still throws: a shape we do not recognise is not a window to
   * retry, it is a contract that moved.
   */
  private async readPage({
    startingAt,
    page,
    hasKeyGrouping,
    options,
  }: {
    startingAt: string;
    page: string | null;
    hasKeyGrouping: boolean;
    options: PullRunOptions;
  }): Promise<
    | {
        ok: true;
        events: NormalizedPullEvent[];
        nextPage: string | null;
        watermark: string | null;
        hasKeyGrouping: boolean;
      }
    | { ok: false }
  > {
    let fetched: { body: unknown; hasKeyGrouping: boolean } | null;
    try {
      fetched = await this.fetchWithKeyGroupingFallback({
        startingAt,
        page,
        hasKeyGrouping,
        options,
      });
    } catch (error) {
      logger.error(
        {
          adapter: this.id,
          error: error instanceof Error ? error.message : String(error),
        },
        "openai admin fetch failed; leaving the cursor where it was",
      );
      return { ok: false };
    }
    if (fetched === null) return { ok: false };
    const usedKeyGrouping = fetched.hasKeyGrouping;

    const parsed = pageSchema.parse(fetched.body);
    // `has_more` with no token to follow it is a contract violation, and the
    // one shape that must NOT be treated as drained. Reading it as drained
    // would advance the watermark past pages never fetched and the next run
    // would start after them — silent loss of a window's spend, with nothing
    // reporting a failure.
    if (parsed.has_more && parsed.next_page === null) {
      throw new Error(
        "openai cost report reported has_more with no next_page; advancing the watermark here would drop the rest of the window",
      );
    }

    const events = parsed.data.flatMap((bucket) =>
      this.bucketEvents({ bucket, hasKeyGrouping: usedKeyGrouping }),
    );
    // The LATEST bucket on the page rather than the last one in the array.
    // Buckets are observed to arrive strictly ascending, but taking the max
    // means that observation never has to hold: a page returned in another
    // order cannot rewind the source.
    const newest = parsed.data.reduce<string | null>(
      (acc, bucket) => laterOf(acc, bucketStartIso(bucket.start_time)),
      null,
    );
    return {
      ok: true,
      events,
      nextPage: parsed.next_page,
      watermark: newest,
      hasKeyGrouping: usedKeyGrouping,
    };
  }

  /**
   * One page's body, and the group-by it was actually read with. Null when the
   * provider refused and there is nothing left to try.
   *
   * The fallback only fires at the head of a window. Mid-window the page token
   * is already bound to the group-by that minted it, so re-asking the same
   * token with one dimension fewer would be refused for a different reason.
   */
  private async fetchWithKeyGroupingFallback({
    startingAt,
    page,
    hasKeyGrouping,
    options,
  }: {
    startingAt: string;
    page: string | null;
    hasKeyGrouping: boolean;
    options: PullRunOptions;
  }): Promise<{ body: unknown; hasKeyGrouping: boolean } | null> {
    const first = await this.fetchPage({
      startingAt,
      page,
      hasKeyGrouping,
      options,
    });
    if (first.ok) return { body: first.body, hasKeyGrouping };
    if (!hasKeyGrouping || page !== null) return null;

    logger.warn(
      { adapter: this.id, startingAt },
      "openai refuses api_key_id before its floor date; falling back to user_id only so the person on each row survives",
    );
    const retried = await this.fetchPage({
      startingAt,
      page,
      hasKeyGrouping: false,
      options,
    });
    return retried.ok ? { body: retried.body, hasKeyGrouping: false } : null;
  }

  /**
   * One request. A 400 that is the provider's key-grouping refusal comes back
   * as `ok: false` for the caller to retry without that dimension; every other
   * non-OK status throws.
   */
  private async fetchPage({
    startingAt,
    page,
    hasKeyGrouping,
    options,
  }: {
    startingAt: string;
    page: string | null;
    hasKeyGrouping: boolean;
    options: PullRunOptions;
  }): Promise<{ ok: true; body: unknown } | { ok: false }> {
    const apiKey = options.credentials?.token;
    if (!apiKey) {
      throw new Error(
        "openai admin puller requires an admin API key in credentials.token",
      );
    }

    const url = reportUrl({ startingAt, page, hasKeyGrouping });
    const signal = options.signal
      ? AbortSignal.any([
          options.signal,
          AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        ])
      : AbortSignal.timeout(REQUEST_TIMEOUT_MS);

    const response = await ssrfSafeFetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal,
    });
    if (!response.ok) {
      const detail = await safeResponseText(response);
      if (response.status === 400 && isKeyGroupingRefusal(detail)) {
        return { ok: false };
      }
      // The body can echo the request but never the credential — the key rides
      // in a header the provider does not reflect.
      throw new Error(
        `HTTP ${response.status} (openai cost report)${detail ? `: ${detail}` : ""}`,
      );
    }
    return { ok: true, body: await response.json() };
  }

  /**
   * One bucket's group-by rows, each as its own priced usage event.
   *
   * A bucket with no rows produces no events, which is the whole of ADR-122
   * Decision 5: a read that learned no cost must write no cost. Emitting a
   * zero here would win `argMax` against a confirmed figure and erase it,
   * because the restatement key excludes cost by design.
   */
  private bucketEvents({
    bucket,
    hasKeyGrouping,
  }: {
    bucket: z.infer<typeof bucketSchema>;
    hasKeyGrouping: boolean;
  }): NormalizedPullEvent[] {
    const startingAt = bucketStartIso(bucket.start_time);
    return bucket.results.flatMap((result) => {
      const parsed = costResultSchema.safeParse(result);
      if (!parsed.success) {
        logger.error(
          { adapter: this.id, startingAt },
          "openai cost row does not match the expected shape; skipping the row",
        );
        return [];
      }
      const event = this.costEvent({
        result: parsed.data,
        startingAt,
        hasKeyGrouping,
      });
      return event ? [event] : [];
    });
  }

  private costEvent({
    result,
    startingAt,
    hasKeyGrouping,
  }: {
    result: z.infer<typeof costResultSchema>;
    startingAt: string;
    hasKeyGrouping: boolean;
  }): NormalizedPullEvent | null {
    const dimensions: Record<string, string> = {
      report: "cost",
      bucketWidth: COST_REPORT_BUCKET_WIDTH,
      projectId: dimension(result.project_id),
      lineItem: dimension(result.line_item),
      userId: dimension(result.user_id),
      // Present only when the window was read with the key dimension. Below
      // the provider's floor the coordinate is absent rather than empty: a
      // stable "" would be a claim about a key, and the map for a given bucket
      // is read one way or the other, never both.
      ...(hasKeyGrouping ? { apiKeyId: dimension(result.api_key_id) } : {}),
    };

    if (result.amount.currency.toLowerCase() !== "usd") {
      // The ledger is nano-USD. Converting would need a rate and a date, and
      // inventing either is how a wrong number becomes a confident one.
      // Dropping the row rather than throwing is the blast-radius call: a
      // throw unwinds the run, discards every event already read, and the row
      // would be non-USD on every retry — one row would wedge the source.
      logger.error(
        { adapter: this.id, currency: result.amount.currency, startingAt },
        "openai cost row is not in USD; skipping the row",
      );
      return null;
    }

    // The provider's own dollars, verbatim. NOT cents: the Anthropic sibling
    // shifts a decimal here and porting that reports 100x the real spend.
    const amountUsd = result.amount.value;

    return {
      source_event_id: `cost:${startingAt}:${dimensionPath(dimensions)}`,
      event_timestamp: startingAt,
      // The provider names the person on every row, so no directory is asked.
      actor: dimension(result.user_email),
      action: "cost_report",
      target: dimension(result.line_item),
      cost_usd: amountUsd,
      tokens_input: 0,
      tokens_output: 0,
      raw_payload: JSON.stringify(result),
      extra: {
        // Raw provider ids, resolved never (ADR-088 Decision 13). The worker
        // spreads `extra` into the audit row's metadata extension, which is
        // where the shipped Genie attribution puts the same thing — so this
        // needs no change to the published event contract.
        actorUserId: dimension(result.user_id),
        apiKeyId: dimension(result.api_key_id),
        [PULLED_USAGE_HINT_KEY]: {
          costBasis: "provider_reported",
          // The provider's figure, but not the invoice: nothing establishes
          // that this report equals the bill, and the provider's own usage
          // surface already disagrees with it.
          costStatus: "estimate",
          costUsd: amountUsd,
          dimensions,
          model: dimension(result.line_item),
        },
      },
    };
  }
}

function encodeCursor({
  startingAt,
  page,
  query,
  watermark,
  hasKeyGrouping,
}: Omit<z.infer<typeof cursorSchema>, "query"> & { query: string }): string {
  return JSON.stringify({ startingAt, page, query, watermark, hasKeyGrouping });
}

/** The later of two ISO instants, tolerating nulls and unparseable input. */
function laterOf(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  const aMs = Date.parse(a);
  const bMs = Date.parse(b);
  if (Number.isNaN(aMs)) return b;
  if (Number.isNaN(bMs)) return a;
  return bMs > aMs ? b : a;
}
