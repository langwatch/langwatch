// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { Instant } from "@langwatch/time";

import type { AgentMetadata } from "../../rules/discovered-agent-metadata.rules.ts";
import type { DiscoveredPersonRow } from "../discovered-person.repository.ts";
import type { ErasedIdentifierSuppressionRow } from "../erased-identifier-suppression.repository.ts";
import type { IdentityMatchSuggestionRow } from "../identity-match-suggestion.repository.ts";
import type { IdentityMatchRow } from "../identity-match.repository.ts";

export type MemoryDiscoveredAgent = {
  id: string;
  organizationId: string;
  provider: string;
  rawAgentId: string;
  displayText: string;
  metadata: AgentMetadata;
  firstSeenAt: Instant;
  lastSeenAt: Instant;
};

export type MemoryGovernanceTenant = {
  organizationId: string;
  tenantId: string;
  firstUsedAt: Instant;
  lastUsedAt: Instant;
};

/** The identity tables with no database behind them, shared the way one schema is. */
export class MemoryDiscoveredPeopleStore {
  readonly people: DiscoveredPersonRow[] = [];
  readonly agents: MemoryDiscoveredAgent[] = [];
  readonly matches: IdentityMatchRow[] = [];
  readonly suggestions: IdentityMatchSuggestionRow[] = [];
  readonly suppressions: ErasedIdentifierSuppressionRow[] = [];
  readonly tenants: MemoryGovernanceTenant[] = [];

  private constructor() {}

  static create(): MemoryDiscoveredPeopleStore {
    return new MemoryDiscoveredPeopleStore();
  }
}
