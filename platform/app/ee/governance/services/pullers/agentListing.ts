// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * What a provider answered when it was asked to list its agents.
 *
 * The three outcomes, the refusal vocabulary and the status mapping live in
 * {@link ProviderListing} — they are the same for every list a provider hands
 * over, and this file holds only what is specific to an agent: the row.
 *
 * The distinction those three outcomes carry matters most here. The scheduled
 * pull reads the agent list only to put a name on a conversation, so it treats
 * a refusal and an empty tenant identically, and `fetchBots` collapses them
 * into an empty Map. An admin reading a screen cannot afford that: "the tenant
 * has no agents" and "the credential was refused" are different facts.
 */

import type { ListingRefusal, ProviderListing } from "./providerListing";
import { itemsListed, listingRefused } from "./providerListing";

export {
  type ListingRefusal as AgentListingRefusal,
  type ListingRefusalReason as AgentListingRefusalReason,
  refusalFromStatus,
  refusalFromThrown,
} from "./providerListing";

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

export type AgentListing = ProviderListing<DiscoveredAgentRecord>;

/** Picks the `listed`/`empty` arm from what the provider actually returned. */
export function agentsListed(agents: DiscoveredAgentRecord[]): AgentListing {
  return itemsListed(agents);
}

export function agentsRefused(refusal: ListingRefusal): AgentListing {
  return listingRefused(refusal);
}
