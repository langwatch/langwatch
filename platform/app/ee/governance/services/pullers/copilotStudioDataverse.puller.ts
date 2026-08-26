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
 * replay. The `$expand`ed bot row rides along on the same object.
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
  })
  .passthrough();

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
      "conversationtranscriptid,name,conversationstarttime,createdon,content,metadata,schematype,schemaversion",
    ],
    ["$filter", filters.join(" and ")],
    ["$orderby", "createdon asc,conversationtranscriptid asc"],
    ["$top", String(PAGE_SIZE)],
    // The agent's name and current settings ride along on the row rather than
    // costing a second read per conversation.
    ["$expand", "bot_conversationtranscriptid($select=name,modifiedon)"],
  ];
  return `${base}?${query
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&")}`;
}

function botFactsOf(row: Record<string, unknown>): Record<string, string> {
  const bot = row.bot_conversationtranscriptid;
  if (!bot || typeof bot !== "object") return {};
  const record = bot as Record<string, unknown>;
  const facts: Record<string, string> = {};
  if (typeof record.name === "string") facts.botName = record.name;
  if (typeof record.modifiedon === "string") {
    facts.botModifiedOn = record.modifiedon;
  }
  return facts;
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
    const cursor = parseCursor(options.cursor);
    const events: NormalizedPullEvent[] = [];
    let errorCount = 0;
    let nextCursor: string | null = null;

    try {
      const token = await resolveEnvironmentToken({
        credentials: options.credentials,
        environmentUrl: config.environmentUrl,
        signal: options.signal,
      });

      let url: string | null = buildFirstPageUrl({
        environmentUrl: config.environmentUrl,
        config,
        cursor,
        now: Date.now(),
      });
      let last: Cursor | null = null;
      let pageCount = 0;

      while (url && pageCount < MAX_PAGES_PER_RUN) {
        pageCount += 1;
        if (options.signal?.aborted) break;
        if (options.deadlineMs && Date.now() > options.deadlineMs) {
          // Stop cleanly and keep what this run already read. The next run
          // resumes from `last` rather than repeating the whole window.
          break;
        }

        const page = await this.fetchPage({
          url,
          token,
          signal: options.signal,
        });
        for (const raw of page.value) {
          if (!raw || typeof raw !== "object") continue;
          const parsed = transcriptRowSchema.safeParse(raw);
          if (!parsed.success) {
            // A row shaped unlike the rest is counted, not fatal: one bad row
            // must not cost the whole window.
            errorCount += 1;
            continue;
          }
          const row = parsed.data;
          // A row with no `createdon` keeps the previous row's, so the cursor
          // never goes backwards and never lands on an empty timestamp that
          // the next run's filter would read as "everything".
          const previousCreatedOn: string = last ? last.createdon : "";
          last = {
            createdon: row.createdon ?? previousCreatedOn,
            conversationtranscriptid: row.conversationtranscriptid,
          };
          events.push({
            source_event_id: row.conversationtranscriptid,
            event_timestamp:
              row.conversationstarttime ??
              row.createdon ??
              new Date().toISOString(),
            // Attribution lives on the turns inside the transcript, where the
            // account identifier actually is. A row has no single author.
            actor: "",
            action: COPILOT_CONVERSATION_ACTION,
            target: botFactsOf(raw as Record<string, unknown>).botName ?? "",
            cost_usd: "0",
            tokens_input: 0,
            tokens_output: 0,
            raw_payload: JSON.stringify(row),
            extra: botFactsOf(raw as Record<string, unknown>),
          });
        }

        const nextLink = page["@odata.nextLink"] ?? null;
        // The next page is a URL out of the response body, and the request
        // that follows it carries the access token. `followRedirects: false`
        // stops the server bouncing the credential somewhere else, and this
        // is the same hop by another name — the host allowlist has to hold
        // for every request that carries the secret, not only the first.
        if (nextLink && !isDataverseEnvironmentOrigin(nextLink)) {
          errorCount += 1;
          logger.error(
            "copilot studio dataverse: refusing a next-page link outside the environment host",
          );
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

      // Only advance past rows this run actually read. A run that read
      // nothing leaves the cursor alone so the same window is retried.
      nextCursor = last?.createdon ? JSON.stringify(last) : options.cursor;
    } catch (error) {
      errorCount += 1;
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "copilot studio dataverse pull failed",
      );
      // The cursor is deliberately not advanced: the next run retries the
      // same window, and re-reading is safe because identifiers are derived
      // from the conversation rather than minted per pull.
      return { events, cursor: options.cursor, errorCount };
    }

    return { events, cursor: nextCursor, errorCount };
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
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "OData-MaxVersion": "4.0",
        "OData-Version": "4.0",
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
    return pageSchema.parse(await response.json());
  }
}
