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
 * What the customer has to set up for the conversations alone: one application
 * registration, one secret, one role grant in their Power Platform
 * environment. No directory permission — nothing here resolves a person, which
 * is only true because author identities are stored as the raw account
 * identifier and named elsewhere.
 *
 * The source reads two further things beside the conversations, each under its
 * own sign-in and each off until the customer asks for it: the environment's
 * daily bill from Azure Cost Management, and the tenant's seat licences from
 * Microsoft Graph. The Graph call is one read of `/subscribedSkus` — a count
 * of pools bought and pools assigned, no user list and no directory read — and
 * it happens only when `readSeats` is on, because it needs an admin consent
 * the other two reads do not.
 *
 * The three reads do not hold each other hostage. Cost and licences are read
 * first and degrade to "not this run" on any failure; the conversation half
 * runs afterwards and is the only one that can report an error. That ordering
 * is what lets a customer whose environment address is wrong still see what
 * they are being billed.
 */

import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import { ssrfSafeFetch } from "~/utils/ssrfProtection";
import {
  AZURE_COST_API_VERSION,
  AZURE_MANAGEMENT_HOST,
  azureCostEvents,
  azureCostReadIsDue,
  azureCostReadWindow,
  azureCostRequestBody,
  isAzureResourceManagerUrl,
  nextAzureCostCursor,
  readAzureCostRows,
} from "./azureCostManagement";
import { COPILOT_CONVERSATION_ACTION } from "./copilotStudioTraceMapper";
import {
  COPILOT_STUDIO_DATAVERSE_ADAPTER_ID,
  isDataverseEnvironmentOrigin,
  isSameDataverseEnvironment,
} from "./dataverseEnvironment";
import {
  MICROSOFT_GRAPH_SCOPE,
  microsoftSeatEvents,
  nextSeatsCursor,
  readSubscribedSkuRows,
  seatsReadIsDue,
  seatsReportDay,
} from "./microsoftGraphSeats";
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

export const copilotStudioDataversePullConfigSchema = z.object({
  adapter: z.literal(COPILOT_STUDIO_DATAVERSE_ADAPTER_ID),
  /** Environment base URL, e.g. `https://org12345.crm.dynamics.com`. */
  environmentUrl: z.string().url(),
  /**
   * Which agents to read. Empty means every agent the credential can see,
   * which is what most customers want and what silently starts covering an
   * agent the day someone creates one.
   *
   * Required to be a uuid because the id is written into the `$filter` as a
   * bare `Edm.Guid` literal, which is the only form Dataverse accepts for a
   * lookup column. Bare means unquoted, and unquoted means an id that is not a
   * guid would be read as part of the filter expression rather than as a value
   * — so the shape that makes the query correct is the same shape that keeps
   * anything else out of it. A malformed id is refused here, where the source
   * says why, instead of arriving as an opaque HTTP 400 on every run.
   */
  botIds: z.array(z.string().uuid()).default([]),
  /**
   * The Azure subscription the environment runs in, when the customer wants
   * its bill read too.
   *
   * Optional, and the cost read is off without it. A customer who only wants
   * transcripts must not have a second permission grant — a reader role on the
   * subscription — forced on them to get them.
   *
   * A uuid because that is what an Azure subscription id is, and because it is
   * interpolated into the request path: the shape that makes the request
   * correct is the same shape that keeps anything else out of it.
   */
  azureSubscriptionId: z.string().uuid().optional(),
  /**
   * The customer's declaration that this Copilot runs on prepaid message
   * packs (ADR-128 §21.4).
   *
   * Prepaid packs create no Azure resource, so the cost feed returns nothing
   * — indistinguishable from a quiet pay-as-you-go month. The adapter never
   * reads this field; it exists so the spend panel can explain an empty bill
   * with the customer's own words rather than inferring a contract from
   * silence. Optional because a source without a subscription has no bill to
   * explain.
   */
  azureBillingIsPrepaid: z.boolean().optional(),
  /**
   * Whether to read the tenant's seat licences beside the conversations.
   *
   * On unless switched off. Seats are the half of the money the conversations
   * cannot show — a seat nobody sits in produces no usage at all — so a source
   * that reads one and not the other answers "what is this costing us" wrong
   * by default, and an admin who wanted the answer would have had to know the
   * setting existed to get it.
   *
   * The consent is the reason this is a setting rather than a constant:
   * `/subscribedSkus` needs `Organization.Read.All` granted on the tenant, and
   * a tenant that never granted it refuses the call. That refusal is held and
   * given up on rather than retried forever, and it never fails the run — so
   * the cost of being on for a customer who does not want it is a setting they
   * switch off, not a source that breaks.
   */
  readSeats: z.boolean().default(true),
});

