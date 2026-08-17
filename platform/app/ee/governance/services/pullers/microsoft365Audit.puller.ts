// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createLogger } from "@langwatch/observability";
/**
 * Microsoft 365 audit puller — Copilot Studio interactions from the
 * Office 365 Management Activity API.
 *
 * Replaces `copilot_studio`, which polled `auditLogs/directoryAudits` — an
 * Entra directory-change feed that never contained a Copilot interaction.
 *
 * This implements PullerAdapter DIRECTLY rather than extending
 * HttpPollingPullerAdapter, making it a third base alongside
 * S3PollingPullerAdapter. The reason is shape, not preference: this API is
 * three calls, not one paginated URL.
 *
 *   POST .../subscriptions/start?contentType=Audit.General   (once)
 *   GET  .../subscriptions/content?startTime=&endTime=       (lists blobs)
 *   GET  {contentUri}                                        (per blob)
 *
 * An HttpPollingConfig would have a `url` field that is not the URL called
 * and a `cursorJsonPath` describing nothing. What it does share — retry and
 * token acquisition — lives in `shared/` so both bases import it rather than
 * one inheriting from the other.
 *
 * NOT the Graph audit-query API: that was demoted from v1.0 back to beta and
 * the same completed query paginated twice inside ten minutes has returned
 * materially different record counts. Duplicates are harmless here (the
 * dedup key is content-derived, see pullerWorker.ts:283) but skips are not,
 * and a short feed is indistinguishable from a quiet one.
 *
 * Spec: specs/ai-governance/puller-framework/microsoft-365-audit.feature
 */
import { z } from "zod";

import type {
  NormalizedPullEvent,
  PullerAdapter,
  PullResult,
  PullRunOptions,
} from "./pullerAdapter";
import { fetchWithRetry, RetryDeadlineExceededError } from "./shared/httpRetry";
import {
  decodeCursor,
  encodeCursor,
  MAX_QUEUED_BLOBS,
  type Microsoft365AuditCursor,
} from "./shared/microsoft365AuditCursor";
import {
  createTokenProvider,
  type TokenProvider,
} from "./shared/oauthClientCredentials";

const logger = createLogger("langwatch:puller:microsoft_365_audit");

/** Copilot interaction records. Everything else in Audit.General is noise here. */
export const COPILOT_INTERACTION_RECORD_TYPE = 261;

export const MANAGEMENT_API_BASE = "https://manage.office.com/api/v1.0";
export const MANAGEMENT_API_SCOPE = "https://manage.office.com/.default";

/**
 * How far back a first-ever run reaches. The API does not backfill beyond
 * its own retention, and a subscription only publishes content from the
 * moment it starts, so this is a ceiling rather than a promise.
 */
export const INITIAL_LOOKBACK_MS = 60 * 60 * 1000;

/** Longest window a single listing covers. */
export const MAX_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Safety cap so a misconfigured listing cursor cannot page forever. */
export const MAX_LISTING_PAGES_PER_RUN = 50;

/**
 * Cap on list→drain rounds in one run. A full blob queue or the page cap
 * defers part of a listing, so a run may legitimately go round several times.
 * This bounds it without relying on `deadlineMs`, which is optional.
 */
export const MAX_LIST_DRAIN_ROUNDS_PER_RUN = 20;

const credentialsSchema = z.object({
  tenantId: z.string().min(1),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
});

const microsoft365AuditConfigSchema = z.object({
  adapter: z.literal("microsoft_365_audit"),
  tenantId: z.string().min(1),
  contentType: z.string().min(1).default("Audit.General"),
  schedule: z.string().min(1).default("*/15 * * * *"),
  credentials: credentialsSchema,
});

export type Microsoft365AuditConfig = z.infer<
  typeof microsoft365AuditConfigSchema
>;

/** One entry in a content listing. */
interface ContentListingEntry {
  contentUri?: unknown;
}

/** One record inside a content blob. Only the fields we read are typed. */
interface AuditRecord {
  Id?: unknown;
  RecordType?: unknown;
  CreationTime?: unknown;
  Operation?: unknown;
  UserId?: unknown;
  UserKey?: unknown;
  UserType?: unknown;
  AgentId?: unknown;
  AppIdentity?: unknown;
  Workload?: unknown;
}

