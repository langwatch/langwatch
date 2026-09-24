// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { Instant } from "@langwatch/time";

/** Machine logins are their own kind and are never matched to an account (ADR-128 §10). */
export const DISCOVERED_PERSON_KIND = {
  PERSON: "person",
  SERVICE_ACCOUNT: "service_account",
} as const;

/** A provider-side person seen on cost and audit rows — the unit of erasure. */
export interface DiscoveredPersonRow {
  id: string;
  organizationId: string;
  provider: string;
  rawActorId: string;
  displayText: string;
  kind: string;
  department: string | null;
  firstSeenAt: Instant;
  lastSeenAt: Instant;
  erasedAt: Instant | null;
  moneyRowsPendingAt: Instant | null;
  moneyRebuildSince: string | null;
  suspendedAt: Instant | null;
  suspendedReason: string | null;
}

/** Spec: specs/governance/governance-identity-and-erasure.feature */
export abstract class DiscoveredPersonRepository {
  /** Cross-org-safe: the row only when it belongs to the organization. */
  abstract findById(input: {
    id: string;
    organizationId: string;
  }): Promise<DiscoveredPersonRow | null>;
  /** People the match engine may act on: no machine logins, no suspended, no erased (§12). */
  abstract findMatchable(input: { organizationId: string }): Promise<DiscoveredPersonRow[]>;
  /** Keyed the way a pull arrives: by the provider's identifier, scoped to that provider. */
  abstract findByActorIds(input: {
    organizationId: string;
    provider: string;
    rawActorIds: string[];
  }): Promise<{ id: string; rawActorId: string }[]>;
  /** The identity screen's read, newest-seen first. */
  abstract findByOrganization(input: { organizationId: string }): Promise<DiscoveredPersonRow[]>;
  /** Creates on first sight, then only ever widens the seen range. */
  abstract recordActivitySighting(input: {
    organizationId: string;
    provider: string;
    rawActorId: string;
    displayText: string;
    kind: string;
    earliestAt: Instant;
    latestAt: Instant;
  }): Promise<void>;
  /** Creates on first sight; upgrades display text and department, widen-only; never moves dates. */
  abstract recordDirectorySighting(input: {
    organizationId: string;
    provider: string;
    rawActorId: string;
    displayText: string;
    department: string;
    seenAt: Instant;
  }): Promise<void>;
  /** Stops automatic linking; only ever sets a halt that is not already there. */
  abstract suspend(input: {
    id: string;
    organizationId: string;
    at: Instant;
    reason: string;
  }): Promise<number>;
  /** Written BEFORE the daily cost rows are deleted, so a crash leaves a record of what is owed. */
  abstract markMoneyRowsPending(input: {
    id: string;
    organizationId: string;
    at: Instant;
    rebuildSince: string | null;
  }): Promise<number>;
  /** Replaces identifier, display text and department with the pseudonym; the row survives. */
  abstract pseudonymize(input: {
    id: string;
    organizationId: string;
    pseudonym: string;
    erasedAt: Instant;
  }): Promise<number>;
  /** The last write of an erasure: the daily cost rows are removed and their rebuild asked for. */
  abstract settleMoneyRows(input: { id: string; organizationId: string }): Promise<number>;
}