export type CopilotStudioDataverseConfig = z.infer<
  typeof copilotStudioDataversePullConfigSchema
>;

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
  .extend({
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

/**
 * The whole stored position: where the transcript walk got to, how far the
 * bill has been priced, and which day's licences were last reported.
 *
 * The transcript fields keep their original names at the TOP LEVEL rather than
 * moving under a nest, and everything the later reads added is optional. Both
 * halves of that are backward compatibility: a position written before cost or
 * seats existed parses here unchanged, and a position written by this build is
 * still readable by a build that only knows the transcript fields. Positions
 * are read back on every scheduled run, so a shape the old value cannot
 * survive would stall every already-configured source at once.
 */
const storedCursorSchema = z.object({
  createdon: z.string().datetime({ offset: true }).optional(),
  conversationtranscriptid: z.string().uuid().optional(),
  /** The last day the bill was read through, `YYYY-MM-DD`. */
  costPricedThroughDay: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  /** When the current unpriced window started being held. */
  costHeldSinceMs: z.number().int().nonnegative().nullish(),
  /** When a run last asked Cost Management anything, however it answered. */
  costReadAtMs: z.number().int().nonnegative().nullish(),
  /** The last day the seat licences were reported for, `YYYY-MM-DD`. */
  seatsReportedThroughDay: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  /** When the current unreported day started being held. */
  seatsHeldSinceMs: z.number().int().nonnegative().nullish(),
});

interface StoredCursor {
  /** Null until a run has read at least one transcript row. */
  transcript: Cursor | null;
  cost: {
    pricedThroughDay: string | null;
    heldSinceMs: number | null;
    readAtMs: number | null;
  };
  seats: { reportedThroughDay: string | null; heldSinceMs: number | null };
}

const NO_CURSOR: StoredCursor = {
  transcript: null,
  cost: { pricedThroughDay: null, heldSinceMs: null, readAtMs: null },
  seats: { reportedThroughDay: null, heldSinceMs: null },
};

function parseCursor(raw: string | null): StoredCursor {
  if (!raw) return NO_CURSOR;
  try {
    const parsed = storedCursorSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return NO_CURSOR;
    const { createdon, conversationtranscriptid } = parsed.data;
    return {
      // Both or neither: the pair IS the position, and half of it would build
      // a filter that either re-reads a window or skips one.
      transcript:
        createdon && conversationtranscriptid
          ? { createdon, conversationtranscriptid }
          : null,
      cost: {
        pricedThroughDay: parsed.data.costPricedThroughDay ?? null,
        heldSinceMs: parsed.data.costHeldSinceMs ?? null,
        // Absent on every position written before the ask was recorded, which
        // reads as never asked and so asks at once.
        readAtMs: parsed.data.costReadAtMs ?? null,
      },
      seats: {
        reportedThroughDay: parsed.data.seatsReportedThroughDay ?? null,
        heldSinceMs: parsed.data.seatsHeldSinceMs ?? null,
      },
    };
  } catch {
    // A cursor we cannot read is treated as no cursor: re-reading a window is
    // survivable because identifiers are derived, but skipping one is not.
  }
  return NO_CURSOR;
}

/** The position a run hands back, as the string that is stored. */
function encodeCursor(cursor: StoredCursor): string {
  return JSON.stringify({
    ...(cursor.transcript ?? {}),
    costPricedThroughDay: cursor.cost.pricedThroughDay,
    costHeldSinceMs: cursor.cost.heldSinceMs,
    costReadAtMs: cursor.cost.readAtMs,
    seatsReportedThroughDay: cursor.seats.reportedThroughDay,
    seatsHeldSinceMs: cursor.seats.heldSinceMs,
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
/** The audience the transcript and agent reads are signed in for. */
function environmentScope(environmentUrl: string): string {
  return `${environmentUrl.replace(/\/+$/, "")}/.default`;
}

/**
 * The audience the Azure bill is read under.
 *
 * A different audience from the environment, and one token cannot stand in for
 * the other: Dataverse and Azure Resource Manager are separate resources, and
 * a token minted for one is refused by the other. So a source that reads cost
 * signs in twice per run, once per audience.
 */
export const AZURE_MANAGEMENT_SCOPE = `https://${AZURE_MANAGEMENT_HOST}/.default`;

async function resolveEnvironmentToken(params: {
  credentials: Record<string, string> | undefined;
  environmentUrl: string;
  /** Which audience to mint for. Defaults to the environment itself. */
  scope?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const { credentials, environmentUrl, signal } = params;
  const scope = params.scope ?? environmentScope(environmentUrl);
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
function continuationFilters(cursor: Cursor): string[] {
  return [
    `createdon ge ${cursor.createdon}`,
    `(createdon gt ${cursor.createdon} or (createdon eq ${cursor.createdon}` +
      ` and conversationtranscriptid gt ${cursor.conversationtranscriptid}))`,
  ];
}

function buildFirstPageUrl(params: {
  environmentUrl: string;
  config: CopilotStudioDataverseConfig;
  cursor: Cursor | null;
  now: number;
}): string {
  const { environmentUrl, config, cursor, now } = params;
  const base = `${environmentUrl.replace(/\/+$/, "")}/api/data/${API_VERSION}/conversationtranscripts`;

  const filters = cursor
    ? continuationFilters(cursor)
    : [`createdon ge ${new Date(now - FIRST_RUN_LOOKBACK_MS).toISOString()}`];
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

/** The agents on one page of the `bot` table, keyed by folded lookup id. */
function readBotRows(rows: unknown[]): Map<string, BotRecord> {
  const bots = new Map<string, BotRecord>();
  for (const raw of rows) {
    const parsed = botRowSchema.safeParse(raw);
    if (!parsed.success) continue;
    const row = parsed.data;
    bots.set(botKey(row.botid), {
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
function warnAboutIncompleteBotList(params: {
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
function cursorPastUnreadableRow(params: {
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
function readPageRows(params: {
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
    const read = readTranscriptRow({ raw, previous: walk.last, bots });
    if (!read) {
      walk.errorCount += 1;
      // Step over it if it can still say where it sits. Leaving the cursor
      // behind an unreadable row is what wedges a source: the next run asks
      // for everything after the last good row, gets the bad one back, counts
      // the same error against a cursor that has not moved, and the worker
      // fails it as no progress — every run, until some later row happens to
      // arrive and drag the window past it.
      walk.last =
        cursorPastUnreadableRow({ raw, previous: walk.last }) ?? walk.last;
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
  if (!link || isSameDataverseEnvironment({ value: link, environmentUrl }))
    return false;
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
    const previous = parseCursor(options.cursor);

    // Both money reads happen BEFORE the environment is signed in to, and the
    // order is the whole reason a wrong environment address no longer hides
    // the bill. Neither throws and neither counts an error — put either of
    // them after the sign-in and a customer with a broken environment would
    // stop seeing figures that were sitting there to be read.
    const costRead = await this.readAzureCost({
      config,
      options,
      previous: previous.cost,
    });
    walk.events.push(...costRead.events);
    const cost = costRead.cost;

    const seatsRead = await this.readMicrosoftSeats({
      config,
      options,
      previous: previous.seats,
    });
    walk.events.push(...seatsRead.events);
    const seats = seatsRead.seats;

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
      // Falls through to the cursor computation rather than returning here.
      // The bill and the licences above already landed, and abandoning the
      // result for a failure in an unrelated half would throw away figures the
      // run genuinely obtained. The transcript position is untouched either
      // way, so the next run retries the same window; re-reading is safe
      // because identifiers are derived from the conversation rather than
      // minted per pull.
      //
      // The rows this walk did read are kept, and the position it reached
      // describes them exactly: pages arrive in `TRANSCRIPT_ORDER_BY` order and
      // a page that throws is parsed as a whole or not at all, so `walk.last`
      // is the last row of the last page that came back complete.
    }

    // Only advance past rows this run actually read: a walk that read nothing
    // keeps the position it started from, so the same window is retried. The
    // cost and licence halves advance independently — each is its own window
    // with its own watermark, and holding one for another would make an
    // environment with no new conversations never price its bill, or a bill
    // that cannot be read stall the transcripts.
    const advanced = walk.last?.createdon ? walk.last : previous.transcript;
    const transcriptMoved =
      advanced !== null &&
      (advanced.createdon !== previous.transcript?.createdon ||
        advanced.conversationtranscriptid !==
          previous.transcript?.conversationtranscriptid);
    const costMoved =
      cost.pricedThroughDay !== previous.cost.pricedThroughDay ||
      cost.heldSinceMs !== previous.cost.heldSinceMs ||
      // The instant of the ask counts as movement in its own right. A run that
      // asked and found the same figure moves neither of the two above, and
      // dropping the record of the ask would leave the source due again on the
      // very next run.
      cost.readAtMs !== previous.cost.readAtMs;
    const seatsMoved =
      seats.reportedThroughDay !== previous.seats.reportedThroughDay ||
      seats.heldSinceMs !== previous.seats.heldSinceMs;

    // Any of the three reads counts, on a clean run and on a failing one
    // alike. A run whose conversations broke but whose bill was read is a
    // partial success: the worker persists the advance, keeps the figures, and
    // warns. What such a run does to the source's recorded health is the fold
    // projection's decision to make, not this gate's — refusing the advance
    // here bought that visibility by throwing away figures already in hand.
    //
    // What stops a dead environment reading as steady progress is that the
    // seat mark only moves on the day roll, and the cost mark only on the few
    // runs a day that are due to ask about the bill at all. On a five-minute
    // schedule that is four runs out of two hundred and eighty-eight; the rest
    // hand back the incoming cursor string verbatim, which the worker reads as
    // no progress and fails. The signal is weaker than it was when nothing but
    // the day roll moved these marks, and it still holds. `refusesNextLink`
    // still fails or warns exactly as it did, because there the transcript
    // cursor is what moved.
    const moved = transcriptMoved || costMoved || seatsMoved;

    return {
      events: walk.events,
      // The INCOMING string verbatim when nothing moved, never a re-encoding
      // of it. The worker decides whether a run that reported errors made
      // progress by comparing these two strings, and re-encoding an unchanged
      // position yields a different string — the cost fields now spelled out
      // — which it would read as an advance and persist. That is the whole
      // reason this is a string comparison and not a deep one.
      cursor: moved
        ? encodeCursor({ transcript: advanced, cost, seats })
        : options.cursor,
      errorCount: walk.errorCount,
    };
  }

  /**
   * The environment's daily bill, or nothing at all.
   *
   * NEVER throws and NEVER counts an error, and that is the whole contract.
   * `assertRunMadeProgress` in the worker turns any error count with an
   * unmoved cursor into a failed run whose events are DISCARDED — so a cost
   * read that reported a failure would throw away the conversations this
   * source exists to collect. Modelled on `fetchBots`, which degrades the same
   * way and for the same reason.
   *
   * A failure is a HOLD rather than a zero. Being throttled, or unable to
   * reach Azure, says nothing about what the window cost; recording zero for
   * it would be a confident wrong number that the summarizing step would
   * faithfully honour over a real figure.
   */
  private async readAzureCost(params: {
    config: CopilotStudioDataverseConfig;
    options: PullRunOptions;
    previous: {
      pricedThroughDay: string | null;
      heldSinceMs: number | null;
      readAtMs: number | null;
    };
  }): Promise<{
    events: NormalizedPullEvent[];
    cost: {
      pricedThroughDay: string | null;
      heldSinceMs: number | null;
      readAtMs: number | null;
    };
  }> {
    const { config, options, previous } = params;
    const subscriptionId = config.azureSubscriptionId;
    // Opt-in. Without a subscription there is no bill to read and no second
    // permission grant to ask the customer for.
    if (!subscriptionId) return { events: [], cost: previous };

    // The bill is read with its own registered app or not at all (ADR-128
    // §21.1). Falling back to the bot's credential here would quietly
    // re-create the one broad grant the split exists to break — and would do
    // it precisely for the customer who declined to hand out billing access.
    const billingClientId = options.credentials?.billingClientId;
    const billingClientSecret = options.credentials?.billingClientSecret;
    if (!billingClientId || !billingClientSecret) {
      return { events: [], cost: previous };
    }

    const nowMs = Date.now();
    // Neither of the two skips above and below is a failed read. Azure
    // publishes this bill once a day and refuses a caller that asks too often,
    // so a source on a five-minute schedule that asked every run would be
    // throttled into never reading it at all. Handing back the position
    // untouched leaves the hold anchored where it was and leaves the decision
    // to give up to a run that actually asked.
    if (!azureCostReadIsDue({ nowMs, readAtMs: previous.readAtMs })) {
      return { events: [], cost: previous };
    }
    const held = () => ({
      events: [],
      cost: nextAzureCostCursor({ nowMs, previous, outcome: "held" as const }),
    });

    try {
      const token = await resolveEnvironmentToken({
        // Same tenant, different registered app: the billing identity holds
        // Cost Management Reader and nothing an employee ever typed.
        credentials: {
          tenantId: options.credentials?.tenantId ?? "",
          clientId: billingClientId,
          clientSecret: billingClientSecret,
        },
        environmentUrl: config.environmentUrl,
        scope: AZURE_MANAGEMENT_SCOPE,
        signal: options.signal,
      });

      const window = azureCostReadWindow({
        nowMs,
        pricedThroughDay: previous.pricedThroughDay,
      });
      const days = await this.fetchAzureCostPages({
        subscriptionId,
        token,
        window,
        options,
      });
      if (days === null) return held();

      return {
        events: azureCostEvents({ days, subscriptionId }),
        cost: nextAzureCostCursor({ nowMs, previous, outcome: "priced" }),
      };
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "copilot studio dataverse: could not read the Azure bill; holding the window and delivering the conversations",
      );
      return held();
    }
  }

  /**
   * Every page of one cost read, or null when the window could not be read.
   *
   * Null rather than an empty list, because the two mean opposite things: an
   * empty list is "Azure says this window cost nothing", which is a real
   * answer, and null is "we could not ask", which must hold the window.
   *
   * A page that fails abandons the WHOLE read rather than keeping the pages
   * before it. A half-read window would be emitted as if complete, and since
   * a re-read replaces rather than adds, the missing meters' days would be
   * left showing whatever they showed before with nothing saying they are
   * stale.
   */
  private async fetchAzureCostPages(params: {
    subscriptionId: string;
    token: string;
    window: { fromDay: string; toDay: string };
    options: PullRunOptions;
  }): Promise<ReturnType<typeof readAzureCostRows>["days"] | null> {
    const { subscriptionId, token, window, options } = params;
    const days: ReturnType<typeof readAzureCostRows>["days"] = [];

    let url: string | null =
      `https://${AZURE_MANAGEMENT_HOST}/subscriptions/${encodeURIComponent(subscriptionId)}` +
      `/providers/Microsoft.CostManagement/query?api-version=${AZURE_COST_API_VERSION}`;
    let pageCount = 0;

    // The run's deadline and abort signal are read in the loop's own condition
    // rather than inside its body, so that leaving the loop always means the
    // same thing: a page is still owed, and the window is held.
    while (url && pageCount < MAX_PAGES_PER_RUN && !runIsOver(options)) {
      pageCount += 1;

      const page = await this.readAzureCostPage({
        url,
        token,
        window,
        options,
        subscriptionId,
      });
      if (page === null) return null;
      days.push(...page.days);

      if (page.nextLink === null) return days;

      const next = this.azureCostNextPageUrl({
        nextLink: page.nextLink,
        subscriptionId,
      });
      if (next === null) return null;
      url = next;
    }

    // Fell out of the loop with a page still owed — the page cap, the run's
    // deadline, or the abort signal. Same reasoning as the refused link: a
    // partial window is not a priced one.
    logger.warn(
      { pageCount, subscriptionId },
      "copilot studio dataverse: the Azure cost read ran out of run before it ran out of pages; holding the window",
    );
    return null;
  }

  /**
   * Ask Azure for one page of the cost window and read it.
   *
   * Returns null for every refusal — an HTTP one, or a body that is not the
   * shape this reads — because they all mean the same thing to the caller:
   * the window is held for the next run.
   */
  private async readAzureCostPage(params: {
    url: string;
    token: string;
    window: { fromDay: string; toDay: string };
    options: PullRunOptions;
    subscriptionId: string;
  }): Promise<ReturnType<typeof readAzureCostRows> | null> {
    const { url, token, window, options, subscriptionId } = params;

    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const response = await ssrfSafeFetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(azureCostRequestBody(window)),
      signal: options.signal
        ? AbortSignal.any([options.signal, timeout])
        : timeout,
      // Carries a token minted from the customer's secret, so a redirect
      // must not hand it to whoever answers.
      followRedirects: false,
    });

    if (!response.ok) {
      // 429 is ordinary operation here, not an exception: the very first
      // real request against a live subscription was throttled. Every
      // refusal holds the window either way — the next scheduled run is the
      // retry, and sleeping in place would burn this run's deadline and
      // risk it being killed holding the transcripts it already read.
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
      // An HTTP 200 whose body is not the shape this reads. Held, not
      // recorded: taken as an empty window it would read as a genuinely
      // free week and be marked priced, which is the exact confusion the
      // row-level count below exists to prevent one level down.
      logger.warn(
        { subscriptionId },
        "copilot studio dataverse: Azure answered the cost read with an unrecognised body; holding the window for the next run",
      );
      return null;
    }

    if (read.unreadableRows > 0) {
      // Counted here and nowhere else. It must never reach the run's own
      // error count, which would cost the run its conversations.
      logger.warn(
        { unreadableRows: read.unreadableRows, subscriptionId },
        "copilot studio dataverse: some Azure cost rows could not be read; the rest of the window is recorded",
      );
    }

    return read;
  }

  /**
   * Accept the next-page link only if Azure Resource Manager itself served it.
   *
   * The link arrives inside a reply and is followed carrying the ARM bearer
   * token, so the host is decided by parsing rather than by comparing text.
   * Text comparison can be correct and still be fragile: a prefix ending in a
   * slash does pin the host, because a URL's authority ends at its first
   * slash — but only for exactly as long as nobody tidies the slash away, and
   * nothing about the string says it is load-bearing. Parsing states the rule
   * it means and cannot be edited into a weaker one by accident.
   *
   * A next page the run will not follow means the window was read in part, and
   * a partial window must never be reported as priced: the meters that live on
   * the pages behind it would keep their previous figures with nothing marking
   * them stale. Null instead, so the next run asks again from the top.
   */
  private azureCostNextPageUrl(params: {
    nextLink: string;
    subscriptionId: string;
  }): string | null {
    const { nextLink, subscriptionId } = params;

    if (!isAzureResourceManagerUrl(nextLink)) {
      // The refused link carries the ARM token if followed. Logged like the
      // transcript walk's own refusal, because a silent stall here is
      // indistinguishable from a permissions problem.
      logger.error(
        { refusedHost: hostOf(nextLink), subscriptionId },
        "copilot studio dataverse: refusing an Azure cost next-page link that is not Azure Resource Manager; holding the window",
      );
      return null;
    }

    return nextLink;
  }

  /**
   * The tenant's seat licences, or nothing at all.
   *
   * The same contract as `readAzureCost` and for the same reason: it NEVER
   * throws and NEVER counts an error. An error count against an unmoved cursor
   * is what `assertRunMadeProgress` fails a run on, and it discards the run
   * WHOLE — so a refused licence read would cost the customer the
   * conversations this source exists to collect.
   *
   * A failure holds the day rather than recording zero. Being refused says
   * nothing about how many seats a tenant holds, and a zero would be a
   * confident wrong number that everything reading it downstream would honour
   * over a real one.
   */
  private async readMicrosoftSeats(params: {
    config: CopilotStudioDataverseConfig;
    options: PullRunOptions;
    previous: { reportedThroughDay: string | null; heldSinceMs: number | null };
  }): Promise<{
    events: NormalizedPullEvent[];
    seats: { reportedThroughDay: string | null; heldSinceMs: number | null };
  }> {
    const { config, options, previous } = params;

    // Neither of the two skips below is a hold. Nothing was attempted, so
    // there is nothing to hold: the position is handed back untouched, which
    // is also what keeps `seatsMoved` false on a run whose only progress was
    // elsewhere.
    if (!config.readSeats) return { events: [], seats: previous };

    const nowMs = Date.now();
    const due = seatsReadIsDue({
      nowMs,
      reportedThroughDay: previous.reportedThroughDay,
    });
    if (!due) return { events: [], seats: previous };

    const held = () => ({
      events: [],
      seats: nextSeatsCursor({ nowMs, previous, outcome: "held" as const }),
    });

    try {
      const token = await resolveEnvironmentToken({
        credentials: options.credentials,
        environmentUrl: config.environmentUrl,
        scope: MICROSOFT_GRAPH_SCOPE,
        signal: options.signal,
      });

      const read = await this.fetchSubscribedSkus({ token, options });
      if (read === null) return held();

      return {
        events: microsoftSeatEvents({
          skus: read.skus,
          day: seatsReportDay({ nowMs }),
        }),
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

  /**
   * The one read of the tenant's licence pools, or null when it could not be
   * read.
   *
   * One request and no page loop. `/v1.0/subscribedSkus` answers with the
   * whole list — it publishes no next link and documents `$top` as ignored —
   * so unlike the cost read there is no half-read list to guard against.
   *
   * Null rather than an empty list, because the two mean opposite things: an
   * empty list is "this tenant holds no licences", which is a real answer, and
   * null is "we could not ask", which holds the day.
   */
  private async fetchSubscribedSkus(params: {
    token: string;
    options: PullRunOptions;
  }): Promise<ReturnType<typeof readSubscribedSkuRows> | null> {
    const { token, options } = params;

    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const response = await ssrfSafeFetch(
      "https://graph.microsoft.com/v1.0/subscribedSkus",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        signal: options.signal
          ? AbortSignal.any([options.signal, timeout])
          : timeout,
        // Carries a token minted from the customer's secret, so a redirect
        // must not hand it to whoever answers.
        followRedirects: false,
      },
    );

    if (!response.ok) {
      // A 403 is the ordinary shape of "the consent was never granted", and it
      // is worth saying so by name: every other reading of a 403 sends an
      // admin to check a role assignment that was never the problem.
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
      // An HTTP 200 whose body is not the shape this reads. Held, not
      // recorded: taken as an empty list it would publish a tenant that holds
      // no licences at all and mark the day reported.
      logger.warn(
        "copilot studio dataverse: Microsoft Graph answered the licence read with an unrecognised body; holding the day",
      );
      return null;
    }

    if (read.unreadableRows > 0) {
      // Counted here and nowhere else. It must never reach the run's own error
      // count, which would cost the run its conversations.
      logger.warn(
        { unreadableRows: read.unreadableRows },
        "copilot studio dataverse: some licence pools could not be read; the rest of the list is recorded",
      );
    }

    if (read.skus.length === 0 && read.unreadableRows > 0) {
      // Nothing survived the read. The same reasoning the malformed body gets
      // above, one level down: a list that yielded no pool and a tenant that
      // holds no licences arrive as the same empty list, and reporting the day
      // publishes the second answer for the first — permanently, because a day
      // already marked reported is never asked about again.
      //
      // Only when NOTHING was read. A list that yielded some pools is recorded
      // as it stands, because one bad pool must not cost the tenant the rest.
      logger.warn(
        { unreadableRows: read.unreadableRows },
        "copilot studio dataverse: no licence pool in Microsoft Graph's reply could be read; holding the day",
      );
      return null;
    }

    return read;
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
      cursor: parseCursor(options.cursor).transcript,
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

    try {
      const page = await this.fetchBotsPage({ environmentUrl, token, signal });
      if (!page) return new Map();

      const bots = readBotRows(page.value);
      warnAboutIncompleteBotList({
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
    return odataPageSchema.parse(await response.json());
  }
}
