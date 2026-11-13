// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type {
  AgentRegistryEntry,
  AgentRegistryEvent,
  AgentRegistryStatus,
} from "@langwatch/enterprise-governance-contract";
import type { Instant } from "@langwatch/time";

import type {
  RegistryChangeSet,
  StoredRegistryEntry,
} from "../features/registry/rules/registry-reconcile.rules.ts";

/** Keyset position in the entry listing: ascending by last material change, then id. */
export type RegistryEntryPosition = { updatedAt: string; id: string };

/** The agent registry and its append-only change feed (specs/agent-registry.feature). */
export abstract class AgentRegistryRepository {
  /**
   * Reads the organisation's rows, asks `plan` what changed and writes it, one organisation at a
   * time, so feed sequences commit in order. Returns the events it appended; with
   * `deliveryRecordedAt` they are written as already pushed, in the same commit.
   */
  abstract applyChanges(input: {
    organizationId: string;
    plan: (stored: StoredRegistryEntry[]) => RegistryChangeSet;
    deliveryRecordedAt?: Instant;
  }): Promise<AgentRegistryEvent[]>;
  /** Organisations holding any entry, in id order after `after`; the traffic pass walks them. */
  abstract findOrganizationIds(input: { after?: string; limit: number }): Promise<string[]>;
  /** At most `limit` entries, latest update first. */
  abstract findEntries(input: {
    organizationId: string;
    status?: AgentRegistryStatus;
    limit: number;
  }): Promise<AgentRegistryEntry[]>;
  abstract listEntries(input: {
    organizationId: string;
    limit: number;
    after?: RegistryEntryPosition;
    updatedSince?: Instant;
    status?: AgentRegistryStatus;
  }): Promise<{ entries: AgentRegistryEntry[]; hasMore: boolean }>;
  /** Throws `agent_registry_entry_not_found` when the organisation holds no such entry. */
  abstract getEntry(input: { organizationId: string; id: string }): Promise<AgentRegistryEntry>;
  abstract findEventsAfter(input: {
    organizationId: string;
    after?: bigint;
    limit: number;
  }): Promise<AgentRegistryEvent[]>;
  abstract findEventsOfEntry(input: {
    organizationId: string;
    entryId: string;
    after?: bigint;
    limit: number;
  }): Promise<AgentRegistryEvent[]>;
  /** Events whose webhook fan-out is not yet recorded, oldest first. */
  abstract findUndeliveredEvents(input: {
    organizationId: string;
    limit: number;
  }): Promise<AgentRegistryEvent[]>;
  abstract markDeliveryRecorded(input: {
    organizationId: string;
    eventIds: readonly string[];
    at: Instant;
  }): Promise<void>;
}
