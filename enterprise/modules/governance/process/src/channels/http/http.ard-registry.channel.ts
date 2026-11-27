// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * An ARD v0.91 registry as an agent listing: its manifest, then its search endpoint page by page
 * when the source names one. The registry address is customer input, so every call goes through
 * the governance outbound fence and refuses redirects.
 * Spec: enterprise/modules/governance/specs/cloud-agent-discovery.feature
 */

import {
  type AgentListing,
  agentsListed,
  agentsRefused,
} from "../../features/agents/rules/agent-listing.rules.ts";
import {
  ardEntriesAsAgents,
  type ArdListedEntry,
  ardListedManifestSchema,
  ardListedSearchPageSchema,
  ardManifestUrl,
  isSupportedArdVersion,
} from "../../features/agents/rules/ard-registry-entries.rules.ts";
import {
  refusalFromStatus,
  refusalFromThrown,
} from "../../features/agents/rules/provider-listing.rules.ts";
import type { ArdRegistryChannel } from "../cloud-agent-inventory.channel.ts";
import type { GovernanceHttpClient, GovernanceHttpResponse } from "../governance-http.channel.ts";

const LISTING_TIMEOUT_MS = 15_000;
/** Search pages one listing follows; a registry longer than this refuses rather than lists a subset. */
const MAX_SEARCH_PAGES = 20;
const SEARCH_PAGE_SIZE = 100;

class ArdHttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status} (ard registry)`);
    this.name = "ArdHttpError";
  }
}

export class HttpArdRegistryChannel implements ArdRegistryChannel {
  private constructor(private readonly http: GovernanceHttpClient) {}

  static create({ http }: { http: GovernanceHttpClient }): HttpArdRegistryChannel {
    return new HttpArdRegistryChannel(http);
  }

  async listAgents({
    registryUrl,
    searchUrl,
    bearerToken,
    signal,
  }: {
    registryUrl: string;
    searchUrl?: string;
    bearerToken?: string;
    signal?: AbortSignal;
  }): Promise<AgentListing> {
    let manifestUrl: string;
    try {
      manifestUrl = ardManifestUrl({ registryUrl });
      if (searchUrl) new URL(searchUrl);
    } catch {
      return agentsRefused({ reason: "not_configured", status: null });
    }
    const headers: Record<string, string> = { Accept: "application/json" };
    if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;

    try {
      const manifest = ardListedManifestSchema.parse(
        await this.read({
          url: manifestUrl,
          init: { method: "GET", headers },
          signal,
        }),
      );
      if (!isSupportedArdVersion(manifest.specVersion)) {
        return agentsRefused({ reason: "malformed_response", status: null });
      }
      const entries: ArdListedEntry[] = [...manifest.entries];
      if (searchUrl) {
        const searched = await this.search({ searchUrl, headers, signal });
        if ("outcome" in searched) return searched;
        entries.push(...searched.entries);
      }
      return agentsListed(ardEntriesAsAgents({ entries }));
    } catch (error) {
      if (error instanceof ArdHttpError) return agentsRefused(refusalFromStatus(error.status));
      return agentsRefused(refusalFromThrown(error));
    }
  }

  private async search({
    searchUrl,
    headers,
    signal,
  }: {
    searchUrl: string;
    headers: Record<string, string>;
    signal?: AbortSignal;
  }): Promise<{ entries: ArdListedEntry[] } | AgentListing> {
    const entries: ArdListedEntry[] = [];
    const seenTokens = new Set<string>();
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_SEARCH_PAGES; page++) {
      const body = ardListedSearchPageSchema.parse(
        await this.read({
          url: searchUrl,
          init: {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({
              query: { text: "*" },
              pageSize: SEARCH_PAGE_SIZE,
              ...(pageToken ? { pageToken } : {}),
            }),
          },
          signal,
        }),
      );
      entries.push(...body.results);
      if (!body.pageToken) return { entries };
      if (seenTokens.has(body.pageToken)) {
        return agentsRefused({ reason: "pagination_stalled", status: null });
      }
      seenTokens.add(body.pageToken);
      pageToken = body.pageToken;
    }
    return agentsRefused({ reason: "too_many_pages", status: null });
  }

  private async read({
    url,
    init,
    signal,
  }: {
    url: string;
    init: { method: string; headers: Record<string, string>; body?: string };
    signal?: AbortSignal;
  }): Promise<unknown> {
    const timeout = AbortSignal.timeout(LISTING_TIMEOUT_MS);
    const response: GovernanceHttpResponse = await this.http.fetch(url, {
      ...init,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      followRedirects: false,
    });
    if (!response.ok) throw new ArdHttpError(response.status);
    return response.json();
  }
}
