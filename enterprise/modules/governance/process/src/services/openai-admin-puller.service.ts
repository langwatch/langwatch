// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * OpenAI Admin puller — organization spend, attributed to the person and
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

import {
  OPENAI_ADMIN_ADAPTER_ID,
  openaiAdminPullConfigSchema,
  type OpenAiAdminPullConfig,
  type GovernancePuller as PullerAdapter,
  type NormalizedPullEvent,
  type PullResult,
  type PullRunOptions,
} from "@langwatch/enterprise-governance-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant, toEpochMs } from "@langwatch/time";
import type { z } from "zod";

import type { GovernanceHttpClient } from "../channels/governance-http.channel.ts";
import {
  cursorSchema,
  defaultStartingAt,
  drainedResult,
  laterOf,
  pageUnread,
  type ParsedCursor,
  queryIdentity,
  stoppedShortResult,
  windowStartFor,
} from "../rules/openai-admin-cost-report.rules.ts";
import { OpenAiAdminCostPageService } from "./openai-admin-cost-page.service.ts";

const logger = createLogger("langwatch:governance:openai-admin-puller");

/** A run stops here rather than paginating forever; the cursor carries the
 *  rest into the next one. The bound is 20 pages of what the provider actually
 *  returns, and for daily cost buckets that is 31 a page, not the 180 this
 *  adapter asks for (see `PAGE_LIMIT`) — so a run reaches about 620 days,
 *  under two years. Reading the bound off the requested limit overstates it
 *  nearly six-fold as a decade. A backfill deeper than 620 days therefore
 *  takes several runs to walk; the cursor makes that safe, but an operator
 *  sizing a first backfill should expect it. */
const MAX_PAGES_PER_RUN = 20;

export class OpenAiAdminPullerService implements PullerAdapter<OpenAiAdminPullConfig> {
  readonly id: string = OPENAI_ADMIN_ADAPTER_ID;

  private readonly pages: OpenAiAdminCostPageService;

  private constructor(http: GovernanceHttpClient) {
    this.pages = OpenAiAdminCostPageService.create(http);
  }

  static create(http: GovernanceHttpClient): OpenAiAdminPullerService {
    return new OpenAiAdminPullerService(http);
  }

  validateConfig(config: unknown): OpenAiAdminPullConfig {
    return openaiAdminPullConfigSchema.parse(config);
  }

  async runOnce(options: PullRunOptions, config: OpenAiAdminPullConfig): Promise<PullResult> {
    const events: NormalizedPullEvent[] = [];
    const cursor = OpenAiAdminPullerService.parseCursor({ cursor: options.cursor, config });
    // The window start does not move within a run; only the page token, the
    // watermark and the key-grouping fallback do.
    const startingAt = cursor.windowStart;
    const query = queryIdentity(config);
    let page = cursor.page;
    let watermark = cursor.watermark;
    let hasKeyGrouping = cursor.hasKeyGrouping;
    // Whether any page in THIS run came back without per-key attribution (see `runNotices`).
    let hasLostKeyAttribution = false;
    // Both ways out of the loop leave the same thing behind (see `stoppedShortResult`).
    const stoppedShort = (): PullResult =>
      stoppedShortResult({
        events,
        cursor,
        page,
        query,
        watermark,
        hasKeyGrouping,
        hasLostKeyAttribution,
      });

    for (let pageCount = 0; pageCount < MAX_PAGES_PER_RUN; pageCount += 1) {
      if (options.deadlineMs !== undefined && nowInstant().epochMilliseconds > options.deadlineMs) {
        // Everything read so far is kept and the cursor says where to resume,
        // so a deadline costs latency rather than a window.
        return stoppedShort();
      }

      const read = await this.pages.readPage({
        startingAt,
        page,
        hasKeyGrouping,
        options,
        pageCount,
      });
      if (!read.ok) {
        // Resumes AT the page that failed when this run read any, and holds
        // the window for a retry when it read none. Never returns a partial
        // window as if it were complete.
        return pageUnread({
          hasBankedProgress: read.hasBankedProgress,
          events,
          stoppedShort,
          incomingCursor: options.cursor,
        });
      }
      events.push(...read.events);
      if (!read.hasKeyGrouping) hasLostKeyAttribution = true;
      hasKeyGrouping = read.hasKeyGrouping;
      if (read.watermark !== null) watermark = laterOf(watermark, read.watermark);

      if (read.nextPage === null) {
        return drainedResult({
          events,
          cursor,
          watermark,
          hasKeyGrouping,
          query,
          hasLostKeyAttribution,
        });
      }
      page = read.nextPage;
    }

    logger.warn(
      { adapter: this.id },
      "openai admin hit MAX_PAGES_PER_RUN; the next run resumes from the cursor",
    );
    // A page token still in hand means the window was not drained.
    return stoppedShort();
  }

  private static parseCursor({
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
            // gets the trailing re-read applied to it — UNLESS a key-grouping
            // upgrade is pending, in which case the lookback is skipped so the
            // first keyed window cannot overlap with user-only data.
            windowStart:
              parsed.page === null && !parsed.keyGroupingUpgrade
                ? windowStartFor({ stored: parsed.startingAt, config })
                : parsed.startingAt,
            storedStart: parsed.startingAt,
            page: parsed.page,
            watermark: parsed.watermark,
            hasKeyGrouping: parsed.hasKeyGrouping,
          };
        }
        return OpenAiAdminPullerService.staleCursorRestart({ parsed, config });
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
  private static staleCursorRestart({
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
    const storedMs = toEpochMs(parsed.startingAt);
    const rewound =
      Number.isNaN(storedMs) || toEpochMs(configuredStart) <= storedMs
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
}
