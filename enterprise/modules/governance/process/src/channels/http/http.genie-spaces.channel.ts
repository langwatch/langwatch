// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The Genie space list as an agent listing, and the one authenticated GET the
 * SCIM listing shares. The walk itself lives in `genie-spaces.rules.ts`, where
 * the scheduled sweep takes it with its own budget-aware page reader.
 */

import type { GovernanceHttpClient } from "../../app/governance.members.ts";
import {
  type AgentListing,
  agentsListed,
  agentsRefused,
  refusalFromStatus,
  refusalFromThrown,
} from "../../rules/agent-listing.rules.ts";
import {
  GENIE_SPACES_PATH,
  genieSpacesAsAgents,
  walkGenieSpaces,
} from "../../rules/genie-spaces.rules.ts";
import type { GenieSpacesChannel } from "../genie-spaces.channel.ts";

/**
 * Per-request bound for a listing done on demand. Shorter than the sweep's,
 * because a person is watching this one rather than a cron.
 */
const LISTING_TIMEOUT_MS = 15_000;

/**
 * Pages one on-demand listing will follow.
 *
 * A workspace holds tens of spaces, not thousands, so reaching this bound says
 * something is wrong rather than that the workspace is large. A listing that
 * hits it refuses: the screen it feeds claims to list the organization's
 * agents, and a subset presented as that set is a wrong answer rather than a
 * partial one.
 */
const LISTING_MAX_PAGES = 20;

const LISTING_PAGE_SIZE = 100;

/**
 * A Genie call the workspace answered with a status we did not want.
 *
 * Carries the status because callers branch on it: a 404 from the SCIM lookup
 * is a deleted user and permanent, everything else is transient.
 */
export class GenieHttpError extends Error {
  readonly status: number;

  constructor({ status, statusText, path }: { status: number; statusText: string; path: string }) {
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
  /**
   * The process's HTTP client. SSRF policy lives in the adapter behind this
   * seam rather than in a fetch call here, which is why `followRedirects` is
   * passed through rather than enforced locally: a secret-bearing call must
   * not follow a redirect it did not choose.
   */
  http: GovernanceHttpClient;
  workspaceUrl: string;
  token: string;
  path: string;
  query?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs: number;
}): Promise<unknown> {
  const { http, workspaceUrl, token, path, query, signal, timeoutMs } = params;

  const url = new URL(path, workspaceUrl);
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value);
  }

  const timeout = AbortSignal.timeout(timeoutMs);
  const response = await http.fetch(url.toString(), {
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
  return response.json();
}

/**
 * Every Genie space one credential can enumerate. Keeps a workspace with no
 * spaces apart from one that refused to say — the sweep cannot.
 */
export class HttpGenieSpacesChannel implements GenieSpacesChannel {
  private constructor(private readonly http: GovernanceHttpClient) {}

  static create({ http }: { http: GovernanceHttpClient }): HttpGenieSpacesChannel {
    return new HttpGenieSpacesChannel(http);
  }

  async listAgents(params: {
    workspaceUrl: string;
    token: string;
    signal?: AbortSignal;
  }): Promise<AgentListing> {
    return listGenieAgents({ http: this.http, ...params });
  }
}

async function listGenieAgents(params: {
  http: GovernanceHttpClient;
  workspaceUrl: string;
  token: string;
  signal?: AbortSignal;
}): Promise<AgentListing> {
  const { http, workspaceUrl, token, signal } = params;
  let pages = 0;

  try {
    const walk = await walkGenieSpaces({
      readPage: (query) =>
        genieGet({
          http,
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
    // `complete` false means the page bound cut the walk short, so spaces
    // exist that this read never saw. The same reasoning as the Copilot
    // inventory: a screen claiming to list the organization's agents cannot
    // show a subset as the whole set, and the next Sync would walk the same
    // pages and stop in the same place, so repeating the action cannot
    // uncover them.
    if (!walk.complete) {
      return agentsRefused({ reason: "too_many_pages", status: null });
    }

    return agentsListed(genieSpacesAsAgents({ spaces: walk.spaces, workspaceUrl }));
  } catch (error) {
    if (error instanceof GenieHttpError) {
      return agentsRefused(refusalFromStatus(error.status));
    }
    return agentsRefused(refusalFromThrown(error));
  }
}
