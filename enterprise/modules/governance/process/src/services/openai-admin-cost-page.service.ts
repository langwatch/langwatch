// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  OPENAI_ADMIN_ADAPTER_ID,
  type NormalizedPullEvent,
  type PullRunOptions,
} from "@langwatch/enterprise-governance-contract";
import { DispatchError, parseRetryAfterMs } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type { z } from "zod";

import type {
  GovernanceHttpClient,
  GovernanceHttpResponse,
} from "../channels/governance-http.channel.ts";
import * as AdminUsageReportAdapter from "../rules/admin-usage-report.rules.ts";
import {
  type bucketSchema,
  bucketStartIso,
  costResultSchema,
  isKeyGroupingRefusal,
  laterOf,
  type PageRead,
  pageSchema,
  reportUrl,
  usdCostEvent,
} from "../rules/openai-admin-cost-report.rules.ts";

const logger = createLogger("langwatch:governance:openai-admin-puller");

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * The error a provider's refusal carries, or null when the status is not one.
 *
 * Two refusals, and the difference between them is the whole of what the
 * caller does next. A rate limit is the provider asking for time: retryable,
 * and it carries the wait it asked for. A refused key is the provider
 * answering about this source: the same answer on every page and every
 * retry, so it is NOT retryable — which is what stops the ladder and keeps a
 * run from banking half a window it will never be allowed to finish.
 *
 * The body is drained best-effort and never read. A rejected `cancel()` must
 * not escape in place of the error built here, or the refusal degrades to a
 * generic failure and the wait never reaches the scheduler; and a refusal
 * from this endpoint can echo a fragment of the key, so nothing it says is
 * quoted.
 */
async function detectProviderRefusal(
  response: GovernanceHttpResponse,
): Promise<DispatchError | null> {
  if (response.status !== 429 && response.status !== 401 && response.status !== 403) return null;
  await response.body?.cancel().catch(() => void 0);
  if (response.status === 429) {
    return new DispatchError({
      message: "OpenAI rate limit exceeded (HTTP 429).",
      retryable: true,
      retryAfterMs: parseRetryAfterMs(response.headers?.get("retry-after") ?? null),
    });
  }
  return new DispatchError({
    message: `HTTP ${response.status} (openai cost report): key refused`,
    retryable: false,
    customerMessage: "OpenAI refused this key. Check the admin key and its permissions.",
  });
}

/**
 * A non-OK response that is not one of the refusals `detectProviderRefusal` names,
 * carrying the status so the banking rule can tell an answer about the
 * request from a provider having a bad minute.
 *
 * The status is what a plain `Error` lost. Reconstructing it from the message
 * would be reading our own prose back, so it rides the error instead.
 */
class UnexpectedStatusError extends Error {
  readonly status: number;

  constructor({ status, message }: { status: number; message: string }) {
    super(message);
    this.name = "UnexpectedStatusError";
    this.status = status;
  }
}

/**
 * Whether a status is the provider answering about THIS REQUEST rather than
 * about the minute it is having.
 *
 * A 4xx is an answer: the same request earns the same answer on every page
 * and every retry, so there is no window to resume. 408 and 425 ask to be
 * sent again, which makes them bad minutes like a 5xx. 429, 401 and 403 never
 * reach here — `detectProviderRefusal` names them first, because a rate limit
 * carries a wait worth keeping.
 */
function isRequestRefused(status: number): boolean {
  if (status === 408 || status === 425) return false;
  return status >= 400 && status < 500;
}

/**
 * Whether a page refused mid-run should be ANSWERED with the progress already
 * made, rather than thrown out of the run.
 *
 * A provider asking to be left alone (HTTP 429) arrives as a throw so the
 * durable outbox keeps its `Retry-After`. On the FIRST page of a run that
 * wait is the most valuable thing the run has and there is no progress to
 * lose, so it keeps travelling. Once earlier pages have been read the trade
 * inverts: holding the cursor still ended the run with no forward progress at
 * all, so the next run asked for page one of the same window, was refused at
 * the same page again, and a source that met a rate limit mid-backfill could
 * never get past it on any number of retries. Buckets banked twice are
 * restated, which the pipeline already handles; a window that can never be
 * read past is not recoverable at all.
 *
 * A NON-RETRYABLE refusal never qualifies. A key the provider refuses (HTTP
 * 401 or 403) answers the same way on every page, so there is no window to
 * resume and nothing to gain by keeping part of one: it still throws, and the
 * run is recorded as the refusal it is. A malformed body throws from the
 * parse below for the same reason — a shape we do not recognise is a
 * contract that moved.
 *
 * Everything else with pages in hand banks: a rate limit, a dropped socket, a
 * provider having a bad minute (5xx). Each is transient and carries no answer
 * about this source, so the pages already read are worth more than starting
 * the window over.
 *
 * A 4xx this adapter does not classify by name — a 400 that is not the
 * key-breakdown cutoff, a 404, a 422 — is an answer about the REQUEST, so it
 * is not banked either. It reaches here as an `UnexpectedStatusError`
 * carrying the status, because a plain error told the rule only that it was
 * not a `DispatchError` and a 404 then banked as readily as a 503: the cursor
 * advanced onto a page nothing will ever read past. 408 and 425 are the two
 * 4xx that ask to be sent again, so they count as bad minutes rather than
 * answers.
 *
 * Refusing to bank is NOT the same as failing the run here. What is thrown is
 * unchanged, so a rejected request still ends the run the way it always did —
 * the events read so far, the cursor where it was, the failure reported —
 * and the next run asks for the same window rather than for a page it cannot
 * get past.
 *
 * Banking is never the same as succeeding. The result carries `unreadPage`,
 * so the run status counts the failure while keeping the progress — without
 * it a source refused on every run would read as healthy forever.
 */
