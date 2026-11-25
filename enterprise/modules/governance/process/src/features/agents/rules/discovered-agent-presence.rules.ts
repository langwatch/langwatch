// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** One source's presence fact for one agent, as the reads need it. */
export interface AgentListingPresence {
  discoveredAgentId: string;
  isGone: boolean;
}

/**
 * The agents every source that listed them has marked gone. An agent another source still lists
 * stays, and an agent no source has listed (older sightings) is never gone.
 */
export function agentIdsGoneFromEverySource({
  listings,
}: {
  listings: readonly AgentListingPresence[];
}): Set<string> {
  const listedSomewhere = new Set<string>();
  const marked = new Set<string>();
  for (const listing of listings) {
    if (listing.isGone) marked.add(listing.discoveredAgentId);
    else listedSomewhere.add(listing.discoveredAgentId);
  }
  return new Set([...marked].filter((id) => !listedSomewhere.has(id)));
}
