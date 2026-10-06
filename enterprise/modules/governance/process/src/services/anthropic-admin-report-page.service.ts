// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  ANTHROPIC_ADMIN_ADAPTER_ID,
  PULLED_USAGE_HINT_KEY,
  type AnthropicAdminPullConfig,
  type NormalizedPullEvent,
  type PullRunOptions,
} from "@langwatch/enterprise-governance-contract";
import { DispatchError, parseRetryAfterMs } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { toEpochMs } from "@langwatch/time";
import type { z } from "zod";

import type { GovernanceHttpClient } from "../channels/governance-http.channel.ts";
import * as AdminUsageReportAdapter from "../rules/admin-usage-report.rules.ts";
import {
  assertRowsAreDistinguishable,
  type bucketSchema,
  COST_REPORT_BUCKET_WIDTH,
  costResultSchema,
  pageSchema,
  reportUrl,
  usageEvent,
  usageResultSchema,
} from "../rules/anthropic-admin-report.rules.ts";

const logger = createLogger("langwatch:governance:anthropic-admin-puller");

const ANTHROPIC_VERSION = "2023-06-01";
const REQUEST_TIMEOUT_MS = 30_000;

/** One page of an Anthropic Admin API report, fetched over the vendor's HTTP and mapped to events. */
export class AnthropicAdminReportPageService {
  private constructor(private readonly http: GovernanceHttpClient) {}

  static create(http: GovernanceHttpClient): AnthropicAdminReportPageService {
    return new AnthropicAdminReportPageService(http);
  }

  /**
   * One page: fetched, parsed, and mapped to events.
   *
   * A transport failure is a returned `ok: false` rather than a throw, because
   * the caller has to answer it by holding the cursor still. A malformed
   * response is NOT caught here and still throws: a shape we do not recognise
   * is not a window to retry, it is a contract that moved.
   */
  async readPage({
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
          adapter: ANTHROPIC_ADMIN_ADAPTER_ID,
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
    const events = parsed.data.flatMap((bucket) => this.bucketEvents({ bucket, config }));
    // Same class of refusal as the `has_more` check above: not a window to
    // retry, a shape whose rows we cannot store without losing one of them.
    assertRowsAreDistinguishable({ events, report: config.report });
    return {
      ok: true,
      events,
      nextPage: parsed.next_page,
      watermark: AnthropicAdminReportPageService.newestBucketStart(parsed.data),
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
      throw new Error("anthropic admin puller requires an admin API key in credentials.token");
    }

    const url = reportUrl({ config, startingAt, page });
    const signal = options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
      : AbortSignal.timeout(REQUEST_TIMEOUT_MS);

    const response = await this.http.fetch(url.toString(), {
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
        retryAfterMs: parseRetryAfterMs(response.headers?.get("retry-after") ?? null),
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
        customerMessage: "Anthropic refused this key. Check the admin key and its permissions.",
      });
    }
    if (!response.ok) {
      throw await AnthropicAdminReportPageService.fetchPageError(response, config.report);
    }
    return response.json();
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
          ? usageEvent({
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
      workspaceId: AdminUsageReportAdapter.dimension(result.workspace_id),
      description: AdminUsageReportAdapter.dimension(result.description),
      costType: AdminUsageReportAdapter.dimension(result.cost_type),
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
        { adapter: ANTHROPIC_ADMIN_ADAPTER_ID, currency: result.currency, startingAt },
        "anthropic cost report row is not USD; skipping the row",
      );
      return null;
    }
    const amountUsd = AnthropicAdminReportPageService.centsToUsd(result.amount);
    if (amountUsd === null) {
      // Same reasoning as the non-USD skip above: one permanently malformed
      // row must cost one row, not the whole source. No raw amount in the
      // log — dimensions identify the row without echoing unparseable input.
      logger.error(
        { adapter: ANTHROPIC_ADMIN_ADAPTER_ID, startingAt, dimensions },
        "anthropic cost report amount is not a decimal; skipping the row",
      );
      return null;
    }
    return {
      source_event_id: `cost:${startingAt}:${AdminUsageReportAdapter.dimensionPath(dimensions)}`,
      event_timestamp: startingAt,
      // Empty on purpose, not an oversight — and unlike the OpenAI sibling,
      // which does name a person and fills this in. `COST_GROUP_BY` above is
      // the endpoint's whole set: workspace and description. The report carries
      // no user dimension at all, so there is nobody on the row to name and
      // person discovery correctly discovers nobody from Anthropic spend.
      actor: "",
      action: "cost_report",
      target: AdminUsageReportAdapter.dimension(result.model),
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
          model: AdminUsageReportAdapter.dimension(result.model),
        },
      },
    };
  }

  private static async fetchPageError(
    response: { status: number; text(): Promise<string> },
    report: string,
  ): Promise<Error> {
    const detail = await AdminUsageReportAdapter.safeResponseText(response);
    const suffix = detail ? `: ${detail}` : "";
    return new Error(`HTTP ${response.status} (anthropic ${report}_report)${suffix}`);
  }

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
  private static centsToUsd(amount: string): string | null {
    const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(amount.trim());
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
      return `${sign}${wholeRaw}${fraction ? `.${fraction}` : ""}e${exponentValue - 2}`;
    }
    // Three digits guarantee a whole part survives the two-digit shift.
    const whole = wholeRaw.padStart(3, "0");
    return `${sign}${whole.slice(0, -2)}.${whole.slice(-2)}${fraction}`;
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
  private static newestBucketStart(buckets: z.infer<typeof bucketSchema>[]): string | null {
    let newest: string | null = null;
    let newestMs = Number.NEGATIVE_INFINITY;
    for (const bucket of buckets) {
      const ms = toEpochMs(bucket.starting_at);
      if (Number.isNaN(ms) || ms <= newestMs) continue;
      newest = bucket.starting_at;
      newestMs = ms;
    }
    return newest;
  }
}
