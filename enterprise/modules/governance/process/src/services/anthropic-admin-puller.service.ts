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

import {
  ANTHROPIC_ADMIN_ADAPTER_ID,
  anthropicAdminPullConfigSchema,
  type AnthropicAdminPullConfig,
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
  costRequestStart,
  cursorSchema,
  defaultStartingAt,
  drainedWindowStart,
  encodeCursor,
  laterInstant,
  type ParsedCursor,
  queryIdentity,
  unfinishedWindowStart,
} from "../rules/anthropic-admin-report.rules.ts";
import { AnthropicAdminReportPageService } from "./anthropic-admin-report-page.service.ts";

const logger = createLogger("langwatch:governance:anthropic-admin-puller");

/**
 * A run stops here rather than paginating forever. Anthropic pages a bucket
 * window, so the cap bounds one run's work; the cursor carries the rest into
 * the next one.
 */
const MAX_PAGES_PER_RUN = 20;

export class AnthropicAdminPullerService implements PullerAdapter<AnthropicAdminPullConfig> {
  readonly id: string = ANTHROPIC_ADMIN_ADAPTER_ID;

  private readonly pages: AnthropicAdminReportPageService;

  private constructor(http: GovernanceHttpClient) {
    this.pages = AnthropicAdminReportPageService.create(http);
  }

  static create(http: GovernanceHttpClient): AnthropicAdminPullerService {
    return new AnthropicAdminPullerService(http);
  }

  validateConfig(config: unknown): AnthropicAdminPullConfig {
    return anthropicAdminPullConfigSchema.parse(config);
  }

  async runOnce(options: PullRunOptions, config: AnthropicAdminPullConfig): Promise<PullResult> {
    const events: NormalizedPullEvent[] = [];
    // The window start does not move within a run; only the page token and
    // the in-window watermark do. Separate variables rather than one
    // reassigned object, so a page advance mid-run can never quietly carry a
    // different `startingAt` with it. The watermark tracks the newest bucket
    // actually emitted, so a cut-off run records how far it really got —
    // that record is what lets a later identity mismatch resume near the
    // token instead of re-reading the window (see `cursorSchema`).
    const cursor = AnthropicAdminPullerService.parseCursor({ cursor: options.cursor, config });
    const requestStart = cursor.requestStart;
    // The position ON RECORD: the floor the saved cursor may never drop below.
    const positionOnRecord = cursor.startingAt;
    const query = queryIdentity(config);
    let page = cursor.page;
    let watermark = cursor.watermark;
    // The newest bucket emitted across every page (see `drainedWindowStart`).
    let newestEmitted = cursor.watermark;

    for (let pageCount = 0; pageCount < MAX_PAGES_PER_RUN; pageCount += 1) {
      if (AnthropicAdminPullerService.hasSpentDeadline(options.deadlineMs)) {
        // Everything read so far is kept and the cursor says where to resume,
        // so a deadline costs latency rather than a window. It is still a
        // window left half-read, and saying nothing reads as complete.
        const startingAt = unfinishedWindowStart({ page, requestStart, positionOnRecord });
        return {
          events,
          cursor: encodeCursor({ startingAt, page, query, watermark }),
          errorCount: 0,
          completeness: "truncated",
        };
      }

      const read = await this.pages.readPage({ config, startingAt: requestStart, page, options });
      if (!read.ok) {
        // The unadvanced cursor is what makes the window get retried instead
        // of skipped. Never return a partial window as if it were complete.
        return { events, cursor: options.cursor, errorCount: 1 };
      }
      events.push(...read.events);
      watermark = read.watermark ?? watermark;
      if (read.watermark !== null) newestEmitted = laterInstant(newestEmitted, read.watermark);

      if (read.nextPage === null) {
        // Drained. The next run starts from the newest bucket this run
        // emitted across all of its pages, so the window start only ever
        // moves forward — and the in-window watermark is retired:
        // `startingAt` itself is now the resume point.
        const startingAt = drainedWindowStart({ newestEmitted, positionOnRecord });
        return {
          events,
          cursor: encodeCursor({ startingAt, page: null, query, watermark: null }),
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
      cursor: encodeCursor({ startingAt: requestStart, page, query, watermark }),
      errorCount: 0,
      // A page token still in hand means the window was not drained.
      completeness: "truncated",
    };
  }

  private static parseCursor({
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
                ? costRequestStart({
                    stored: parsed.startingAt,
                    config,
                  })
                : parsed.startingAt,
            page: parsed.page,
            watermark: parsed.watermark,
          };
        }
        // Also covers cursors minted before query-binding existed (`query`
        // null): this change itself widened the group_by set and fixed the
        // cents→USD conversion, so everything those cursors certify was
        // written by the old code.
        return AnthropicAdminPullerService.staleCursorRestart({ parsed, config });
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
    return { startingAt: fresh, requestStart: fresh, page: null, watermark: null };
  }

  /**
   * Where a run resumes after its cursor failed the query-identity check.
   * The split between reports is the cursorSchema doc's supersede-vs-duplicate
   * distinction: cost re-reads restate, usage re-reads double-count.
   */
  private static staleCursorRestart({
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
        (candidate) => candidate !== null && !Number.isNaN(toEpochMs(candidate)),
      );
      const usageRestart = resumeFrom ?? config.startingAt ?? defaultStartingAt(config.report);
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
    const watermarkMs = toEpochMs(parsed.startingAt);
    const rewoundStart =
      Number.isNaN(watermarkMs) || toEpochMs(configuredStart) <= watermarkMs
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

  /**
   * Whether this run has spent the time it was given.
   *
   * A run with no deadline never has: `undefined` is "run until the window
   * drains", not "stop now".
   */
  private static hasSpentDeadline(deadlineMs: number | undefined): boolean {
    return deadlineMs !== undefined && nowInstant().epochMilliseconds > deadlineMs;
  }
}
