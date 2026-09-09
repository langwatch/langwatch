// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * What a provider answered when it was asked to list its agents.
 *
 * Pure. No I/O and no clock — the per-provider modules do the talking and hand
 * the reply here, the same way `microsoftGraphSeats.ts` sits beside its puller.
 *
 * THREE outcomes, not two, and that is the whole reason this type exists. The
 * scheduled pull reads the agent list only to put a name on a conversation, so
 * it treats a refusal and an empty tenant identically: both mean "no names this
 * run", both are survivable, and `fetchBots` collapses them into an empty Map.
 * That is right for a transcript pull and wrong for everything else. An admin
 * looking at a screen that says the tenant has no agents needs to know whether
 * the provider said so or refused to answer, because one of those is a fact
 * about their tenant and the other is a fact about their credential.
 *
 * A refusal is a VALUE rather than a throw. The callers that must degrade
 * (`fetchBots`, and any pull path) would otherwise have to catch, and a catch
 * is exactly what erased the distinction in the first place.
 */

/** One agent a provider listed, in the shape `DiscoveredAgent` stores. */
export interface DiscoveredAgentRecord {
  /** The provider's own id, verbatim. */
  rawAgentId: string;
  /** Never "": a row that renders as an empty string is worse than an id. */
  displayText: string;
  /**
   * Provider-native descriptive fields, and only the ones this reply actually
   * carried. A field the provider stopped reporting is OMITTED rather than sent
   * as null, because the repository merges these and an absent key is what
   * keeps the last known value (see `recordAgentSighting`).
   */
  metadata: Record<string, string>;
}

/**
 * Why a provider would not list. A code rather than prose, for two reasons: a
 * later job renders the copy, and upstream error bodies can carry credentials
 * and provider payloads, which is the same reason `failureMessage` in
 * `sourcePullStatus.ts` collapses them.
 */
export type AgentListingRefusalReason =
  /** The credential is not permitted to enumerate. 401 and 403. */
  | "unauthorized"
  /** The address named no such collection. 404. */
  | "not_found"
  /** 429. Asking again later is the action. */
  | "rate_limited"
  /** The provider answered, badly. 5xx and anything unmapped. */
  | "unavailable"
  /** Transport failed: DNS, TLS, timeout, abort. */
  | "unreachable"
  /** A 2xx that was not the documented shape. A proxy or a captive portal. */
  | "malformed_response"
  /** The source holds no credential this provider can sign in with. */
  | "not_configured";

export interface AgentListingRefusal {
  reason: AgentListingRefusalReason;
  /** The provider's HTTP status when there was one, for the log and the badge. */
  status: number | null;
}

/**
 * `listed` guarantees at least one agent, `empty` guarantees none, and
 * `refused` carries no agents at all. A caller that wants the rows has to name
 * the refusal arm to get at them, which is the forcing function.
 */
export type AgentListing =
  | { outcome: "listed"; agents: DiscoveredAgentRecord[] }
  | { outcome: "empty"; agents: [] }
  | { outcome: "refused"; refusal: AgentListingRefusal };

/** Picks the `listed`/`empty` arm from what the provider actually returned. */
export function agentsListed(agents: DiscoveredAgentRecord[]): AgentListing {
  return agents.length === 0
    ? { outcome: "empty", agents: [] }
    : { outcome: "listed", agents };
}

export function agentsRefused(refusal: AgentListingRefusal): AgentListing {
  return { outcome: "refused", refusal };
}

/**
 * An HTTP status turned into the reason a customer can act on.
 *
 * Anything unmapped falls to `unavailable` rather than to a reason of its own:
 * a status nobody anticipated is by definition a provider that did not answer
 * the way it documents, and "try again" is the only honest instruction. The
 * status rides along, so a log still says which one it was.
 */
export function refusalFromStatus(status: number): AgentListingRefusal {
  if (status === 401 || status === 403) {
    return { reason: "unauthorized", status };
  }
  if (status === 404) return { reason: "not_found", status };
  if (status === 429) return { reason: "rate_limited", status };
  return { reason: "unavailable", status };
}

/**
 * A thrown transport failure turned into a refusal.
 *
 * The error itself never travels. It is a `fetch` failure carrying a URL that
 * may hold a token in a query string, or a zod issue quoting the reply body,
 * and this value is destined for a screen.
 */
export function refusalFromThrown(error: unknown): AgentListingRefusal {
  const name = error instanceof Error ? error.name : "";
  // A zod parse failure on a 2xx body is the captive-portal case: the request
  // reached something, and that something is not the provider's documented API.
  if (name === "ZodError") {
    return { reason: "malformed_response", status: null };
  }
  return { reason: "unreachable", status: null };
}
