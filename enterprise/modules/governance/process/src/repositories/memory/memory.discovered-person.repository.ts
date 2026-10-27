// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { generate } from "@langwatch/ksuid";
import { Temporal, type Instant } from "@langwatch/time";

import {
  DISCOVERED_PERSON_KIND,
  DiscoveredPersonRepository,
  type DiscoveredPersonRow,
} from "../discovered-person.repository.ts";
import type { MemoryDiscoveredPeopleStore } from "./memory.discovered-people.store.ts";

type PersonKey = { organizationId: string; provider: string; rawActorId: string };

export class MemoryDiscoveredPersonRepository extends DiscoveredPersonRepository {
  private constructor(private readonly store: MemoryDiscoveredPeopleStore) {
    super();
  }

  static create(store: MemoryDiscoveredPeopleStore): MemoryDiscoveredPersonRepository {
    return new MemoryDiscoveredPersonRepository(store);
  }

  async findById(input: {
    id: string;
    organizationId: string;
  }): Promise<DiscoveredPersonRow | null> {
    const row = this.inOrganization(input.organizationId).find((person) => person.id === input.id);
    return row ? { ...row } : null;
  }

  async findMatchable({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<DiscoveredPersonRow[]> {
    return this.inOrganization(organizationId)
      .filter(
        (person) =>
          person.kind === DISCOVERED_PERSON_KIND.PERSON &&
          person.suspendedAt === null &&
          person.erasedAt === null,
      )
      .toSorted((a, b) => a.id.localeCompare(b.id))
      .map((person) => ({ ...person }));
  }

  async findByActorIds(input: {
    organizationId: string;
    provider: string;
    rawActorIds: string[];
  }): Promise<{ id: string; rawActorId: string }[]> {
    return this.inOrganization(input.organizationId)
      .filter(
        (person) =>
          person.provider === input.provider && input.rawActorIds.includes(person.rawActorId),
      )
      .map(({ id, rawActorId }) => ({ id, rawActorId }));
  }

  async findByOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<DiscoveredPersonRow[]> {
    return this.inOrganization(organizationId)
      .toSorted((a, b) => Temporal.Instant.compare(b.lastSeenAt, a.lastSeenAt))
      .map((person) => ({ ...person }));
  }

  async recordActivitySighting(
    input: PersonKey & {
      displayText: string;
      kind: string;
      earliestAt: Instant;
      latestAt: Instant;
    },
  ): Promise<void> {
    const existing = this.byKey(input);
    if (!existing) {
      this.insert({
        ...input,
        department: null,
        firstSeenAt: input.earliestAt,
        lastSeenAt: input.latestAt,
      });
      return;
    }
    if (Temporal.Instant.compare(existing.lastSeenAt, input.latestAt) < 0)
      existing.lastSeenAt = input.latestAt;
    if (Temporal.Instant.compare(existing.firstSeenAt, input.earliestAt) > 0) {
      existing.firstSeenAt = input.earliestAt;
    }
  }

  async recordDirectorySighting(
    input: PersonKey & {
      displayText: string;
      department: string;
      seenAt: Instant;
    },
  ): Promise<void> {
    const existing = this.byKey(input);
    if (!existing) {
      this.insert({
        ...input,
        department: input.department === "" ? null : input.department,
        kind: DISCOVERED_PERSON_KIND.PERSON,
        firstSeenAt: input.seenAt,
        lastSeenAt: input.seenAt,
      });
      return;
    }
    if (existing.erasedAt !== null) return;
    if (input.displayText !== "") existing.displayText = input.displayText;
    if (input.department !== "") existing.department = input.department;
  }

  async suspend(input: {
    id: string;
    organizationId: string;
    at: Instant;
    reason: string;
  }): Promise<number> {
    const row = this.inOrganization(input.organizationId).find(
      (person) => person.id === input.id && person.suspendedAt === null,
    );
    if (!row) return 0;
    row.suspendedAt = input.at;
    row.suspendedReason = input.reason;
    return 1;
  }

  async markMoneyRowsPending(input: {
    id: string;
    organizationId: string;
    at: Instant;
    rebuildSince: string | null;
  }): Promise<number> {
    return this.update(input, (row) => {
      row.moneyRowsPendingAt = input.at;
      row.moneyRebuildSince = input.rebuildSince;
    });
  }

  async pseudonymize(input: {
    id: string;
    organizationId: string;
    pseudonym: string;
    erasedAt: Instant;
  }): Promise<number> {
    return this.update(input, (row) => {
      row.rawActorId = input.pseudonym;
      row.displayText = input.pseudonym;
      row.department = null;
      row.erasedAt = input.erasedAt;
    });
  }

  async settleMoneyRows(input: { id: string; organizationId: string }): Promise<number> {
    return this.update(input, (row) => {
      row.moneyRowsPendingAt = null;
      row.moneyRebuildSince = null;
    });
  }

  private inOrganization(organizationId: string): DiscoveredPersonRow[] {
    return this.store.people.filter((person) => person.organizationId === organizationId);
  }

  private byKey(key: PersonKey): DiscoveredPersonRow | undefined {
    return this.inOrganization(key.organizationId).find(
      (person) => person.provider === key.provider && person.rawActorId === key.rawActorId,
    );
  }

  private insert(
    row: PersonKey & {
      displayText: string;
      kind: string;
      department: string | null;
      firstSeenAt: Instant;
      lastSeenAt: Instant;
    },
  ): void {
    this.store.people.push({
      id: generate("dperson").toString(),
      organizationId: row.organizationId,
      provider: row.provider,
      rawActorId: row.rawActorId,
      displayText: row.displayText,
      kind: row.kind,
      department: row.department,
      firstSeenAt: row.firstSeenAt,
      lastSeenAt: row.lastSeenAt,
      erasedAt: null,
      moneyRowsPendingAt: null,
      moneyRebuildSince: null,
      suspendedAt: null,
      suspendedReason: null,
    });
  }

  private update(
    input: { id: string; organizationId: string },
    change: (row: DiscoveredPersonRow) => void,
  ): number {
    const row = this.inOrganization(input.organizationId).find((person) => person.id === input.id);
    if (!row) return 0;
    change(row);
    return 1;
  }
}
