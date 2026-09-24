// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Reads Copilot Studio conversations from Dataverse.
 *
 * This replaces a source that polled Microsoft's directory audit — the log of
 * who was made an administrator and which app was granted consent. That log
 * records changes to the directory; it has never held a Copilot conversation
 * and no configuration would make it. The conversations live in the Dataverse
 * transcript table the agent writes to itself, which is what this reads.
 *
 * It stands alone rather than extending the HTTP polling adapter. That base
 * class substitutes a fixed credential into header templates, which works
 * when the credential is a value known before the run. Here the credential is
 * an application secret that must be exchanged for a short-lived token before
 * the first request, and the exchange has its own failure modes an admin
 * needs to be told apart from "the query failed". Pushing token machinery
 * into a base class four other adapters run on, for the sake of one, buys a
 * shared parent and pays for it in blast radius.
 *
 * What the customer has to set up, in full: one application registration, one
 * secret, one role grant in their Power Platform environment. No directory
 * permission of any kind — this never calls Microsoft Graph, which is only
 * true because author identities are stored as the raw account identifier and
 * resolved to names elsewhere.
 */

import {
  type GovernancePuller as PullerAdapter,
  type NormalizedPullEvent,
  type PullResult,
  type PullRunOptions,
  copilotStudioDataversePullConfigSchema,
  type CopilotStudioDataversePullConfig,
} from "@langwatch/enterprise-governance-contract";
import { createLogger } from "@langwatch/observability";
import { Temporal, nowInstant } from "@langwatch/time";
import { z } from "zod";

import type { GovernanceHttpClient } from "../../app/governance.members.ts";
import {
  AZURE_AI_METER_CATEGORIES,
  AZURE_COST_API_VERSION,
  AZURE_MANAGEMENT_HOST,
  azureCostEvents,
  azureCostReadIsDue,
  azureCostReadWindow,
  azureCostRequestBody,
  isAzureResourceManagerUrl,
  nextAzureCostCursor,
  readAzureCostRows,
} from "../../rules/azure-cost-management.rules.ts";
import { COPILOT_CONVERSATION_ACTION } from "../../rules/copilot-studio-trace-mapper-service.rules.ts";
import {
  COPILOT_STUDIO_DATAVERSE_ADAPTER_ID,
  isEnvironmentOrigin,
  isSameEnvironment,
} from "../../rules/dataverse-environment-service.rules.ts";
import {
  DIRECTORY_USERS_FIRST_PAGE,
  type DirectoryUser,
  directoryReadIsDue,
  isMicrosoftGraphUrl,
  microsoftDirectoryEvents,
  nextDirectoryCursor,
  readDirectoryUserRows,
} from "../../rules/microsoft-graph-directory.rules.ts";
import {
  MICROSOFT_GRAPH_SCOPE,
  microsoftSeatEvents,
  nextSeatsCursor,
  readSubscribedSkuRows,
  seatsReadIsDue,
  seatsReportDay,
} from "../../rules/microsoft-graph-seats.rules.ts";
export { copilotStudioDataversePullConfigSchema } from "@langwatch/enterprise-governance-contract";
import type { CopilotStudioDataversePullerChannel } from "../copilot-studio-dataverse.channel.ts";

const logger = createLogger("langwatch:puller:copilot_studio_dataverse");

const TOKEN_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 30_000;
/** Dataverse's own page ceiling for this kind of read. */
const PAGE_SIZE = 50;

/**
 * The order every transcript read asks for, and the order the continuation
 * predicate in `buildFirstPageUrl` is written against.
 *
 * The two are one decision held in one place on purpose. A cursor of
 * "(timestamp, id) of the last row read" only makes forward progress if the
 * rows come back sorted by exactly that pair, in exactly this direction.
 * Change the sort without changing the predicate and the run starts skipping
 * rows or handing back rows it has already read; the constant is what stops
 * the two drifting apart in separate edits.
 */
const TRANSCRIPT_ORDER_BY = "createdon asc,conversationtranscriptid asc";

/**
 * Safety cap so a server that keeps handing back a next-page link cannot keep
 * one run going forever. The deadline and the abort signal are the real
 * bounds, but both are optional on the run options and a `while (nextLink)`
 * with neither is unbounded. The sibling adapters carry the same cap.
 */
const MAX_PAGES_PER_RUN = 50;

/**
 * How many agents one run will name. A tenant holds tens of them, not
 * thousands, so this is a ceiling rather than a page size and the run does not
 * follow a second page of them — it says so in the log instead, because the
 * cost of going over is conversations with no agent name, not a failed run.
 */
const MAX_BOTS = 500;

/** Web API version this adapter's query shape is written against. */
const API_VERSION = "v9.2";

/**
 * Microsoft deletes transcripts on a schedule roughly a month out, so a first
 * run that tried to read further back would spend its time on rows that are
 * not there. Kept under the platform's own limit on how old a span may be.
 */
const FIRST_RUN_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

export type CopilotStudioDataverseConfig = CopilotStudioDataversePullConfig;

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
});

/**
 * The part of a row the cursor is built from, on its own.
 *
 * These two fields are the position; everything else on the row is the event.
 * Read separately so a row that fails the full schema below can still be
 * stepped over — `name` arriving as a number costs that one event rather than
 * wedging the whole source behind a row the walk cannot get past.
 *
 * Both end up interpolated bare into the next run's `$filter`, where
 * `conversationtranscriptid` is an `Edm.Guid` and `createdon` an
 * `Edm.DateTimeOffset` — neither takes quotes. A row whose value carries OData
 * operator text would therefore build a broken predicate, and because that
 * value is persisted as the cursor, every later run would repeat the same 400
 * with the cursor unchanged. Constrained here so a row like that is counted and
 * dropped instead of poisoning the walk.
 *
 * The full row schema extends this one rather than restating the two field
 * types. They are the same constraint for the same reason, and a copy is a
 * thing that can be loosened in one place — in the one spot where loosening it
 * is what lets operator text reach the filter.
 */
const cursorRowSchema = z.object({
  conversationtranscriptid: z.string().uuid(),
  createdon: z.string().datetime({ offset: true }).nullable().optional(),
});