export interface Microsoft365AuditRunStats {
  /** Records seen that were not Copilot interactions. Counted, not dropped silently. */
  filteredOut: number;
  blobsDrained: number;
  /** True when the run stopped early and the cursor holds the remainder. */
  stoppedEarly: boolean;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * UserType values that mean a non-human actor. 5 is an application, 6 a
 * service principal; attributing either to a person invents an accountable
 * human who was not involved.
 */
const NON_HUMAN_USER_TYPES = new Set([5, 6]);

export function isNonHumanActor(record: AuditRecord): boolean {
  return (
    typeof record.UserType === "number" &&
    NON_HUMAN_USER_TYPES.has(record.UserType)
  );
}

/**
 * Map one audit record to the canonical event shape.
 *
 * Three identity fields, deliberately kept apart:
 *   UserId  — a UPN
 *   UserKey — a PUID
 *   Entra object id — absent; the record does not carry one, so nothing
 *                     claims to hold it
 *
 * Cost and token counts are hard zeros. Copilot is seat-licensed rather than
 * metered per interaction, the record's `Messages[].Size` is documented as
 * unused, and Copilot Studio credit consumption is exposed only as a CSV in
 * the Power Platform admin centre. Estimating them here would put invented
 * numbers into a compliance record.
 */
export function mapAuditRecord(record: AuditRecord): NormalizedPullEvent {
  const nonHuman = isNonHumanActor(record);
  return {
    // Content-derived, from the record's own id. The worker builds the dedup
    // key as `${sourceType}:${sourceId}:${source_event_id}`, so generating
    // this would turn every re-drain into a duplicate row instead of a
    // collapse — which is the property the whole restart design rests on.
    source_event_id: asString(record.Id),
    event_timestamp: asString(record.CreationTime),
    // Empty rather than a guess when there is no human actor.
    actor: nonHuman ? "" : asString(record.UserId),
    action: asString(record.Operation),
    target: asString(record.AgentId),
    cost_usd: 0,
    tokens_input: 0,
    tokens_output: 0,
    raw_payload: JSON.stringify(record),
    extra: {
      user_principal_name: asString(record.UserId),
      // A PUID. Not interchangeable with the UPN above, and not an Entra
      // object id — the record carries no object id at all.
      user_key_puid: asString(record.UserKey),
      user_type: typeof record.UserType === "number" ? record.UserType : null,
      is_non_human_actor: nonHuman,
      // Carried verbatim. The equivalence between this and an inventory
      // botId is undocumented and unverified, so no join is attempted here.
      agent_id: asString(record.AgentId),
      app_identity: asString(record.AppIdentity),
      workload: asString(record.Workload),
      // Audit records are environment-agnostic while agent ids are
      // environment-scoped. Recording the absence beats implying a value.
      environment_id: null,
    },
  };
}

/** Every non-empty `contentUri` in one page of the content listing. */
function contentUrisFrom(listing: ContentListingEntry[]): string[] {
  if (!Array.isArray(listing)) return [];
  return listing
    .map((entry) => asString(entry.contentUri))
    .filter((uri) => uri !== "");
}

/**
 * Append the Copilot interactions in one blob to `events`, counting the rest.
 *
 * Non-Copilot records are counted rather than dropped silently: `Audit.General`
 * carries every workload's records, so a run that emits nothing needs to say
 * whether it saw nothing or saw only other people's traffic.
 */
function collectCopilotEvents(
  records: AuditRecord[],
  events: NormalizedPullEvent[],
  stats: Microsoft365AuditRunStats,
): void {
  if (!Array.isArray(records)) return;
  for (const record of records) {
    if (record?.RecordType === COPILOT_INTERACTION_RECORD_TYPE) {
      events.push(mapAuditRecord(record));
    } else {
      stats.filteredOut += 1;
    }
  }
}

export class Microsoft365AuditPuller
  implements PullerAdapter<Microsoft365AuditConfig>
{
  readonly id: string = "microsoft_365_audit";

  validateConfig(config: unknown): Microsoft365AuditConfig {
    return microsoft365AuditConfigSchema.parse(config);
  }

  async runOnce(
    options: PullRunOptions,
    config: Microsoft365AuditConfig,
  ): Promise<PullResult> {
    const now = Date.now();
    const decoded = decodeCursor(options.cursor);
    if (decoded.recoveredFrom !== undefined) {
      logger.warn(
        {
          ingestionSourceId: options.context?.ingestionSourceId,
          reason: decoded.recoveredFrom,
        },
        "microsoft_365_audit: cursor could not be read; resuming from watermark rather than restarting the window",
      );
    }

    // Per-run token. Deliberately not cached across runs — see
    // shared/oauthClientCredentials.
    const tokens = createTokenProvider({
      credentials: config.credentials,
      scope: MANAGEMENT_API_SCOPE,
      signal: options.signal,
      deadlineAtMs: options.deadlineMs,
    });

    const stats: Microsoft365AuditRunStats = {
      filteredOut: 0,
      blobsDrained: 0,
      stoppedEarly: false,
    };

    try {
      await this.ensureSubscription({ config, tokens, options });

      const cursor = decoded.cursor ?? this.startWindow(now);
      const events: NormalizedPullEvent[] = [];
      const working: Microsoft365AuditCursor = { ...cursor };

      const { completed } = await this.pumpWindow({
        config,
        tokens,
        options,
        cursor: working,
        events,
        stats,
      });

      // `completed` is load-bearing, not belt-and-braces. A run that was out
      // of time before it listed anything leaves the cursor exactly as it
      // found it — queue empty, nothing deferred — which is indistinguishable
      // from a window worked to the end. Advancing on the cursor shape alone
      // skips that interval permanently: no later run asks for it again.
      const drained =
        completed &&
        working.blobQueue.length === 0 &&
        working.nextPageUri === undefined;

      if (drained) {
        // The window is genuinely complete, so the watermark may advance —
        // and, critically, so must the window itself. Advancing only the
        // watermark leaves windowStart/windowEnd pinned at the first window
        // forever: every subsequent run re-lists the same hour, re-emits the
        // same records (which collapse on the content-derived dedup key) and
        // never sees a new event. That is a source that looks healthy and
        // ingests nothing — the exact failure this adapter replaces.
        this.advanceWindow(working, now);
      } else {
        stats.stoppedEarly = true;
      }

      logger.info(
        {
          ingestionSourceId: options.context?.ingestionSourceId,
          emitted: events.length,
          ...stats,
        },
        "microsoft_365_audit: run complete",
      );

      return {
        events,
        // Never null: this source is a continuous feed, so there is always a
        // next window. Returning null would mean "drained forever".
        cursor: encodeCursor(working),
        errorCount: 0,
      };
    } catch (error) {
      if (error instanceof RetryDeadlineExceededError) {
        // Not a failure. Hand back the cursor unchanged so the next run
        // resumes exactly here.
        logger.info(
          { ingestionSourceId: options.context?.ingestionSourceId },
          "microsoft_365_audit: stopping before a retry that would outlive the run",
        );
        return { events: [], cursor: options.cursor, errorCount: 0 };
      }
      throw error;
    }
  }

  /**
   * List then drain, repeatedly, because a full blob queue or the page cap
   * defers part of the listing rather than dropping it. Mutates the cursor, so
   * whatever is left when this returns is exactly what the next run resumes.
   *
   * A bounded loop, not mutual recursion between the two: `deadlineMs` is
   * optional on PullRunOptions, so a run without one facing a server that
   * returns a stable `nextpageuri` would recurse until the stack gave out. The
   * cap bounds it whether or not a deadline is set, and any remainder rides
   * the cursor to the next run.
   *
   * Returns whether the window was actually worked to completion. The caller
   * cannot infer that from the cursor alone: an empty queue with nothing
   * deferred is what a finished window looks like AND what an untouched one
   * looks like, and treating the second as the first advances past an interval
   * that was never listed.
   */
  private async pumpWindow({
    config,
    tokens,
    options,
    cursor,
    events,
    stats,
  }: {
    config: Microsoft365AuditConfig;
    tokens: TokenProvider;
    options: PullRunOptions;
    cursor: Microsoft365AuditCursor;
    events: NormalizedPullEvent[];
    stats: Microsoft365AuditRunStats;
  }): Promise<{ completed: boolean }> {
    for (let round = 0; round < MAX_LIST_DRAIN_ROUNDS_PER_RUN; round += 1) {
      // Out of time before doing anything this round. Whatever is left of the
      // window is still ahead of us, so it is emphatically not complete.
      if (this.outOfTime(options)) return { completed: false };

      if (cursor.phase === "listing" || cursor.nextPageUri !== undefined) {
        await this.listContent({ config, tokens, options, cursor });
      }

      await this.drainBlobs({ config, tokens, options, cursor, events, stats });

      // Nothing deferred and nothing queued: the window is finished. Blobs
      // still queued means the deadline stopped the drain, not the listing —
      // either way, going round again would not help.
      if (cursor.blobQueue.length > 0 || cursor.nextPageUri === undefined) {
        return {
          completed:
            cursor.blobQueue.length === 0 && cursor.nextPageUri === undefined,
        };
      }
    }
    // Round cap hit with work still deferred.
    return { completed: false };
  }

  /**
   * Move to the next window after the current one drained completely.
   *
   * The new window starts exactly where the last ended, so no interval is
   * ever skipped, and reaches no further than now. `MAX_WINDOW_MS` caps how
   * much a single run may claim, so a source that has been down for a week
   * catches up in bounded steps instead of asking for a week in one listing.
   */
  private advanceWindow(cursor: Microsoft365AuditCursor, nowMs: number): void {
    const previousEndMs = Date.parse(cursor.windowEnd);
    const startMs = Number.isNaN(previousEndMs) ? nowMs : previousEndMs;
    const endMs = Math.min(nowMs, startMs + MAX_WINDOW_MS);

    cursor.watermark = cursor.windowEnd;
    cursor.windowStart = new Date(startMs).toISOString();
    // Clamp: if no time has passed since the last run, the window is empty
    // rather than inverted. The next run picks it up when the clock moves.
    cursor.windowEnd = new Date(Math.max(startMs, endMs)).toISOString();
    cursor.blobQueue = [];
    cursor.nextPageUri = undefined;
    cursor.phase = "listing";
  }

  /** A first-ever run, or one resuming from a salvaged watermark. */
  private startWindow(nowMs: number): Microsoft365AuditCursor {
    const start = new Date(nowMs - INITIAL_LOOKBACK_MS).toISOString();
    const end = new Date(nowMs).toISOString();
    return {
      version: 1,
      phase: "listing",
      windowStart: start,
      windowEnd: end,
      blobQueue: [],
      watermark: start,
    };
  }

  /**
   * Start the subscription if it is not already active.
   *
   * Idempotent by design: the API answers an already-started subscription
   * with a conflict, which is a success for our purposes. A subscription
   * stopped outside this system looks identical to one never started, and
   * both are handled by starting it — the gap that opens while it was
   * stopped is not recoverable, because the feed does not backfill.
   */
  private async ensureSubscription({
    config,
    tokens,
    options,
  }: {
    config: Microsoft365AuditConfig;
    tokens: TokenProvider;
    options: PullRunOptions;
  }): Promise<void> {
    const url =
      `${MANAGEMENT_API_BASE}/${encodeURIComponent(config.tenantId)}` +
      `/activity/feed/subscriptions/start` +
      `?contentType=${encodeURIComponent(config.contentType)}`;

    try {
      await fetchWithRetry({
        url,
        method: "POST",
        headers: await this.authHeaders(tokens),
        signal: options.signal,
        deadlineAtMs: options.deadlineMs,
      });
    } catch (error) {
      // AF20024 ("subscription is already enabled") is the expected answer on
      // every run after the first, and it arrives as a 400. The retry helper
      // does not surface the body, so this cannot distinguish it from a
      // genuinely malformed request — it swallows both.
      //
      // That is tolerable only because it is not the last line of defence: if
      // no subscription actually exists, the content listing below fails on
      // its own and the run reports an error. Logging it means a
      // misconfiguration that only ever manifests here is still visible
      // rather than silent.
      if (error instanceof Error && /HTTP 400/.test(error.message)) {
        logger.debug(
          {
            ingestionSourceId: options.context?.ingestionSourceId,
            tenantId: config.tenantId,
          },
          "microsoft_365_audit: subscription start returned 400 (expected once the subscription is enabled)",
        );
        return;
      }
      throw error;
    }
  }

  private async authHeaders(
    tokens: TokenProvider,
  ): Promise<Record<string, string>> {
    return {
      authorization: `Bearer ${await tokens.getToken()}`,
      accept: "application/json",
    };
  }

  /**
   * Fill `cursor.blobQueue` from the content listing, paging until the API
   * runs out, the page cap is hit, or the queue is full. Mutates the cursor
   * so a caller that stops early still holds the remainder.
   */
  /** The first page of a window's content listing. */
  private firstListingUri(
    config: Microsoft365AuditConfig,
    cursor: Microsoft365AuditCursor,
  ): string {
    return (
      `${MANAGEMENT_API_BASE}/${encodeURIComponent(config.tenantId)}` +
      `/activity/feed/subscriptions/content` +
      `?contentType=${encodeURIComponent(config.contentType)}` +
      `&startTime=${encodeURIComponent(cursor.windowStart)}` +
      `&endTime=${encodeURIComponent(cursor.windowEnd)}`
    );
  }

  private async listContent({
    config,
    tokens,
    options,
    cursor,
  }: {
    config: Microsoft365AuditConfig;
    tokens: TokenProvider;
    options: PullRunOptions;
    cursor: Microsoft365AuditCursor;
  }): Promise<void> {
    let pageUri = cursor.nextPageUri ?? this.firstListingUri(config, cursor);

    cursor.nextPageUri = undefined;

    for (let page = 0; page < MAX_LISTING_PAGES_PER_RUN; page += 1) {
      if (this.outOfTime(options)) {
        cursor.nextPageUri = pageUri;
        return;
      }

      const response = await fetchWithRetry({
        url: pageUri,
        headers: await this.authHeaders(tokens),
        signal: options.signal,
        deadlineAtMs: options.deadlineMs,
      });

      cursor.blobQueue.push(
        ...contentUrisFrom((await response.json()) as ContentListingEntry[]),
      );

      const nextPage = response.headers.get("nextpageuri");
      if (nextPage === null || nextPage === "") {
        cursor.phase = "draining";
        return;
      }
      if (cursor.blobQueue.length >= MAX_QUEUED_BLOBS) {
        // Queue is full. Remember where the listing got to rather than
        // dropping the rest — deferring is not truncating.
        cursor.nextPageUri = nextPage;
        cursor.phase = "draining";
        return;
      }
      pageUri = nextPage;
    }

    // Page cap reached. Same reasoning: this is a resume point.
    cursor.nextPageUri = pageUri;
    cursor.phase = "draining";
  }

  /**
   * Drain queued blobs, checking the deadline BETWEEN blobs. A blob is
   * fetched and emitted whole or not started at all, so the queue always
   * describes exactly the work that remains.
   */
  private async drainBlobs({
    config,
    tokens,
    options,
    cursor,
    events,
    stats,
  }: {
    config: Microsoft365AuditConfig;
    tokens: TokenProvider;
    options: PullRunOptions;
    cursor: Microsoft365AuditCursor;
    events: NormalizedPullEvent[];
    stats: Microsoft365AuditRunStats;
  }): Promise<void> {
    while (cursor.blobQueue.length > 0) {
      if (this.outOfTime(options)) return;

      // Peek, fetch, then shift. Shifting first would drop the blob if the
      // fetch threw, and this cursor is the only record that it was pending.
      const uri = cursor.blobQueue[0];
      if (uri === undefined) return;

      const response = await fetchWithRetry({
        url: uri,
        headers: await this.authHeaders(tokens),
        signal: options.signal,
        deadlineAtMs: options.deadlineMs,
      });

      collectCopilotEvents(
        (await response.json()) as AuditRecord[],
        events,
        stats,
      );

      cursor.blobQueue.shift();
      stats.blobsDrained += 1;
    }
  }

  private outOfTime(options: PullRunOptions): boolean {
    if (options.signal?.aborted === true) return true;
    return options.deadlineMs !== undefined && Date.now() >= options.deadlineMs;
  }
}
