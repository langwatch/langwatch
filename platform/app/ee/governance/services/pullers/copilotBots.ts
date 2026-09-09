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

import { ssrfSafeFetch } from "~/utils/ssrfProtection";
import {
  type AgentListing,
  type AgentListingRefusal,
  agentsListed,
  agentsRefused,
  type DiscoveredAgentRecord,
  refusalFromStatus,
  refusalFromThrown,
} from "./agentListing";
import {
  DATAVERSE_API_VERSION,
  dataverseHeaders,
} from "./dataverseEnvironment";

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * How many agents one read will name. A tenant holds tens of them, not
 * thousands, so this is a ceiling rather than a page size and neither caller
 * follows a second page — the walk says so in the log, and the listing reports
 * what it read, because a truncated list of real agents beats a refusal.
 */
export const MAX_BOTS = 500;

/**
 * One row of the `bot` table, read once per run to put a name on each
 * conversation.
 */
export const botRowSchema = z
  .object({
    botid: z.string(),
    name: z.string().nullable().optional(),
    modifiedon: z.string().nullable().optional(),
  })
  .passthrough();

/** The envelope every OData collection read comes back in. */
export const odataPageSchema = z.object({
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

/**
 * The read itself, answering which of the three things happened rather than
 * throwing or collapsing to an empty list.
 *
 * `hasMorePages` is separate from the rows: the walk warns about it and the
 * listing carries on, and neither can tell a short list from a whole one
 * without being told.
 */
export type CopilotBotsRead =
  | {
      ok: true;
      rows: unknown[];
      hasMorePages: boolean;
    }
  | { ok: false; refusal: AgentListingRefusal };

export async function readCopilotBots(params: {
  environmentUrl: string;
  token: string;
  signal?: AbortSignal;
}): Promise<CopilotBotsRead> {
  const { environmentUrl, token, signal } = params;
  const base = `${environmentUrl.replace(/\/+$/, "")}/api/data/${DATAVERSE_API_VERSION}/bots`;
  const query = `$select=${encodeURIComponent("botid,name,modifiedon")}&$top=${MAX_BOTS}`;
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);

  try {
    const response = await ssrfSafeFetch(`${base}?${query}`, {
      method: "GET",
      headers: dataverseHeaders(token),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      // Same reasoning as the transcript read: this request carries the
      // token, and a redirect would hand it to whoever answers.
      followRedirects: false,
    });

    if (!response.ok) {
      return { ok: false, refusal: refusalFromStatus(response.status) };
    }
    const page = odataPageSchema.parse(await response.json());
    return {
      ok: true,
      rows: page.value,
      hasMorePages: Boolean(page["@odata.nextLink"]),
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

/**
 * Every Copilot Studio agent one credential can see in an environment.
 *
 * Distinguishes an environment with no agents from one that refused to say.
 * The transcript walk cannot, because for its purposes both mean the same
 * thing, and that is exactly the distinction this listing exists to keep.
 */
export async function listCopilotAgents(params: {
  environmentUrl: string;
  token: string;
  signal?: AbortSignal;
}): Promise<AgentListing> {
  const read = await readCopilotBots(params);
  if (!read.ok) return agentsRefused(read.refusal);
  return agentsListed(
    copilotBotsAsAgents({
      rows: read.rows,
      environmentUrl: params.environmentUrl,
    }),
  );
}