/**
 * The row fields the query asks for. Anything else Dataverse sends passes by,
 * which is what `.passthrough()` is doing rather than decoration: zod strips
 * undeclared keys by default, and the stripped object is what gets stored as
 * `raw_payload`. That field is contracted to hold what the source actually
 * sent, so a mapping written later can be replayed against old rows instead of
 * re-pulling them — and a field silently dropped at parse time is not there to
 * replay.
 *
 * `_bot_conversationtranscriptid_value` is the agent this conversation belongs
 * to, as a plain lookup id. It is the only trustworthy link to the `bot` table:
 * the row's own `metadata` carries a `BotId`, and that one is a different value
 * that joins to nothing.
 */
const transcriptRowSchema = cursorRowSchema
  .safeExtend({
    name: z.string().nullable().optional(),
    conversationstarttime: z.string().nullable().optional(),
    content: z.string().nullable().optional(),
    metadata: z.string().nullable().optional(),
    schematype: z.string().nullable().optional(),
    schemaversion: z.string().nullable().optional(),
    _bot_conversationtranscriptid_value: z.string().nullable().optional(),
  })
  .passthrough();

/**
 * One row of the `bot` table, read once per run to put a name on each
 * conversation.
 */
const botRowSchema = z
  .object({
    botid: z.string(),
    name: z.string().nullable().optional(),
    modifiedon: z.string().nullable().optional(),
  })
  .passthrough();

/** The envelope every OData collection read comes back in. */
const odataPageSchema = z.object({
  value: z.array(z.unknown()).default([]),
  "@odata.nextLink": z.string().optional(),
});

/** What the run knows about one agent, keyed by its lookup id. */
interface BotRecord {
  botName?: string;
  botModifiedOn?: string;
}

/**
 * The cursor. `createdon` alone is not enough — rows written in the same
 * instant would either repeat forever or be skipped depending on which way
 * the comparison leaned, so the row id breaks the tie.
 *
 * Constrained to the same shapes the row schema enforces, because a cursor is
 * read back from storage on a later run: whatever wrote it, only a value that
 * can be interpolated into `$filter` may come back out.
 */
const cursorSchema = z.object({
  createdon: z.string().datetime({ offset: true }),
  conversationtranscriptid: z.string().uuid(),
});
type Cursor = z.infer<typeof cursorSchema>;

const dayField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullish();
const heldField = z.number().int().nonnegative().nullish();

/** Transcript fields stay top-level and every later field is optional, so positions written by older builds still parse. */
const storedCursorSchema = z.object({
  createdon: z.string().datetime({ offset: true }).optional(),
  conversationtranscriptid: z.string().uuid().optional(),
  costPricedThroughDay: dayField,
  costHeldSinceMs: heldField,
  costReadAtMs: heldField,
  costDeepReadDay: z.string().nullish(),
  seatsReportedThroughDay: dayField,
  seatsHeldSinceMs: heldField,
  directoryReportedThroughDay: dayField,
  directoryHeldSinceMs: heldField,
});

interface CostPosition {
  pricedThroughDay: string | null;
  heldSinceMs: number | null;
  readAtMs: number | null;
  deepReadDay: string | null;
}

interface DayPosition {
  reportedThroughDay: string | null;
  heldSinceMs: number | null;
}

interface StoredCursor {
  transcript: Cursor | null;
  cost: CostPosition;
  seats: DayPosition;
  directory: DayPosition;
}

const NO_CURSOR: StoredCursor = {
  transcript: null,
  cost: { pricedThroughDay: null, heldSinceMs: null, readAtMs: null, deepReadDay: null },
  seats: { reportedThroughDay: null, heldSinceMs: null },
  directory: { reportedThroughDay: null, heldSinceMs: null },
};

/** Dataverse and Azure Resource Manager are separate audiences; a cost-reading run signs in once for each. */
const AZURE_MANAGEMENT_SCOPE = `https://${AZURE_MANAGEMENT_HOST}/.default`;

const MAX_DIRECTORY_PAGES = 50;

/**
 * What a walk of this run's pages has read so far.
 *
 * Held on one object because a page read can throw part-way through the walk,
 * and the rows already read have to be reachable from the catch rather than
 * lost with the stack frame that was collecting them.
 *
 * Whether they are then written is the worker's call, not this one's, and for
 * a throw the answer is no: an error count with an unchanged cursor fails the
 * run. The accumulator earns its keep on the path that does not throw — a
 * refused next-page link stops the walk, keeps the pages already read, and
 * advances the cursor over them.
 */
interface TranscriptWalk {
  events: NormalizedPullEvent[];
  errorCount: number;
  last: Cursor | null;
  /** The walk stopped at a limit with pages still waiting; the rows read are kept. */
  isTruncated: boolean;
}

