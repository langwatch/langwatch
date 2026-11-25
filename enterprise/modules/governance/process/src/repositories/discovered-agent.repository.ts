// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { Instant } from "@langwatch/time";

/** One agent row as a screen needs it — the columns handed out are a decision, not inferred. */
export interface DiscoveredAgentRow {
  id: string;
  provider: string;
  displayText: string;
  firstSeenAt: Instant;
  lastSeenAt: Instant;
}

/** One agent row as the registry reads it: the provider's id and descriptive fields too. */
export interface DiscoveredAgentRegistryRow extends DiscoveredAgentRow {
  rawAgentId: string;
  metadata: Readonly<Record<string, unknown>>;
}

/** Provider-side agents a source listed; no kind, no match, no erasure state — not a person. */
export abstract class DiscoveredAgentRepository {
  /** The agents screen's read, newest-seen first; agents gone from every source are left out. */
  abstract findByOrganization(input: { organizationId: string }): Promise<DiscoveredAgentRow[]>;
  /** The agent registry's read: every agent a source still lists or no source ever listed. */
  abstract findForRegistry(input: {
    organizationId: string;
  }): Promise<DiscoveredAgentRegistryRow[]>;
  /**
   * A listing is a presence fact: widens both dates; merges text and metadata, never blanks. With
   * a source, it records that source's presence and clears that source's gone mark.
   */
  abstract recordAgentSighting(input: {
    organizationId: string;
    provider: string;
    rawAgentId: string;
    displayText: string;
    metadata: Record<string, string>;
    seenAt: Instant;
    ingestionSourceId?: string;
  }): Promise<void>;
  /**
   * The source's presence for agents its listing at `listedAt` did not name is marked gone at that
   * instant, moving an earlier absence forward; an agent leaves the reads only once every source
   * that listed it marked it gone.
   */
  abstract markUnlistedGone(input: {
    organizationId: string;
    ingestionSourceId: string;
    listedAt: Instant;
  }): Promise<{ marked: number }>;
}
