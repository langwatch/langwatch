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

import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import { ssrfSafeFetch } from "~/utils/ssrfProtection";
import { COPILOT_CONVERSATION_ACTION } from "./copilotStudioTraceMapper";
import {
  COPILOT_STUDIO_DATAVERSE_ADAPTER_ID,
  isDataverseEnvironmentOrigin,
  isSameDataverseEnvironment,
} from "./dataverseEnvironment";
import type {
  NormalizedPullEvent,
  PullerAdapter,
  PullResult,
  PullRunOptions,
} from "./pullerAdapter";

const logger = createLogger("langwatch:puller:copilot_studio_dataverse");

const TOKEN_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 30_000;
/** Dataverse's own page ceiling for this kind of read. */
const PAGE_SIZE = 50;

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

export const copilotStudioDataversePullConfigSchema = z.object({
  adapter: z.literal(COPILOT_STUDIO_DATAVERSE_ADAPTER_ID),
  /** Environment base URL, e.g. `https://org12345.crm.dynamics.com`. */
  environmentUrl: z.string().url(),
  /**
   * Which agents to read. Empty means every agent the credential can see,
   * which is what most customers want and what silently starts covering an
   * agent the day someone creates one.
   */
  botIds: z.array(z.string()).default([]),
});

export type CopilotStudioDataverseConfig = z.infer<
  typeof copilotStudioDataversePullConfigSchema
>;

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
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
const transcriptRowSchema = z
  .object({
    conversationtranscriptid: z.string(),
    name: z.string().nullable().optional(),
    conversationstarttime: z.string().nullable().optional(),
    createdon: z.string().nullable().optional(),
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

const botsPageSchema = z.object({
  value: z.array(z.unknown()).default([]),
  "@odata.nextLink": z.string().optional(),
});

/** What the run knows about one agent, keyed by its lookup id. */
interface BotRecord {
  botName?: string;
  botModifiedOn?: string;
}

const pageSchema = z.object({
  value: z.array(z.unknown()).default([]),
  "@odata.nextLink": z.string().optional(),
});

/**
 * The cursor. `createdon` alone is not enough — rows written in the same
 * instant would either repeat forever or be skipped depending on which way
 * the comparison leaned, so the row id breaks the tie.
 */
interface Cursor {
  createdon: string;
  conversationtranscriptid: string;
}

function parseCursor(raw: string | null): Cursor | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as Cursor).createdon === "string" &&
      typeof (parsed as Cursor).conversationtranscriptid === "string"
    ) {
      return parsed as Cursor;
    }
  } catch {
    // A cursor we cannot read is treated as no cursor: re-reading a window is
    // survivable because identifiers are derived, but skipping one is not.
  }
  return null;
}

/**
 * Exchange the application's own credentials for a token scoped to this
 * environment.
 *
 * Minted once per run rather than per request: a run walks several pages, and
 * a token per page would multiply one sign-in across the whole walk for no
 * benefit, since the token outlives any single run.
 */