export class HttpCopilotStudioDataverseChannel
  implements PullerAdapter<CopilotStudioDataverseConfig>, CopilotStudioDataversePullerChannel
{
  readonly id: string = COPILOT_STUDIO_DATAVERSE_ADAPTER_ID;

  private constructor(private readonly http: GovernanceHttpClient) {}

  static create(http: GovernanceHttpClient): HttpCopilotStudioDataverseChannel {
    return new HttpCopilotStudioDataverseChannel(http);
  }

  validateConfig(config: unknown): CopilotStudioDataverseConfig {
    const parsed = copilotStudioDataversePullConfigSchema.parse(config);
    // The same check the write path runs, repeated here so a config that
    // reached the adapter by any other route still cannot send the secret
    // somewhere Microsoft does not serve.
    if (!isEnvironmentOrigin(parsed.environmentUrl)) {
      throw new Error("environmentUrl must be an https Power Platform environment address");
    }
    return parsed;
  }

  async runOnce(
    options: PullRunOptions,
    config: CopilotStudioDataverseConfig,
  ): Promise<PullResult> {
    const walk: TranscriptWalk = { events: [], errorCount: 0, last: null, isTruncated: false };
    const previous = HttpCopilotStudioDataverseChannel.parseCursor(options.cursor);

    // Cost, seats and directory never throw and never count an error: an
    // error with an unmoved cursor makes the worker discard the conversations.
    const costRead = await this.readAzureCost({ config, options, previous: previous.cost });
    walk.events.push(...costRead.events);
    const seatsRead = await this.readMicrosoftSeats({ config, options, previous: previous.seats });
    walk.events.push(...seatsRead.events);
    const directoryRead = await this.readMicrosoftDirectory({
      config,
      options,
      previous: previous.directory,
    });
    walk.events.push(...directoryRead.events);

    try {
      const token = await HttpCopilotStudioDataverseChannel.resolveEnvironmentToken({
        credentials: options.credentials,
        environmentUrl: config.environmentUrl,
        signal: options.signal,
        http: this.http,
      });
      const bots = await this.fetchBots({
        environmentUrl: config.environmentUrl,
        token,
        signal: options.signal,
      });
      await this.walkTranscriptPages({
        walk,
        options,
        config,
        token,
        bots,
        cursor: previous.transcript,
      });
    } catch (error) {
      walk.errorCount += 1;
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "copilot studio dataverse pull failed",
      );
    }

    const next: StoredCursor = {
      transcript: walk.last?.createdon ? walk.last : previous.transcript,
      cost: costRead.cost,
      seats: seatsRead.seats,
      directory: directoryRead.directory,
    };

    return {
      events: walk.events,
      // An unmoved position hands back the incoming string verbatim, which the
      // worker reads as no progress.
      cursor: HttpCopilotStudioDataverseChannel.positionMoved({ previous, next })
        ? HttpCopilotStudioDataverseChannel.encodeCursor(next)
        : options.cursor,
      errorCount: walk.errorCount,
      ...(walk.isTruncated ? { completeness: "truncated" as const } : {}),
    };
  }

  /** The daily Azure bill, or a held window; see specs/ai-governance/puller-framework/copilot-studio-dataverse.feature. */
  private async readAzureCost(params: {
    config: CopilotStudioDataverseConfig;
    options: PullRunOptions;
    previous: CostPosition;
  }): Promise<{ events: NormalizedPullEvent[]; cost: CostPosition }> {
    const { config, options, previous } = params;
    const subscriptionId = config.azureSubscriptionId;
    if (!subscriptionId) return { events: [], cost: previous };

    // The bill is read only under the billing identity, never the bot's.
    const billingClientId = options.credentials?.billingClientId;
    const billingClientSecret = options.credentials?.billingClientSecret;
    if (!billingClientId || !billingClientSecret) return { events: [], cost: previous };

    const nowMs = nowInstant().epochMilliseconds;
    if (!azureCostReadIsDue({ nowMs, readAtMs: previous.readAtMs })) {
      return { events: [], cost: previous };
    }
    const held = (): { events: NormalizedPullEvent[]; cost: CostPosition } => ({
      events: [],
      cost: {
        ...nextAzureCostCursor({ nowMs, previous, outcome: "held" }),
        deepReadDay: previous.deepReadDay,
      },
    });

    try {
      const token = await HttpCopilotStudioDataverseChannel.resolveEnvironmentToken({
        credentials: {
          tenantId: options.credentials?.tenantId ?? "",
          clientId: billingClientId,
          clientSecret: billingClientSecret,
        },
        environmentUrl: config.environmentUrl,
        scope: AZURE_MANAGEMENT_SCOPE,
        signal: options.signal,
        http: this.http,
      });
      const window = azureCostReadWindow({
        nowMs,
        pricedThroughDay: previous.pricedThroughDay,
        deepReadDay: previous.deepReadDay,
      });
      const days = await this.fetchAzureCostPages({ subscriptionId, token, window, options });
      if (days === null) return held();

      const aiDays = days.filter((day) =>
        AZURE_AI_METER_CATEGORIES.some((category) => category === day.meterCategory),
      );
      const priced = nextAzureCostCursor({
        nowMs,
        previous,
        outcome: "priced",
        wasDeepRead: window.isDeepRead,
      });
      return {
        events: azureCostEvents({ days: aiDays, subscriptionId }),
        cost: { ...priced, deepReadDay: priced.deepReadDay ?? previous.deepReadDay },
      };
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "copilot studio dataverse: could not read the Azure bill; holding the window and delivering the conversations",
      );
      return held();
    }
  }

  /** Every page of one cost read, or null: a half-read window must never be reported as priced. */
  private async fetchAzureCostPages(params: {
    subscriptionId: string;
    token: string;
    window: { fromDay: string; toDay: string };
    options: PullRunOptions;
  }): Promise<ReturnType<typeof readAzureCostRows>["days"] | null> {
    const { subscriptionId, token, window, options } = params;
    const days: ReturnType<typeof readAzureCostRows>["days"] = [];

    let url: string =
      `https://${AZURE_MANAGEMENT_HOST}/subscriptions/${encodeURIComponent(subscriptionId)}` +
      `/providers/Microsoft.CostManagement/query?api-version=${AZURE_COST_API_VERSION}`;
    let pageCount = 0;

    while (pageCount < MAX_PAGES_PER_RUN && !HttpCopilotStudioDataverseChannel.runIsOver(options)) {
      pageCount += 1;
      const page = await this.readAzureCostPage({ url, token, window, options, subscriptionId });
      if (page === null) return null;
      days.push(...page.days);
      if (page.nextLink === null) return days;

      // The next link is followed carrying the ARM bearer, so its host is parsed, not compared as text.
      if (!isAzureResourceManagerUrl(page.nextLink)) {
        logger.error(
          { refusedHost: HttpCopilotStudioDataverseChannel.hostOf(page.nextLink), subscriptionId },
          "copilot studio dataverse: refusing an Azure cost next-page link that is not Azure Resource Manager; holding the window",
        );
        return null;
      }
      url = page.nextLink;
    }

    logger.warn(
      { pageCount, subscriptionId },
      "copilot studio dataverse: the Azure cost read ran out of run before it ran out of pages; holding the window",
    );
    return null;
  }

  private async readAzureCostPage(params: {
    url: string;
    token: string;
    window: { fromDay: string; toDay: string };
    options: PullRunOptions;
    subscriptionId: string;
  }): Promise<ReturnType<typeof readAzureCostRows> | null> {
    const { url, token, window, options, subscriptionId } = params;
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const response = await this.http.fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(azureCostRequestBody(window)),
      signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
      followRedirects: false,
    });

    if (!response.ok) {
      logger.warn(
        { status: response.status, subscriptionId },
        response.status === 429
          ? "copilot studio dataverse: Azure asked the cost read to retry later (HTTP 429); holding the window for the next run"
          : "copilot studio dataverse: Azure refused the cost read; holding the window for the next run",
      );
      return null;
    }

    const read = readAzureCostRows({ response: await response.json() });
    if (read.malformed) {
      logger.warn(
        { subscriptionId },
        "copilot studio dataverse: Azure answered the cost read with an unrecognised body; holding the window for the next run",
      );
      return null;
    }
    if (read.unreadableRows > 0) {
      logger.warn(
        { unreadableRows: read.unreadableRows, subscriptionId },
        "copilot studio dataverse: some Azure cost rows could not be read; the rest of the window is recorded",
      );
    }
    return read;
  }

  /** The tenant's seat licences, or a held day; a refusal is never recorded as zero seats. */
  private async readMicrosoftSeats(params: {
    config: CopilotStudioDataverseConfig;
    options: PullRunOptions;
    previous: DayPosition;
  }): Promise<{ events: NormalizedPullEvent[]; seats: DayPosition }> {
    const { config, options, previous } = params;
    if (!config.readSeats) return { events: [], seats: previous };

    const nowMs = nowInstant().epochMilliseconds;
    if (!seatsReadIsDue({ nowMs, reportedThroughDay: previous.reportedThroughDay })) {
      return { events: [], seats: previous };
    }
    const held = (): { events: NormalizedPullEvent[]; seats: DayPosition } => ({
      events: [],
      seats: nextSeatsCursor({ nowMs, previous, outcome: "held" }),
    });

    try {
      const token = await HttpCopilotStudioDataverseChannel.resolveEnvironmentToken({
        credentials: options.credentials,
        environmentUrl: config.environmentUrl,
        scope: MICROSOFT_GRAPH_SCOPE,
        signal: options.signal,
        http: this.http,
      });
      const read = await this.fetchSubscribedSkus({ token, options });
      if (read === null) return held();
      return {
        events: microsoftSeatEvents({ skus: read.skus, day: seatsReportDay({ nowMs }) }),
        seats: nextSeatsCursor({ nowMs, previous, outcome: "reported" }),
      };
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "copilot studio dataverse: could not read the tenant's seat licences; holding the day and delivering the conversations",
      );
      return held();
    }
  }

  private async fetchSubscribedSkus(params: {
    token: string;
    options: PullRunOptions;
  }): Promise<ReturnType<typeof readSubscribedSkuRows> | null> {
    const { token, options } = params;
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const response = await this.http.fetch("https://graph.microsoft.com/v1.0/subscribedSkus", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
      followRedirects: false,
    });

    if (!response.ok) {
      logger.warn(
        { status: response.status },
        response.status === 403
          ? "copilot studio dataverse: the tenant has not consented to the licence read (HTTP 403); holding the day"
          : "copilot studio dataverse: Microsoft Graph refused the licence read; holding the day",
      );
      return null;
    }

    const read = readSubscribedSkuRows({ response: await response.json() });
    if (read.malformed) {
      logger.warn(
        "copilot studio dataverse: Microsoft Graph answered the licence read with an unrecognised body; holding the day",
      );
      return null;
    }
    if (read.unreadableRows > 0) {
      logger.warn(
        { unreadableRows: read.unreadableRows },
        "copilot studio dataverse: some licence pools could not be read; the rest of the list is recorded",
      );
    }
    if (read.skus.length === 0 && read.unreadableRows > 0) {
      logger.warn(
        { unreadableRows: read.unreadableRows },
        "copilot studio dataverse: no licence pool in Microsoft Graph's reply could be read; holding the day",
      );
      return null;
    }
    return read;
  }

  /** The tenant's user directory, or a held day; the licence read's contract exactly. */
  private async readMicrosoftDirectory(params: {
    config: CopilotStudioDataverseConfig;
    options: PullRunOptions;
    previous: DayPosition;
  }): Promise<{ events: NormalizedPullEvent[]; directory: DayPosition }> {
    const { config, options, previous } = params;
    if (!config.readDirectory) return { events: [], directory: previous };

    const nowMs = nowInstant().epochMilliseconds;
    if (!directoryReadIsDue({ nowMs, reportedThroughDay: previous.reportedThroughDay })) {
      return { events: [], directory: previous };
    }
    const held = (): { events: NormalizedPullEvent[]; directory: DayPosition } => ({
      events: [],
      directory: nextDirectoryCursor({ nowMs, previous, outcome: "held" }),
    });

    try {
      const token = await HttpCopilotStudioDataverseChannel.resolveEnvironmentToken({
        credentials: options.credentials,
        environmentUrl: config.environmentUrl,
        scope: MICROSOFT_GRAPH_SCOPE,
        signal: options.signal,
        http: this.http,
      });
      const users = await this.fetchDirectoryUsers({ token, options });
      if (users === null) return held();
      return {
        events: microsoftDirectoryEvents({ users, day: seatsReportDay({ nowMs }) }),
        directory: nextDirectoryCursor({ nowMs, previous, outcome: "reported" }),
      };
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "copilot studio dataverse: could not read the tenant's directory; holding the day and delivering the conversations",
      );
      return held();
    }
  }

  /** The whole user list across Graph's pages, or null: half a directory would list half the tenant. */
  private async fetchDirectoryUsers(params: {
    token: string;
    options: PullRunOptions;
  }): Promise<DirectoryUser[] | null> {
    const { token, options } = params;
    const users: DirectoryUser[] = [];
    let unreadableRows = 0;
    let url: string = DIRECTORY_USERS_FIRST_PAGE;

    for (let page = 0; page < MAX_DIRECTORY_PAGES; page += 1) {
      const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
      const response = await this.http.fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
        followRedirects: false,
      });
      if (!response.ok) {
        logger.warn(
          { status: response.status },
          response.status === 403
            ? "copilot studio dataverse: the tenant has not consented to the directory read (HTTP 403); holding the day"
            : "copilot studio dataverse: Microsoft Graph refused the directory read; holding the day",
        );
        return null;
      }
      const read = readDirectoryUserRows({ response: await response.json() });
      if (read.malformed) {
        logger.warn(
          "copilot studio dataverse: Microsoft Graph answered the directory read with an unrecognised body; holding the day",
        );
        return null;
      }
      users.push(...read.users);
      unreadableRows += read.unreadableRows;

      if (read.nextLink === null) {
        return HttpCopilotStudioDataverseChannel.completeDirectoryList({ users, unreadableRows });
      }
      if (!isMicrosoftGraphUrl(read.nextLink)) {
        logger.error(
          { refusedHost: HttpCopilotStudioDataverseChannel.hostOf(read.nextLink) },
          "copilot studio dataverse: refusing a directory next-page link that is not Microsoft Graph; holding the day",
        );
        return null;
      }
      url = read.nextLink;
    }

    logger.error(
      { pagesRead: MAX_DIRECTORY_PAGES, usersRead: users.length },
      "copilot studio dataverse: the directory did not fit the page budget; holding the day",
    );
    return null;
  }

  private static completeDirectoryList({
    users,
    unreadableRows,
  }: {
    users: DirectoryUser[];
    unreadableRows: number;
  }): DirectoryUser[] | null {
    if (users.length === 0 && unreadableRows > 0) {
      logger.warn(
        { unreadableRows },
        "copilot studio dataverse: no directory row in Microsoft Graph's reply could be read; holding the day",
      );
      return null;
    }
    if (unreadableRows > 0) {
      logger.warn(
        { unreadableRows },
        "copilot studio dataverse: some directory rows could not be read; the rest of the list is recorded",
      );
    }
    return users;
  }

  /**
   * Page through the transcript table, reading each page into `walk`.
   *
   * Throws whatever a page read throws, on purpose: the caller holds the same
   * `walk` and answers with the rows already in it.
   */
  private async walkTranscriptPages(params: {
    walk: TranscriptWalk;
    options: PullRunOptions;
    config: CopilotStudioDataverseConfig;
    token: string;
    bots: Map<string, BotRecord>;
    cursor: Cursor | null;
  }): Promise<void> {
    const { walk, options, config, token, bots, cursor } = params;

    let url: string | null = HttpCopilotStudioDataverseChannel.buildFirstPageUrl({
      environmentUrl: config.environmentUrl,
      config,
      cursor,
      now: nowInstant().epochMilliseconds,
    });
    let pageCount = 0;

    while (url && pageCount < MAX_PAGES_PER_RUN) {
      pageCount += 1;
      if (HttpCopilotStudioDataverseChannel.runIsOver(options)) {
        walk.isTruncated = true;
        break;
      }

      const page = await this.fetchPage({ url, token, signal: options.signal });
      HttpCopilotStudioDataverseChannel.readPageRows({ page, walk, bots });

      const nextLink = page["@odata.nextLink"] ?? null;
      if (
        HttpCopilotStudioDataverseChannel.refusesNextLink({
          link: nextLink,
          environmentUrl: config.environmentUrl,
          walk,
        })
      ) {
        break;
      }
      url = nextLink;
    }

    if (url && pageCount >= MAX_PAGES_PER_RUN) {
      walk.isTruncated = true;
      logger.warn(
        { pageCount },
        "copilot studio dataverse hit the page cap; the next run resumes from the cursor",
      );
    }
  }

  /**
   * The agents in this environment, keyed by lookup id.
   *
   * A conversation carries its agent as an id and nothing else, so without this
   * every event would be attributed to a GUID. It is one read for the whole
   * run, not one per conversation.
   *
   * It never throws and never counts an error. A name is a nicety and the
   * transcripts are the point; worse, an error here would be indistinguishable
   * from a bad transcript row downstream, where a non-zero count makes the
   * worker discard the run's events and leave the cursor where it was. A
   * failure to name the agents would then stop the source from moving at all.
   */
  private async fetchBots(params: {
    environmentUrl: string;
    token: string;
    signal?: AbortSignal;
  }): Promise<Map<string, BotRecord>> {
    const { environmentUrl, token, signal } = params;

    try {
      const page = await this.fetchBotsPage({ environmentUrl, token, signal });
      if (!page) return new Map();

      const bots = HttpCopilotStudioDataverseChannel.readBotRows(page.value);
      HttpCopilotStudioDataverseChannel.warnAboutIncompleteBotList({
        botCount: bots.size,
        hasMorePages: Boolean(page["@odata.nextLink"]),
      });
      return bots;
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "copilot studio dataverse: could not read the agent list; conversations keep their agent id but get no name",
      );
      return new Map();
    }
  }

  /**
   * The one read of the `bot` table, or null when the environment refused it.
   *
   * A refusal is null rather than a throw because it is the ordinary case
   * here: the caller treats "no list" and "an unreadable list" the same way,
   * and neither is worth an error count.
   */
  private async fetchBotsPage(params: {
    environmentUrl: string;
    token: string;
    signal?: AbortSignal;
  }): Promise<z.infer<typeof odataPageSchema> | null> {
    const { environmentUrl, token, signal } = params;
    const base = `${environmentUrl.replace(/\/+$/, "")}/api/data/${API_VERSION}/bots`;
    const query = `$select=${encodeURIComponent("botid,name,modifiedon")}&$top=${MAX_BOTS}`;
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);

    const response = await this.http.fetch(`${base}?${query}`, {
      method: "GET",
      headers: HttpCopilotStudioDataverseChannel.dataverseHeaders(token),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      // Same reasoning as the transcript read: this request carries the
      // token, and a redirect would hand it to whoever answers.
      followRedirects: false,
    });

    if (!response.ok) {
      logger.warn(
        { status: response.status },
        "copilot studio dataverse: could not read the agent list; conversations keep their agent id but get no name",
      );
      return null;
    }
    return odataPageSchema.parse(await response.json());
  }

  private async fetchPage(params: {
    url: string;
    token: string;
    signal?: AbortSignal;
  }): Promise<z.infer<typeof odataPageSchema>> {
    const { url, token, signal } = params;
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const response = await this.http.fetch(url, {
      method: "GET",
      headers: {
        ...HttpCopilotStudioDataverseChannel.dataverseHeaders(token),
        Prefer: `odata.maxpagesize=${PAGE_SIZE}`,
      },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      // The header above carries the token minted from the customer's secret.
      // The helper follows up to ten redirects by default and re-sends
      // headers to each host it lands on.
      followRedirects: false,
    });

    if (!response.ok) {
      throw new Error(
        `copilot studio dataverse puller: the environment refused the read (HTTP ${response.status})`,
      );
    }
    return odataPageSchema.parse(await response.json());
  }

  private static parseCursor(raw: string | null): StoredCursor {
    if (!raw) return NO_CURSOR;
    try {
      const parsed = storedCursorSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) return NO_CURSOR;
      const data = parsed.data;
      return {
        transcript:
          data.createdon && data.conversationtranscriptid
            ? { createdon: data.createdon, conversationtranscriptid: data.conversationtranscriptid }
            : null,
        cost: {
          pricedThroughDay: data.costPricedThroughDay ?? null,
          heldSinceMs: data.costHeldSinceMs ?? null,
          readAtMs: data.costReadAtMs ?? null,
          deepReadDay: data.costDeepReadDay ?? null,
        },
        seats: {
          reportedThroughDay: data.seatsReportedThroughDay ?? null,
          heldSinceMs: data.seatsHeldSinceMs ?? null,
        },
        directory: {
          reportedThroughDay: data.directoryReportedThroughDay ?? null,
          heldSinceMs: data.directoryHeldSinceMs ?? null,
        },
      };
    } catch {
      // Unreadable reads as no cursor: re-reading a window is survivable, skipping one is not.
    }
    return NO_CURSOR;
  }

  private static positionMoved({
    previous,
    next,
  }: {
    previous: StoredCursor;
    next: StoredCursor;
  }): boolean {
    const transcriptMoved =
      next.transcript !== null &&
      (next.transcript.createdon !== previous.transcript?.createdon ||
        next.transcript.conversationtranscriptid !== previous.transcript?.conversationtranscriptid);
    const costMoved =
      next.cost.pricedThroughDay !== previous.cost.pricedThroughDay ||
      next.cost.heldSinceMs !== previous.cost.heldSinceMs ||
      next.cost.readAtMs !== previous.cost.readAtMs ||
      next.cost.deepReadDay !== previous.cost.deepReadDay;
    const dayMoved = (a: DayPosition, b: DayPosition) =>
      a.reportedThroughDay !== b.reportedThroughDay || a.heldSinceMs !== b.heldSinceMs;
    return (
      transcriptMoved ||
      costMoved ||
      dayMoved(next.seats, previous.seats) ||
      dayMoved(next.directory, previous.directory)
    );
  }

  private static encodeCursor(cursor: StoredCursor): string {
    return JSON.stringify({
      ...cursor.transcript,
      costPricedThroughDay: cursor.cost.pricedThroughDay,
      costHeldSinceMs: cursor.cost.heldSinceMs,
      costReadAtMs: cursor.cost.readAtMs,
      costDeepReadDay: cursor.cost.deepReadDay,
      seatsReportedThroughDay: cursor.seats.reportedThroughDay,
      seatsHeldSinceMs: cursor.seats.heldSinceMs,
      directoryReportedThroughDay: cursor.directory.reportedThroughDay,
      directoryHeldSinceMs: cursor.directory.heldSinceMs,
    });
  }

  /**
   * Exchange the application's own credentials for a token scoped to this
   * environment.
   *
   * Minted once per run rather than per request: a run walks several pages, and
   * a token per page would multiply one sign-in across the whole walk for no
   * benefit, since the token outlives any single run.
   */
  private static async resolveEnvironmentToken(params: {
    credentials: Record<string, string> | undefined;
    environmentUrl: string;
    scope?: string;
    signal?: AbortSignal;
    http: GovernanceHttpClient;
  }): Promise<string> {
    const { credentials, environmentUrl, signal, http } = params;
    const scope = params.scope ?? `${environmentUrl.replace(/\/+$/, "")}/.default`;
    const tenantId = credentials?.tenantId;
    const clientId = credentials?.clientId;
    const clientSecret = credentials?.clientSecret;

    if (!tenantId || !clientId || !clientSecret) {
      throw new Error(
        "copilot studio dataverse puller needs credentials.tenantId, " +
          "credentials.clientId and credentials.clientSecret from the app registration",
      );
    }

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope,
    });
    const timeout = AbortSignal.timeout(TOKEN_TIMEOUT_MS);

    const response = await http.fetch(
      `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        // This request carries the client secret itself, not a token minted
        // from it. Following a redirect would hand it to the redirect target,
        // and the helper follows up to ten by default.
        followRedirects: false,
      },
    );

    if (!response.ok) {
      // The status alone, never the body: a token endpoint may echo the request
      // back, and this reason is logged and shown on the source.
      throw new Error(
        "copilot studio dataverse puller could not sign in: Microsoft refused " +
          `the application's credentials (HTTP ${response.status})`,
      );
    }

    const parsed = tokenResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      // A proxy or captive portal answering 200 with something that is not a
      // token must not be carried forward as one — it would fail later as an
      // unauthorised Dataverse call and read as a permissions problem.
      throw new Error(
        "copilot studio dataverse puller could not sign in: Microsoft answered " +
          "the sign-in without an access token",
      );
    }
    return parsed.data.access_token;
  }

  /**
   * Where a run picks up from, as OData.
   *
   * This is a lexicographic "everything after (T, I)" over the pair the rows are
   * sorted by, and it has to be exactly that. The obvious shorter form — every
   * row at or after T except the one already seen — is not a total order: on a
   * timestamp holding several rows it re-reads the ones with smaller ids, so a
   * run whose cursor is B hands back A, saves A, and the next run hands back B
   * again. The pair alternates forever, the same transcripts are reprocessed
   * every run, and no later row is ever reached.
   *
   * The leading `ge` says nothing the disjunction does not already say. It is
   * kept because it is the plain range bound the server can seek `createdon` on,
   * where the `or` on its own invites a scan of the window.
   */
  private static continuationFilters(cursor: Cursor): string[] {
    return [
      `createdon ge ${cursor.createdon}`,
      `(createdon gt ${cursor.createdon} or (createdon eq ${cursor.createdon}` +
        ` and conversationtranscriptid gt ${cursor.conversationtranscriptid}))`,
    ];
  }

  private static buildFirstPageUrl(params: {
    environmentUrl: string;
    config: CopilotStudioDataverseConfig;
    cursor: Cursor | null;
    now: number;
  }): string {
    const { environmentUrl, config, cursor, now } = params;
    const base = `${environmentUrl.replace(/\/+$/, "")}/api/data/${API_VERSION}/conversationtranscripts`;

    const filters = cursor
      ? HttpCopilotStudioDataverseChannel.continuationFilters(cursor)
      : [
          `createdon ge ${Temporal.Instant.fromEpochMilliseconds(now - FIRST_RUN_LOOKBACK_MS).toString({ fractionalSecondDigits: 3 })}`,
        ];
    if (config.botIds.length > 0) {
      // Bare, not quoted. The lookup column is an `Edm.Guid`, and Dataverse
      // refuses to compare one against a string literal: a quoted id answers
      // every run with "a binary operator with incompatible types was detected",
      // an HTTP 400 that names neither the filter nor the column. The schema
      // requires these to be uuids, which is what makes writing them unquoted
      // safe. Contrast the transcript id in `continuationFilters`, which is the
      // same column type and already bare for the same reason.
      const clause = config.botIds
        .map((id) => `_bot_conversationtranscriptid_value eq ${id}`)
        .join(" or ");
      filters.push(`(${clause})`);
    }

    // Built by hand rather than with URLSearchParams, which encodes a space as
    // `+`. That is form encoding; OData specifies percent-encoding, and a
    // `$filter` whose spaces arrive as plus signs is at the mercy of how the
    // server chooses to read them.
    const query: [string, string][] = [
      [
        "$select",
        "conversationtranscriptid,name,conversationstarttime,createdon,content," +
          "metadata,schematype,schemaversion,_bot_conversationtranscriptid_value",
      ],
      ["$filter", filters.join(" and ")],
      ["$orderby", TRANSCRIPT_ORDER_BY],
      ["$top", String(PAGE_SIZE)],
      // No `$expand` here. The agent arrives as the raw lookup id and the run
      // reads the `bot` table once to put a name on it. Asking Dataverse to join
      // would save that read, but it means naming a navigation property, and the
      // reads proven against a real environment all take the lookup column and
      // join it themselves.
    ];
    return `${base}?${query.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&")}`;
  }

  /**
   * Dataverse writes lookup ids in one case and there is no promise both sides of
   * a join agree on it, so the key is folded before it is stored or read. A miss
   * here is silent — a conversation with no agent name — which is exactly the
   * kind of fault that survives a review.
   */
  private static botKey(id: string): string {
    return id.toLowerCase();
  }

  /** The agents on one page of the `bot` table, keyed by folded lookup id. */
  private static readBotRows(rows: unknown[]): Map<string, BotRecord> {
    const bots = new Map<string, BotRecord>();
    for (const raw of rows) {
      const parsed = botRowSchema.safeParse(raw);
      if (!parsed.success) continue;
      const row = parsed.data;
      bots.set(HttpCopilotStudioDataverseChannel.botKey(row.botid), {
        botName: row.name ?? undefined,
        botModifiedOn: row.modifiedon ?? undefined,
      });
    }
    return bots;
  }

  /**
   * Say so when the agent list came back short, in either of the two ways it can.
   *
   * Neither is an error — the conversations are the point and a name is a
   * nicety — so the only thing standing between the customer and unnamed
   * conversations with no explanation is a line in the log.
   */
  private static warnAboutIncompleteBotList(params: {
    botCount: number;
    hasMorePages: boolean;
  }): void {
    const { botCount, hasMorePages } = params;

    if (hasMorePages) {
      logger.warn(
        { read: botCount },
        "copilot studio dataverse: more agents than one read returns; conversations belonging to the rest get no name",
      );
    }

    // An empty list is the shape a misconfigured role arrives in, and it is
    // the quiet one. A role that reads the agent table at the wrong depth is
    // answered with 200 and no rows rather than a refusal, because the
    // application user owns none of them — indistinguishable from a tenant
    // that genuinely has no agents, except that a run reading conversations
    // written by an agent has just been told there are none.
    if (botCount === 0) {
      logger.warn(
        "copilot studio dataverse: the environment reports no agents at all; if conversations are arriving unnamed the credential most likely reads the agent table at the wrong depth",
      );
    }
  }

  private static botFactsOf(params: {
    row: z.infer<typeof transcriptRowSchema>;
    bots: Map<string, BotRecord>;
  }): Record<string, string> {
    const { row, bots } = params;
    const id = row._bot_conversationtranscriptid_value;
    if (!id) return {};
    const record = bots.get(HttpCopilotStudioDataverseChannel.botKey(id));
    if (!record) return {};
    const facts: Record<string, string> = {};
    if (record.botName) facts.botName = record.botName;
    if (record.botModifiedOn) facts.botModifiedOn = record.botModifiedOn;
    return facts;
  }

  /**
   * One transcript row as the event it becomes and the cursor it advances to,
   * or null when the row is shaped unlike the rest.
   *
   * This is where a fact read off the row turns into something a reader sees,
   * so a field added to the query is turned into an attribute here and nowhere
   * else.
   */
  private static readTranscriptRow(params: {
    raw: object;
    previous: Cursor | null;
    bots: Map<string, BotRecord>;
  }): { event: NormalizedPullEvent; cursor: Cursor } | null {
    const { raw, previous, bots } = params;
    const parsed = transcriptRowSchema.safeParse(raw);
    if (!parsed.success) return null;

    const row = parsed.data;
    const facts = HttpCopilotStudioDataverseChannel.botFactsOf({ row, bots });
    // A row with no `createdon` keeps the previous row's, so the cursor never
    // goes backwards and never lands on an empty timestamp that the next run's
    // filter would read as "everything".
    const previousCreatedOn: string = previous ? previous.createdon : "";

    return {
      cursor: {
        createdon: row.createdon ?? previousCreatedOn,
        conversationtranscriptid: row.conversationtranscriptid,
      },
      event: {
        source_event_id: row.conversationtranscriptid,
        event_timestamp:
          row.conversationstarttime ??
          row.createdon ??
          nowInstant().toString({ fractionalSecondDigits: 3 }),
        // Attribution lives on the turns inside the transcript, where the
        // account identifier actually is. A row has no single author.
        actor: "",
        action: COPILOT_CONVERSATION_ACTION,
        target: facts.botName ?? "",
        cost_usd: "0",
        tokens_input: 0,
        tokens_output: 0,
        raw_payload: JSON.stringify(row),
        extra: facts,
      },
    };
  }

  /**
   * Where the walk gets to after a row it could not read as an event, or null
   * when that row cannot even say where it sits.
   *
   * Only the identifier and the timestamp go into the next run's filter, so the
   * two are read on their own here. A row whose `content` came back as a number
   * is unreadable as an event and still perfectly readable as a position, and
   * this is what lets the walk step over it. Rows arrive in `TRANSCRIPT_ORDER_BY`
   * order, so a row further down the page is always a cursor further forward.
   *
   * Null is the row whose own identifier is the unreadable part. That id is what
   * the next filter would be built from, so there is no position to move to and
   * the caller leaves the cursor where it was — the run then fails, loudly and
   * repeatedly, which is the right answer for a row nobody can name. Skipping it
   * would mean stepping over a row without being able to say which one.
   */
  private static cursorPastUnreadableRow(params: {
    raw: object;
    previous: Cursor | null;
  }): Cursor | null {
    const { raw, previous } = params;
    const parsed = cursorRowSchema.safeParse(raw);
    if (!parsed.success) return null;

    return {
      // Same fallback as a readable row with no `createdon`: keep the previous
      // timestamp rather than let an empty one through, where the next run's
      // filter would read it as "everything".
      createdon: parsed.data.createdon ?? (previous ? previous.createdon : ""),
      conversationtranscriptid: parsed.data.conversationtranscriptid,
    };
  }

  /** Read one page's rows into the walk. */
  private static readPageRows(params: {
    page: z.infer<typeof odataPageSchema>;
    walk: TranscriptWalk;
    bots: Map<string, BotRecord>;
  }): void {
    const { page, walk, bots } = params;
    for (const raw of page.value) {
      // A row shaped unlike the rest is counted, not fatal: one bad row must not
      // cost the whole window. Both arms below are that same case — an entry
      // that is not an object at all is no more readable than one that fails the
      // schema, and dropping it silently would report a page of rubbish as a
      // source with nothing in it.
      if (!raw || typeof raw !== "object") {
        walk.errorCount += 1;
        continue;
      }
      const read = HttpCopilotStudioDataverseChannel.readTranscriptRow({
        raw,
        previous: walk.last,
        bots,
      });
      if (!read) {
        walk.errorCount += 1;
        // Step over it if it can still say where it sits. Leaving the cursor
        // behind an unreadable row is what wedges a source: the next run asks
        // for everything after the last good row, gets the bad one back, counts
        // the same error against a cursor that has not moved, and the worker
        // fails it as no progress — every run, until some later row happens to
        // arrive and drag the window past it.
        walk.last =
          HttpCopilotStudioDataverseChannel.cursorPastUnreadableRow({
            raw,
            previous: walk.last,
          }) ?? walk.last;
        continue;
      }
      walk.last = read.cursor;
      walk.events.push(read.event);
    }
  }

  /**
   * Whether this run must stop before reading another page.
   *
   * Stopping here is clean and keeps what the run already read: the next run
   * resumes from the cursor rather than repeating the whole window.
   */
  private static runIsOver(options: PullRunOptions): boolean {
    if (options.signal?.aborted) return true;
    return Boolean(options.deadlineMs && nowInstant().epochMilliseconds > options.deadlineMs);
  }

  /**
   * Whether the server pointed the walk at a URL that is not the customer's own
   * environment, in which case the walk stops where it is.
   *
   * The next page is a URL out of the response body, and the request that
   * follows it carries the access token. `followRedirects: false` stops the
   * server bouncing the credential somewhere else, and this is the same hop by
   * another name — the check has to hold for every request that carries the
   * secret, not only the first.
   *
   * It is the configured environment that is required here, not merely a host
   * Microsoft serves. Every tenant's environment is a Microsoft host, so a
   * suffix check alone would let a link move the token from this customer's
   * environment to somebody else's.
   */
  private static refusesNextLink(params: {
    link: string | null;
    environmentUrl: string;
    walk: TranscriptWalk;
  }): boolean {
    const { link, environmentUrl, walk } = params;
    if (!link || isSameEnvironment({ value: link, environmentUrl })) return false;
    walk.errorCount += 1;
    // The host, not the URL: the refused link carries a skip token and query
    // shape that add nothing here, and the host is the whole of what an
    // operator needs to tell an attack apart from an environment that pages on
    // a second address of its own. Without it this stall looks like a
    // permissions problem and gets debugged as one.
    logger.error(
      {
        refusedHost: HttpCopilotStudioDataverseChannel.hostOf(link),
        environmentHost: HttpCopilotStudioDataverseChannel.hostOf(environmentUrl),
      },
      "copilot studio dataverse: refusing a next-page link that is not the configured environment",
    );
    return true;
  }

  /** The headers every read of this environment carries. */
  private static dataverseHeaders(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "OData-MaxVersion": "4.0",
      "OData-Version": "4.0",
    };
  }

  /** A URL's host for logging, never throwing on one that will not parse. */
  private static hostOf(value: string): string {
    try {
      return new URL(value).host;
    } catch {
      return "unparseable";
    }
  }
}
