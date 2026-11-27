// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Vertex AI Agent Engine reasoning engines as an agent listing: one service account sign-in per
 * listing, then every page of every configured project and location.
 * Spec: enterprise/modules/governance/specs/cloud-agent-discovery.feature
 */

import { createPrivateKey, type KeyObject } from "node:crypto";

import type { VertexAgentEngineTarget } from "@langwatch/enterprise-governance-contract";
import { nowEpochMs } from "@langwatch/time";

import {
  type AgentListing,
  agentsListed,
  agentsRefused,
  type DiscoveredAgentRecord,
} from "../../features/agents/rules/agent-listing.rules.ts";
import {
  refusalFromStatus,
  refusalFromThrown,
} from "../../features/agents/rules/provider-listing.rules.ts";
import {
  googleTokenResponseSchema,
  isVertexLocation,
  JWT_BEARER_GRANT_TYPE,
  parseServiceAccountKey,
  reasoningEngineAsAgent,
  reasoningEnginesPageSchema,
  signServiceAccountAssertion,
} from "../../features/agents/rules/vertex-reasoning-engines.rules.ts";
import { REAL_VENDOR_BASES, type VendorBases } from "../../rules/vendor-bases.rules.ts";
import type { VertexAgentEngineChannel } from "../cloud-agent-inventory.channel.ts";
import type { GovernanceHttpClient } from "../governance-http.channel.ts";

const LISTING_TIMEOUT_MS = 15_000;
/** Pages one project and location will follow; a reasoning engine list this long says something is wrong. */
const MAX_PAGES_PER_TARGET = 20;
const PAGE_SIZE = 100;

/** A Google answer with a status we did not want; `invalidGrant` marks a refused assertion. */
class GoogleHttpError extends Error {
  constructor(
    readonly status: number,
    readonly invalidGrant: boolean,
  ) {
    super(`HTTP ${status} (google cloud)`);
    this.name = "GoogleHttpError";
  }
}

class ListingStop extends Error {
  constructor(readonly listing: AgentListing) {
    super("listing stopped");
    this.name = "ListingStop";
  }
}

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export class HttpVertexAgentEngineChannel implements VertexAgentEngineChannel {
  private readonly http: GovernanceHttpClient;
  private readonly tokenBase: string;
  private readonly apiBase: string | undefined;
  private readonly nowSeconds: () => number;

  private constructor(init: {
    http: GovernanceHttpClient;
    tokenBase: string;
    apiBase: string | undefined;
    nowSeconds: () => number;
  }) {
    this.http = init.http;
    this.tokenBase = init.tokenBase;
    this.apiBase = init.apiBase;
    this.nowSeconds = init.nowSeconds;
  }

  /** The token endpoint is `vendorBases.googleOauthToken` + `/token`; `vertexAiApi` replaces the regional host. */
  static create({
    http,
    vendorBases = REAL_VENDOR_BASES,
    nowSeconds = () => Math.floor(nowEpochMs() / 1000),
  }: {
    http: GovernanceHttpClient;
    vendorBases?: VendorBases;
    nowSeconds?: () => number;
  }): HttpVertexAgentEngineChannel {
    return new HttpVertexAgentEngineChannel({
      http,
      tokenBase: withoutTrailingSlash(vendorBases.googleOauthToken),
      apiBase: vendorBases.vertexAiApi ? withoutTrailingSlash(vendorBases.vertexAiApi) : undefined,
      nowSeconds,
    });
  }

  async listAgents({
    serviceAccountJson,
    targets,
    signal,
  }: {
    serviceAccountJson: string;
    targets: VertexAgentEngineTarget[];
    signal?: AbortSignal;
  }): Promise<AgentListing> {
    const key = parseServiceAccountKey({ json: serviceAccountJson });
    if (!key.parsed) return agentsRefused({ reason: "not_configured", status: null });
    let privateKey: KeyObject;
    try {
      privateKey = createPrivateKey(key.key.private_key);
    } catch {
      return agentsRefused({ reason: "not_configured", status: null });
    }
    if (targets.some((target) => !isVertexLocation(target.location))) {
      return agentsRefused({ reason: "not_configured", status: null });
    }

    try {
      const accessToken = await this.exchangeToken({
        clientEmail: key.key.client_email,
        privateKey,
        signal,
      });
      const agents = new Map<string, DiscoveredAgentRecord>();
      for (const target of targets) {
        for (const agent of await this.listTarget({ target, accessToken, signal })) {
          agents.set(agent.rawAgentId, agent);
        }
      }
      return agentsListed([...agents.values()]);
    } catch (error) {
      if (error instanceof ListingStop) return error.listing;
      if (error instanceof GoogleHttpError) {
        if (error.invalidGrant) return agentsRefused({ reason: "unauthorized", status: 400 });
        return agentsRefused(refusalFromStatus(error.status));
      }
      return agentsRefused(refusalFromThrown(error));
    }
  }

  private signalFor(signal: AbortSignal | undefined): AbortSignal {
    const timeout = AbortSignal.timeout(LISTING_TIMEOUT_MS);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
  }

  private async exchangeToken({
    clientEmail,
    privateKey,
    signal,
  }: {
    clientEmail: string;
    privateKey: KeyObject;
    signal?: AbortSignal;
  }): Promise<string> {
    const tokenUrl = `${this.tokenBase}/token`;
    const assertion = signServiceAccountAssertion({
      clientEmail,
      privateKey,
      audience: tokenUrl,
      nowSeconds: this.nowSeconds(),
    });
    const response = await this.http.fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({ grant_type: JWT_BEARER_GRANT_TYPE, assertion }).toString(),
      signal: this.signalFor(signal),
      followRedirects: false,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new GoogleHttpError(
        response.status,
        response.status === 400 && body.includes("invalid_grant"),
      );
    }
    return googleTokenResponseSchema.parse(await response.json()).access_token;
  }

  private async listTarget({
    target,
    accessToken,
    signal,
  }: {
    target: VertexAgentEngineTarget;
    accessToken: string;
    signal?: AbortSignal;
  }): Promise<DiscoveredAgentRecord[]> {
    const { projectId, location } = target;
    const base = this.apiBase ?? `https://${location}-aiplatform.googleapis.com`;
    const path = `/v1/projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(location)}/reasoningEngines`;
    const agents: DiscoveredAgentRecord[] = [];
    const seenTokens = new Set<string>();
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES_PER_TARGET; page++) {
      const url = new URL(`${base}${path}`);
      url.searchParams.set("pageSize", String(PAGE_SIZE));
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const response = await this.http.fetch(url.toString(), {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        signal: this.signalFor(signal),
        followRedirects: false,
      });
      if (!response.ok) throw new GoogleHttpError(response.status, false);
      const body = reasoningEnginesPageSchema.parse(await response.json());
      for (const engine of body.reasoningEngines ?? []) {
        agents.push(reasoningEngineAsAgent({ engine, projectId, location }));
      }
      if (!body.nextPageToken) return agents;
      if (seenTokens.has(body.nextPageToken)) {
        throw new ListingStop(agentsRefused({ reason: "pagination_stalled", status: null }));
      }
      seenTokens.add(body.nextPageToken);
      pageToken = body.nextPageToken;
    }
    throw new ListingStop(agentsRefused({ reason: "too_many_pages", status: null }));
  }
}
