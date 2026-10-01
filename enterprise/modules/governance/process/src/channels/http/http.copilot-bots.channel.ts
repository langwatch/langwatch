// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The `bot` table read: one request, two callers.
 *
 * The transcript walk reads this to put a name on each conversation, and the
 * on-demand agent listing reads it to write the agents down. Same request,
 * same `$select`, same schema, same redirect policy — so the request lives
 * here once and both callers take it.
 *
 * The one thing they must NOT share is what a refusal costs. For the walk a
 * name is a nicety and an error would be catastrophic: a non-zero error count
 * with an unmoved cursor makes the worker discard the run's events, so a
 * failure to name the agents would stop the source collecting conversations at
 * all. For the listing a refusal is the answer. Returning a value that names
 * which case it is lets each caller pay the price it can afford, which is why
 * this function neither throws nor logs — the caller does both, or neither.
 */

import { z } from "zod";

import type { GovernanceHttpClient } from "../../app/governance.members.ts";
import {
  type AgentListing,
  type AgentListingRefusal,
  agentsListed,
  agentsRefused,
  type DiscoveredAgentRecord,
  refusalFromStatus,
  refusalFromThrown,
} from "../../rules/agent-listing.rules.ts";
import {
  DATAVERSE_API_VERSION,
  dataverseHeaders,
  isEnvironmentOrigin,
} from "../../rules/dataverse-environment-service.rules.ts";
import type { CopilotBotsChannel, CopilotBotsRead } from "../copilot-bots.channel.ts";

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * How many agents one request asks for.
 *
 * A page size, not a ceiling: the two callers differ on what to do when a
 * second page exists. The transcript walk stops and says so in the log, because
 * a missing name costs it a nicety. The inventory follows every page, because
 * for a screen claiming to list the organization's agents a truncated list is
 * not a lesser answer, it is a wrong one.
 */
const MAX_BOTS = 500;

/**
 * How many pages one inventory walk will follow.
 *
 * A bound rather than a `while`: a provider that echoes the same
 * `@odata.nextLink` back would otherwise loop until the request budget or the
 * process died, and that shape has already been seen in a paging reply.
 */
export const MAX_BOT_PAGES = 40;

/**
 * Whether a continuation URL points at the same environment that was asked.
 *
 * An unparseable URL is not the same origin, which is the safe direction: the
 * caller stops rather than sending the token somewhere it cannot check.
 */
function isSameOrigin(candidate: string, environmentUrl: string): boolean {
  try {
    return new URL(candidate).origin === new URL(environmentUrl).origin;
  } catch {
    return false;
  }
}

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
export interface BotRecord {
  botName?: string;
  botModifiedOn?: string;
}

/**
 * Dataverse writes lookup ids in one case and there is no promise both sides of
 * a join agree on it, so the key is folded before it is stored or read. A miss
 * here is silent — a conversation with no agent name — which is exactly the
 * kind of fault that survives a review.
 */
export function botKey(id: string): string {
  return id.toLowerCase();
}

