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
  /** The agents screen's read, newest-seen first. */
  abstract findByOrganization(input: { organizationId: string }): Promise<DiscoveredAgentRow[]>;
  /** The agent registry's read: every row with its provider id and metadata. */
  abstract findForRegistry(input: {
    organizationId: string;
  }): Promise<DiscoveredAgentRegistryRow[]>;
  /** A listing is a presence fact: widens both dates; merges text and metadata, never blanks. */
  abstract recordAgentSighting(input: {
    organizationId: string;
    provider: string;
    rawAgentId: string;
    displayText: string;
    metadata: Record<string, string>;
    seenAt: Instant;
  }): Promise<void>;
}