async function resolveEnvironmentToken(params: {
  credentials: Record<string, string> | undefined;
  environmentUrl: string;
  signal?: AbortSignal;
}): Promise<string> {
  const { credentials, environmentUrl, signal } = params;
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
    scope: `${environmentUrl.replace(/\/+$/, "")}/.default`,
  });
  const timeout = AbortSignal.timeout(TOKEN_TIMEOUT_MS);

  const response = await ssrfSafeFetch(
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

/** OData string literals escape a single quote by doubling it. */
function odataQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function buildFirstPageUrl(params: {
  environmentUrl: string;
  config: CopilotStudioDataverseConfig;
  cursor: Cursor | null;
  now: number;
}): string {
  const { environmentUrl, config, cursor, now } = params;
  const base = `${environmentUrl.replace(/\/+$/, "")}/api/data/${API_VERSION}/conversationtranscripts`;

  const since = cursor
    ? cursor.createdon
    : new Date(now - FIRST_RUN_LOOKBACK_MS).toISOString();

  const filters = [`createdon ge ${since}`];
  if (cursor) {
    // `ge` plus an explicit exclusion of the row already seen. Using `gt`
    // alone would skip every other row written in the same instant.
    filters.push(
      `conversationtranscriptid ne ${cursor.conversationtranscriptid}`,
    );
  }
  if (config.botIds.length > 0) {
    const clause = config.botIds
      .map((id) => `_bot_conversationtranscriptid_value eq ${odataQuote(id)}`)
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
    ["$orderby", "createdon asc,conversationtranscriptid asc"],
    ["$top", String(PAGE_SIZE)],
    // No `$expand` here. The agent arrives as the raw lookup id and the run
    // reads the `bot` table once to put a name on it. Asking Dataverse to join
    // would save that read, but it means naming a navigation property, and the
    // reads proven against a real environment all take the lookup column and
    // join it themselves.
  ];
  return `${base}?${query
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&")}`;
}

/**
 * Dataverse writes lookup ids in one case and there is no promise both sides of
 * a join agree on it, so the key is folded before it is stored or read. A miss
 * here is silent — a conversation with no agent name — which is exactly the
 * kind of fault that survives a review.
 */
function botKey(id: string): string {
  return id.toLowerCase();
}

function botFactsOf(params: {
  row: z.infer<typeof transcriptRowSchema>;
  bots: Map<string, BotRecord>;
}): Record<string, string> {
  const { row, bots } = params;
  const id = row._bot_conversationtranscriptid_value;
  if (!id) return {};
  const record = bots.get(botKey(id));
  if (!record) return {};
  const facts: Record<string, string> = {};
  if (record.botName) facts.botName = record.botName;
  if (record.botModifiedOn) facts.botModifiedOn = record.botModifiedOn;
  return facts;
}

/**
 * What a walk of this run's pages has read so far.
 *
 * Held on one object because a page read can throw part-way through the walk.
 * The run keeps the rows it already read, and reading them back off a shared
 * accumulator is what makes that true rather than aspirational.
 */
interface TranscriptWalk {
  events: NormalizedPullEvent[];
  errorCount: number;
  last: Cursor | null;
}

/**
 * One transcript row as the event it becomes and the cursor it advances to,
 * or null when the row is shaped unlike the rest.
 *
 * This is where a fact read off the row turns into something a reader sees,
 * so a field added to the query is turned into an attribute here and nowhere
 * else.
 */
function readTranscriptRow(params: {
  raw: object;
  previous: Cursor | null;
  bots: Map<string, BotRecord>;
}): { event: NormalizedPullEvent; cursor: Cursor } | null {
  const { raw, previous, bots } = params;
  const parsed = transcriptRowSchema.safeParse(raw);
  if (!parsed.success) return null;

  const row = parsed.data;
  const facts = botFactsOf({ row, bots });
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
        row.conversationstarttime ?? row.createdon ?? new Date().toISOString(),
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

/** Read one page's rows into the walk. */
function readPageRows(params: {
  page: z.infer<typeof pageSchema>;
  walk: TranscriptWalk;
  bots: Map<string, BotRecord>;
}): void {
  const { page, walk, bots } = params;
  for (const raw of page.value) {
    if (!raw || typeof raw !== "object") continue;
    const read = readTranscriptRow({ raw, previous: walk.last, bots });
    if (!read) {
      // A row shaped unlike the rest is counted, not fatal: one bad row must
      // not cost the whole window.
      walk.errorCount += 1;
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
function runIsOver(options: PullRunOptions): boolean {
  if (options.signal?.aborted) return true;
  return Boolean(options.deadlineMs && Date.now() > options.deadlineMs);
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
function refusesNextLink(params: {
  link: string | null;
  environmentUrl: string;
  walk: TranscriptWalk;
}): boolean {
  const { link, environmentUrl, walk } = params;
  if (!link || isSameDataverseEnvironment(link, environmentUrl)) return false;
  walk.errorCount += 1;
  // The host, not the URL: the refused link carries a skip token and query
  // shape that add nothing here, and the host is the whole of what an
  // operator needs to tell an attack apart from an environment that pages on
  // a second address of its own. Without it this stall looks like a
  // permissions problem and gets debugged as one.
  logger.error(
    { refusedHost: hostOf(link), environmentHost: hostOf(environmentUrl) },
    "copilot studio dataverse: refusing a next-page link that is not the configured environment",
  );
  return true;
}

/** The headers every read of this environment carries. */
function dataverseHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "OData-MaxVersion": "4.0",
    "OData-Version": "4.0",
  };
}

/** A URL's host for logging, never throwing on one that will not parse. */
function hostOf(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return "unparseable";
  }
}

export class CopilotStudioDataversePuller
  implements PullerAdapter<CopilotStudioDataverseConfig>
{
  readonly id: string = COPILOT_STUDIO_DATAVERSE_ADAPTER_ID;

  validateConfig(config: unknown): CopilotStudioDataverseConfig {
    const parsed = copilotStudioDataversePullConfigSchema.parse(config);
    // The same check the write path runs, repeated here so a config that
    // reached the adapter by any other route still cannot send the secret
    // somewhere Microsoft does not serve.
    if (!isDataverseEnvironmentOrigin(parsed.environmentUrl)) {
      throw new Error(
        "environmentUrl must be an https Power Platform environment address",
      );
    }
    return parsed;
  }

  async runOnce(
    options: PullRunOptions,
    config: CopilotStudioDataverseConfig,
  ): Promise<PullResult> {
    const walk: TranscriptWalk = { events: [], errorCount: 0, last: null };

    try {
      const token = await resolveEnvironmentToken({
        credentials: options.credentials,
        environmentUrl: config.environmentUrl,
        signal: options.signal,
      });
      const bots = await this.fetchBots({
        environmentUrl: config.environmentUrl,
        token,
        signal: options.signal,
      });
      await this.walkTranscriptPages({ walk, options, config, token, bots });
    } catch (error) {
      walk.errorCount += 1;
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "copilot studio dataverse pull failed",
      );
      // The cursor is deliberately not advanced: the next run retries the
      // same window, and re-reading is safe because identifiers are derived
      // from the conversation rather than minted per pull. What the walk read
      // before it failed is kept.
      return {
        events: walk.events,
        cursor: options.cursor,
        errorCount: walk.errorCount,
      };
    }

    return {
      events: walk.events,
      // Only advance past rows this run actually read. A run that read
      // nothing leaves the cursor alone so the same window is retried.
      cursor: walk.last?.createdon ? JSON.stringify(walk.last) : options.cursor,
      errorCount: walk.errorCount,
    };
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
  }): Promise<void> {
    const { walk, options, config, token, bots } = params;

    let url: string | null = buildFirstPageUrl({
      environmentUrl: config.environmentUrl,
      config,
      cursor: parseCursor(options.cursor),
      now: Date.now(),
    });
    let pageCount = 0;

    while (url && pageCount < MAX_PAGES_PER_RUN) {
      pageCount += 1;
      if (runIsOver(options)) break;

      const page = await this.fetchPage({ url, token, signal: options.signal });
      readPageRows({ page, walk, bots });

      const nextLink = page["@odata.nextLink"] ?? null;
      if (
        refusesNextLink({
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
    const bots = new Map<string, BotRecord>();
    const base = `${environmentUrl.replace(/\/+$/, "")}/api/data/${API_VERSION}/bots`;
    const query = `$select=${encodeURIComponent("botid,name,modifiedon")}&$top=${MAX_BOTS}`;

    try {
      const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
      const response = await ssrfSafeFetch(`${base}?${query}`, {
        method: "GET",
        headers: dataverseHeaders(token),
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
        return bots;
      }

      const page = botsPageSchema.parse(await response.json());
      for (const raw of page.value) {
        const parsed = botRowSchema.safeParse(raw);
        if (!parsed.success) continue;
        const row = parsed.data;
        bots.set(botKey(row.botid), {
          botName: row.name ?? undefined,
          botModifiedOn: row.modifiedon ?? undefined,
        });
      }

      if (page["@odata.nextLink"]) {
        logger.warn(
          { read: bots.size },
          "copilot studio dataverse: more agents than one read returns; conversations belonging to the rest get no name",
        );
      }

      // An empty list is the shape a misconfigured role arrives in, and it is
      // the quiet one. A role that reads the agent table at the wrong depth is
      // answered with 200 and no rows rather than a refusal, because the
      // application user owns none of them — indistinguishable from a tenant
      // that genuinely has no agents, except that a run reading conversations
      // written by an agent has just been told there are none.
      if (bots.size === 0) {
        logger.warn(
          "copilot studio dataverse: the environment reports no agents at all; if conversations are arriving unnamed the credential most likely reads the agent table at the wrong depth",
        );
      }
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "copilot studio dataverse: could not read the agent list; conversations keep their agent id but get no name",
      );
    }
    return bots;
  }

  private async fetchPage(params: {
    url: string;
    token: string;
    signal?: AbortSignal;
  }): Promise<z.infer<typeof pageSchema>> {
    const { url, token, signal } = params;
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const response = await ssrfSafeFetch(url, {
      method: "GET",
      headers: dataverseHeaders(token),
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
    return pageSchema.parse(await response.json());
  }
}