/** The agents on one page of the `bot` table, keyed by folded lookup id. */
export function readBotRows(rows: unknown[]): Map<string, BotRecord> {
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

async function readCopilotBots(params: {
  http: GovernanceHttpClient;
  environmentUrl: string;
  token: string;
  signal?: AbortSignal;
  /**
   * Walk `@odata.nextLink` to the end instead of reading one page.
   *
   * Off by default, because the transcript walk wants one page: it names bots
   * it already saw in a transcript and a second page buys it nothing. The
   * inventory needs every page, and asking for it explicitly is what keeps
   * that difference visible at both call sites rather than hidden in here.
   */
  shouldFollowPages?: boolean;
}): Promise<CopilotBotsRead> {
  const { http, environmentUrl, token, signal, shouldFollowPages = false } = params;

  // The same rule the adapter's validateConfig runs, applied here because this
  // read is reached without it: the listing path safeParses the config schema,
  // and that schema accepts any URL. A plain http address would put the bearer
  // token on the wire in clear, and a host outside Power Platform would put it
  // somewhere Microsoft does not serve. Checked before the URL is built rather
  // than after, so no request is ever assembled around it.
  if (!isEnvironmentOrigin(environmentUrl)) {
    return {
      ok: false,
      refusal: { reason: "not_configured", status: null },
    };
  }

  const base = `${environmentUrl.replace(/\/+$/, "")}/api/data/${DATAVERSE_API_VERSION}/bots`;
  const query = `$select=${encodeURIComponent("botid,name,modifiedon")}&$top=${MAX_BOTS}`;

  const rows: unknown[] = [];
  let url = `${base}?${query}`;

  for (let page = 0; page < MAX_BOT_PAGES; page++) {
    const read = await readBotPage({ http, url, token, signal });
    if (!read.ok) return read;
    rows.push(...read.rows);

    const next = read.next;
    if (!next) return { ok: true, rows, hasMorePages: false };
    if (!shouldFollowPages) return { ok: true, rows, hasMorePages: true };

    // The continuation URL comes from the response body, and the next request
    // carries the token. A link pointing anywhere but this environment would
    // hand the credential to whoever answers, so an off-origin one is treated
    // as a reply that was not the documented shape rather than followed.
    if (!isSameOrigin(next, environmentUrl)) {
      return {
        ok: false,
        refusal: { reason: "malformed_response", status: null },
      };
    }
    url = next;
  }

  // The page budget is spent. A provider that keeps handing back a
  // continuation link this long is either enormous or echoing the same one
  // back, and neither can be reported as a finished inventory.
  return { ok: true, rows, hasMorePages: true };
}

/** One page of the collection, or the reason there is none. */
type CopilotBotPage =
  | { ok: true; rows: unknown[]; next: string | undefined }
  | { ok: false; refusal: AgentListingRefusal };

async function readBotPage(params: {
  http: GovernanceHttpClient;
  url: string;
  token: string;
  signal?: AbortSignal;
}): Promise<CopilotBotPage> {
  const { http, url, token, signal } = params;
  // Re-armed per request rather than shared across the walk: one budget
  // spanning every page would abort a healthy later page for the time the
  // earlier ones spent.
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);

  try {
    const response = await http.fetch(url, {
      method: "GET",
      headers: dataverseHeaders(token),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      // Same reasoning as the transcript read: this request carries the token,
      // and a redirect would hand it to whoever answers.
      followRedirects: false,
    });

    if (!response.ok) {
      return { ok: false, refusal: refusalFromStatus(response.status) };
    }
    const parsed = odataPageSchema.parse(await response.json());
    return {
      ok: true,
      rows: parsed.value,
      next: parsed["@odata.nextLink"],
    };
  } catch (error) {
    return { ok: false, refusal: refusalFromThrown(error) };
  }
}

/** Copilot Studio bots as `DiscoveredAgent` rows. */
export function copilotBotsAsAgents(params: {
  rows: unknown[];
  environmentUrl: string;
}): DiscoveredAgentRecord[] {
  const agents: DiscoveredAgentRecord[] = [];
  for (const raw of params.rows) {
    const parsed = botRowSchema.safeParse(raw);
    if (!parsed.success) continue;
    const row = parsed.data;
    const modifiedOn = row.modifiedon?.trim() ?? "";
    agents.push({
      // NOT folded, unlike the join key. `rawAgentId` is the provider's own id
      // verbatim, and it is what a later job would hand back to Dataverse.
      rawAgentId: row.botid,
      // The id is the fallback rather than a blank. An agent whose name the
      // environment withheld still has to render as something findable.
      displayText: row.name?.trim() ? row.name.trim() : row.botid,
      metadata: {
        environmentUrl: params.environmentUrl,
        // Omitted rather than blanked when the row did not carry it, because
        // the repository merges metadata and an absent key keeps what is there.
        ...(modifiedOn === "" ? {} : { modifiedOn }),
      },
    });
  }
  return agents;
}

async function listCopilotAgents(params: {
  http: GovernanceHttpClient;
  environmentUrl: string;
  token: string;
  signal?: AbortSignal;
}): Promise<AgentListing> {
  const read = await readCopilotBots({ ...params, shouldFollowPages: true });
  if (!read.ok) return agentsRefused(read.refusal);

  // An inventory that is missing agents must not read as the inventory. Every
  // later press of Sync would start at the same first page, so the absent ones
  // are undiscoverable by repeating the action, and a screen showing a subset
  // as the whole set is worse than one saying it could not enumerate.
  if (read.hasMorePages) {
    return agentsRefused({ reason: "too_many_pages", status: null });
  }

  return agentsListed(
    copilotBotsAsAgents({
      rows: read.rows,
      environmentUrl: params.environmentUrl,
    }),
  );
}

/**
 * The `bot` table over the process's HTTP client. `listAgents` keeps an
 * environment with no agents apart from one that refused to say; the
 * transcript walk cannot, and that distinction is what the listing is for.
 */
export class HttpCopilotBotsChannel implements CopilotBotsChannel {
  private constructor(private readonly http: GovernanceHttpClient) {}

  static create({ http }: { http: GovernanceHttpClient }): HttpCopilotBotsChannel {
    return new HttpCopilotBotsChannel(http);
  }

  async readBots(params: {
    environmentUrl: string;
    token: string;
    signal?: AbortSignal;
    shouldFollowPages?: boolean;
  }): Promise<CopilotBotsRead> {
    return readCopilotBots({ http: this.http, ...params });
  }

  async listAgents(params: {
    environmentUrl: string;
    token: string;
    signal?: AbortSignal;
  }): Promise<AgentListing> {
    return listCopilotAgents({ http: this.http, ...params });
  }
}
