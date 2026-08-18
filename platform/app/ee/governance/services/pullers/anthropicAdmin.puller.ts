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
 *   cost_report           — the amount Anthropic will invoice, per bucket,
 *                           as a decimal string. Carried verbatim, so every
 *                           record is `provider_reported` / `exact`.
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
 */
const cursorSchema = z.object({
  startingAt: z.string(),
  page: z.string().nullable().default(null),
});

function parseCursor(
  cursor: string | null,
  config: AnthropicAdminPullConfig,
): z.infer<typeof cursorSchema> {
  if (cursor) {
    try {
      return cursorSchema.parse(JSON.parse(cursor));
    } catch {
      logger.warn(
        { cursor },
        "unreadable anthropic admin cursor; restarting from the configured watermark",
      );
    }
  }
  return {
    startingAt: config.startingAt ?? defaultStartingAt(config.report),
    page: null,
  };
}

function encodeCursor(startingAt: string, page: string | null): string {
  return JSON.stringify({ startingAt, page });
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

/** One group-by row inside a usage bucket. Unknown fields are tolerated. */
const usageResultSchema = z
  .object({
    uncached_input_tokens: z.number().nonnegative().default(0),
    cache_creation_input_tokens: z.number().nonnegative().default(0),
    cache_read_input_tokens: z.number().nonnegative().default(0),
    output_tokens: z.number().nonnegative().default(0),
    model: z.string().nullable().default(null),
    workspace_id: z.string().nullable().default(null),
    api_key_id: z.string().nullable().default(null),
    service_tier: z.string().nullable().default(null),
  })
  .passthrough();

/** One group-by row inside a cost bucket. `amount` is a decimal string. */
const costResultSchema = z
  .object({
    amount: z.union([z.string(), z.number()]),
    currency: z.string().default("USD"),
    workspace_id: z.string().nullable().default(null),
    description: z.string().nullable().default(null),
    cost_type: z.string().nullable().default(null),
    model: z.string().nullable().default(null),
  })
  .passthrough();

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
    // The window's watermark does not move within a run; only the page token
    // does. Two variables rather than one reassigned object, so a page advance
    // mid-run can never quietly carry a different `startingAt` with it.
    const cursor = parseCursor(options.cursor, config);
    const startingAt = cursor.startingAt;
    let page = cursor.page;

    for (let pageCount = 0; pageCount < MAX_PAGES_PER_RUN; pageCount += 1) {
      if (options.deadlineMs !== undefined && Date.now() > options.deadlineMs) {
        // Everything read so far is kept and the cursor says where to resume,
        // so a deadline costs latency rather than a window.
        return {
          events,
          cursor: encodeCursor(startingAt, page),
          errorCount: 0,
        };
      }

      const read = await this.readPage({ config, startingAt, page, options });
      if (!read.ok) {
        // The unadvanced cursor is what makes the window get retried instead
        // of skipped. Never return a partial window as if it were complete.
        return { events, cursor: options.cursor, errorCount: 1 };
      }
      events.push(...read.events);

      if (read.nextPage === null) {
        // Drained. The next run starts from the newest bucket read, so the
        // watermark only ever moves forward.
        return {
          events,
          cursor: encodeCursor(read.watermark ?? startingAt, null),
          errorCount: 0,
        };
      }
      page = read.nextPage;
    }

    logger.warn(
      { adapter: this.id, report: config.report },
      "anthropic admin hit MAX_PAGES_PER_RUN; the next run resumes from the cursor",
    );
    return { events, cursor: encodeCursor(startingAt, page), errorCount: 0 };
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
    return {
      ok: true,
      events,
      nextPage: parsed.next_page,
      watermark: parsed.data.at(-1)?.starting_at ?? null,
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

    const url = new URL(
      config.report === "usage"
        ? `${API_BASE}/usage_report/messages`
        : `${API_BASE}/cost_report`,
    );
    url.searchParams.set("starting_at", startingAt);
    if (config.report === "usage") {
      url.searchParams.set("bucket_width", config.bucketWidth);
      for (const dim of ["model", "workspace_id", "api_key_id"]) {
        url.searchParams.append("group_by[]", dim);
      }
    } else {
      // The cost report is daily-only, so the width is pinned here rather than
      // taken from config. It has to match `COST_REPORT_BUCKET_WIDTH`, which
      // rides the restatement key: a width that could vary with config would
      // re-key unchanged cost buckets the moment an operator edited it, and
      // the same spend would be recorded twice.
      url.searchParams.set("bucket_width", COST_REPORT_BUCKET_WIDTH);
      url.searchParams.append("group_by[]", "workspace_id");
      url.searchParams.append("group_by[]", "description");
    }
    if (page) url.searchParams.set("page", page);

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
    });
    if (!response.ok) {
      // Read the body so the actual API error message reaches the logs —
      // HTTP/2 has no statusText, and without this the 400 is opaque.
      let detail = "";
      try {
        detail = await response.text();
      } catch {
        // Best-effort; some responses have no body.
      }
      throw new Error(
        `HTTP ${response.status} (anthropic ${config.report}_report)${detail ? `: ${detail}` : ""}`,
      );
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
    };
    return {
      source_event_id: `usage:${startingAt}:${dimensionPath(dimensions)}`,
      event_timestamp: startingAt,
      actor: "",
      action: "usage_report",
      target: dimension(result.model),
      // Anthropic reports no cost on this report; we price the quantities.
      cost_usd: 0,
      tokens_input: result.uncached_input_tokens,
      tokens_output: result.output_tokens,
      raw_payload: JSON.stringify(result),
      extra: {
        [PULLED_USAGE_HINT_KEY]: {
          costBasis: "computed",
          dimensions,
          model: dimension(result.model),
          tokensCacheRead: result.cache_read_input_tokens,
          tokensCacheWrite: result.cache_creation_input_tokens,
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
    const amount = String(result.amount);
    return {
      source_event_id: `cost:${startingAt}:${dimensionPath(dimensions)}`,
      event_timestamp: startingAt,
      actor: "",
      action: "cost_report",
      target: dimension(result.model),
      // Kept as a number for the canonical shape; the exact string rides the
      // hint below, and that is the one the record is priced from.
      cost_usd: Number(amount),
      tokens_input: 0,
      tokens_output: 0,
      raw_payload: JSON.stringify(result),
      extra: {
        [PULLED_USAGE_HINT_KEY]: {
          costBasis: "provider_reported",
          // Anthropic's cost report IS the invoiced figure.
          costStatus: "exact",
          costUsd: amount,
          dimensions,
          model: dimension(result.model),
        },
      },
    };
  }
}