function mustBankRefusal({ error, pageCount }: { error: unknown; pageCount: number }): boolean {
  if (pageCount === 0) return false;
  // A provider refusing outright is not a window to retry. Let that one
  // travel, so the run is recorded as the refusal it is.
  if (error instanceof DispatchError) return error.retryable;
  if (error instanceof UnexpectedStatusError) return !isRequestRefused(error.status);
  return true;
}

/**
 * The line a page nobody could read leaves behind, which says what it cost: a
 * window held for a retry, or a window banked up to the page that failed.
 */
function logPageUnread({
  adapter,
  pageCount,
  hasBankedProgress,
  error,
}: {
  adapter: string;
  pageCount: number;
  hasBankedProgress: boolean;
  error: unknown;
}): void {
  logger.error(
    {
      adapter,
      pageCount,
      error: error instanceof Error ? error.message : String(error),
    },
    hasBankedProgress
      ? "openai admin page refused mid-window; keeping the pages already read and resuming at the refused one"
      : "openai admin fetch failed; leaving the cursor where it was",
  );
}

/** One page of the OpenAI Admin cost report, fetched over the vendor's HTTP and mapped to events. */
export class OpenAiAdminCostPageService {
  private constructor(private readonly http: GovernanceHttpClient) {}

  static create(http: GovernanceHttpClient): OpenAiAdminCostPageService {
    return new OpenAiAdminCostPageService(http);
  }

  /**
   * One page: fetched, parsed, and mapped to events.
   *
   * A transport failure is a returned `ok: false` rather than a throw, because
   * the caller has to answer it by deciding what the window is worth — which
   * is why the failure carries `hasBankedProgress`. A malformed response
   * still throws: a shape we do not recognise is not a window to retry, it is
   * a contract that moved.
   */
  async readPage({
    startingAt,
    page,
    hasKeyGrouping,
    options,
    pageCount,
  }: {
    startingAt: string;
    page: string | null;
    hasKeyGrouping: boolean;
    options: PullRunOptions;
    /** Pages this run has already read. Decides what a refusal costs. */
    pageCount: number;
  }): Promise<PageRead> {
    let fetched: { body: unknown; hasKeyGrouping: boolean } | null;
    try {
      fetched = await this.fetchWithKeyGroupingFallback({
        startingAt,
        page,
        hasKeyGrouping,
        options,
      });
    } catch (error) {
      const hasBankedProgress = mustBankRefusal({ error, pageCount });
      // Let the durable outbox retain Retry-After instead of losing it in
      // errorCount — unless the pages already read are worth more than the
      // wait.
      if (!hasBankedProgress && error instanceof DispatchError) throw error;
      logPageUnread({ adapter: OPENAI_ADMIN_ADAPTER_ID, pageCount, hasBankedProgress, error });
      return { ok: false, hasBankedProgress };
    }
    if (fetched === null) return { ok: false, hasBankedProgress: pageCount > 0 };
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
      { adapter: OPENAI_ADMIN_ADAPTER_ID, startingAt },
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
      throw new Error("openai admin puller requires an admin API key in credentials.token");
    }

    const url = reportUrl({ startingAt, page, hasKeyGrouping });
    const signal = options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
      : AbortSignal.timeout(REQUEST_TIMEOUT_MS);

    const response = await this.http.fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal,
      followRedirects: false,
    });
    // A rate limit or a refused key, classified the way the Anthropic puller
    // classifies the same two statuses. Both leave as a DispatchError so the
    // caller can tell a window worth resuming from a key that will never be
    // allowed to finish one.
    const refusal = await detectProviderRefusal(response);
    if (refusal) throw refusal;
    if (!response.ok) {
      const detail = await AdminUsageReportAdapter.safeResponseText(response);
      if (response.status === 400 && isKeyGroupingRefusal(detail)) {
        return { ok: false };
      }
      // The body can echo the request but never the credential — the key rides
      // in a header the provider does not reflect.
      throw new UnexpectedStatusError({
        status: response.status,
        message: `HTTP ${response.status} (openai cost report)${detail ? `: ${detail}` : ""}`,
      });
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
          { adapter: OPENAI_ADMIN_ADAPTER_ID, startingAt },
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
    if (result.amount.currency.toLowerCase() !== "usd") {
      // The ledger is nano-USD. Converting would need a rate and a date, and
      // inventing either is how a wrong number becomes a confident one.
      // Dropping the row rather than throwing is the blast-radius call: a
      // throw unwinds the run, discards every event already read, and the row
      // would be non-USD on every retry — one row would wedge the source.
      logger.error(
        { adapter: OPENAI_ADMIN_ADAPTER_ID, currency: result.amount.currency, startingAt },
        "openai cost row is not in USD; skipping the row",
      );
      return null;
    }

    return usdCostEvent({ result, startingAt, hasKeyGrouping });
  }
}
