// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The Genie space list: one read, two callers.
 *
 * The scheduled sweep enumerates spaces to know what to walk, and the on-demand
 * agent listing enumerates the same spaces to write them down as agents. Those
 * are different jobs with different budgets, but they are the same request
 * against the same endpoint with the same schema and the same redirect policy,
 * and a second copy of any of that is a copy that drifts. So the walk lives
 * here once and takes its page reader from the caller: the sweep passes the
 * budget-aware `get` it already had, the listing passes a plain bounded read.
 *
 * What is deliberately NOT shared is when to stop. The sweep stops on a request
 * budget it carries across runs; the listing stops on a page cap, because it
 * runs while somebody is waiting for it.
 */

import { z } from "zod";

import { ssrfSafeFetch } from "~/utils/ssrfProtection";
import {
  type AgentListing,
  agentsListed,
  agentsRefused,
  type DiscoveredAgentRecord,
  refusalFromStatus,
  refusalFromThrown,
} from "./agentListing";

export const GENIE_SPACES_PATH = "/api/2.0/genie/spaces";

/**
 * Per-request bound for a listing done on demand. Shorter than the sweep's,
 * because a person is watching this one rather than a cron.
 */
const LISTING_TIMEOUT_MS = 15_000;

/**
 * Pages one on-demand listing will follow. A workspace holds tens of spaces,
 * not thousands, so this is a ceiling rather than a page size — and a listing
 * that hit it still reports what it read, because a truncated list of real
 * agents is worth more to the screen than a refusal.
 */
const LISTING_MAX_PAGES = 20;

const LISTING_PAGE_SIZE = 100;

export const spaceSchema = z
  .object({
    space_id: z.string(),
    title: z.string().nullable().default(null),
  })
  .passthrough();

export type GenieSpace = z.infer<typeof spaceSchema>;

export const spacesPageSchema = z.object({
  spaces: z.array(spaceSchema).default([]),
  next_page_token: z.string().nullable().default(null),
});

/**
 * A Genie call the workspace answered with a status we did not want.
 *
 * Carries the status because callers branch on it: a 404 from the SCIM lookup
 * is a deleted user and permanent, everything else is transient.
 */
export class GenieHttpError extends Error {
  readonly status: number;

  constructor({
    status,
    statusText,
    path,
  }: {
    status: number;
    statusText: string;
    path: string;
  }) {
    super(`HTTP ${status} ${statusText} (databricks genie ${path})`);
    this.name = "GenieHttpError";
    this.status = status;
  }
}

/**
 * One authenticated GET against a workspace.
 *
 * The redirect policy is the load-bearing part: the workspace host is pinned on
 * the write path, but a redirect from a real workspace would still carry this
 * token onward, and the helper follows up to ten by default.
 */
export async function genieGet(params: {
  workspaceUrl: string;
  token: string;
  path: string;
  query?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs: number;
}): Promise<unknown> {
  const { workspaceUrl, token, path, query, signal, timeoutMs } = params;

  const url = new URL(path, workspaceUrl);
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value);
  }

  const timeout = AbortSignal.timeout(timeoutMs);
  const response = await ssrfSafeFetch(url.toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    followRedirects: false,
  });
  if (!response.ok) {
    throw new GenieHttpError({
      status: response.status,
      statusText: response.statusText,
      path,
    });
  }
  return await response.json();
}

/**
 * Walks `/api/2.0/genie/spaces` through a page reader the caller owns.
 *
 * `complete` is false when `stop` cut the walk short, which is the same signal
 * the sweep's `PagedRead` carries: a truncated list has no trustworthy position
 * in it, so the sweep restarts from the top rather than resuming into it.
 *
 * The repeated-token check is not defensive tidiness. A server that hands back
 * a token it already served would otherwise spin this loop until the deadline,
 * spending the whole run on one endpoint.
 */
export async function walkGenieSpaces(params: {
  /** Reads one page. Throws on failure; the caller decides what that costs. */
  readPage: (query: Record<string, string>) => Promise<unknown>;
  /** Asked before every page. True stops the walk and marks it incomplete. */
  stop: () => boolean;
  pageSize: number;
}): Promise<{ spaces: GenieSpace[]; complete: boolean }> {
  const { readPage, stop, pageSize } = params;
  const spaces: GenieSpace[] = [];
  let page: string | null = null;
  const seen = new Set<string>();

  for (;;) {
    if (stop()) return { spaces, complete: false };

    const parsed = spacesPageSchema.parse(
      await readPage({
        page_size: String(pageSize),
        ...(page ? { page_token: page } : {}),
      }),
    );
    spaces.push(...parsed.spaces);

    if (parsed.next_page_token === null) return { spaces, complete: true };
    if (seen.has(parsed.next_page_token)) {
      throw new Error(
        `databricks genie ${GENIE_SPACES_PATH} returned a page_token it had already served; refusing to re-read pages in a cycle`,
      );
    }
    seen.add(parsed.next_page_token);
    page = parsed.next_page_token;
  }
}

/**
 * The workspace host a space belongs to, for the agent row's metadata.
 *
 * The host rather than the configured URL: two sources pointed at the same
 * workspace through addresses that differ only in a trailing slash would
 * otherwise write two different metadata values for the same agent.
 */
function workspaceHostOf(workspaceUrl: string): string {
  try {
    return new URL(workspaceUrl).host;
  } catch {
    return "";
  }
}

/** Genie spaces as `DiscoveredAgent` rows. */
export function genieSpacesAsAgents(params: {
  spaces: GenieSpace[];
  workspaceUrl: string;
}): DiscoveredAgentRecord[] {
  const workspaceHost = workspaceHostOf(params.workspaceUrl);
  const metadata: Record<string, string> =
    workspaceHost === "" ? {} : { workspaceHost };
  return params.spaces.map((space) => ({
    rawAgentId: space.space_id,
    // The id is the fallback rather than a blank. A space whose title the
    // workspace withheld still has to render as something a person can find.
    displayText: space.title?.trim() ? space.title.trim() : space.space_id,
    metadata: { ...metadata },
  }));
}

/**
 * Every Genie space one credential can enumerate, as an agent listing.
 *
 * Distinguishes a workspace with no spaces from one that refused to say — the
 * sweep cannot, because for its purposes both mean the same thing.
 */
export async function listGenieAgents(params: {
  workspaceUrl: string;
  token: string;
  signal?: AbortSignal;
}): Promise<AgentListing> {
  const { workspaceUrl, token, signal } = params;
  let pages = 0;

  try {
    const walk = await walkGenieSpaces({
      readPage: (query) =>
        genieGet({
          workspaceUrl,
          token,
          path: GENIE_SPACES_PATH,
          query,
          signal,
          timeoutMs: LISTING_TIMEOUT_MS,
        }),
      stop: () => pages++ >= LISTING_MAX_PAGES,
      pageSize: LISTING_PAGE_SIZE,
    });
    return agentsListed(
      genieSpacesAsAgents({ spaces: walk.spaces, workspaceUrl }),
    );
  } catch (error) {
    if (error instanceof GenieHttpError) {
      return agentsRefused(refusalFromStatus(error.status));
    }
    return agentsRefused(refusalFromThrown(error));
  }
}
