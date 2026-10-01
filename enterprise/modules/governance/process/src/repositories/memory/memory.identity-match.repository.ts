// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { generate } from "@langwatch/ksuid";
import { Temporal, type Instant } from "@langwatch/time";

import {
  IdentityMatchRepository,
  type IdentityMatchRow,
  type OpenIdentityMatch,
} from "../identity-match.repository.ts";
import type { MemoryDiscoveredPeopleStore } from "./memory.discovered-people.store.ts";

/** The one-open-link index, refusing the way Postgres does: a P2002 the caller maps. */
function uniqueViolation(): Error {
  return Object.assign(new Error("Unique constraint failed: one open identity match per person"), {
    code: "P2002",
  });
}

export class MemoryIdentityMatchRepository extends IdentityMatchRepository {
  private constructor(private readonly store: MemoryDiscoveredPeopleStore) {
    super();
  }

  static create(store: MemoryDiscoveredPeopleStore): MemoryIdentityMatchRepository {
    return new MemoryIdentityMatchRepository(store);
  }

  async findAllByDiscoveredPerson(input: {
    organizationId: string;
    discoveredPersonId: string;
  }): Promise<IdentityMatchRow[]> {
    return this.store.matches
      .filter(
        (row) =>
          row.organizationId === input.organizationId &&
          row.discoveredPersonId === input.discoveredPersonId,
      )
      .toSorted((a, b) => Temporal.Instant.compare(a.validFrom, b.validFrom))
      .map((row) => ({ ...row }));
  }

  async findOpenByOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<OpenIdentityMatch[]> {
    return this.store.matches
      .filter(
        (row) =>
          row.organizationId === organizationId && row.validTo === null && row.userId !== null,
      )
      .map(({ discoveredPersonId, userId, evidenceKind }) => ({
        discoveredPersonId,
        userId,
        evidenceKind,
      }));
  }

  async open(input: {
    organizationId: string;
    discoveredPersonId: string;
    userId: string;
    evidenceKind: string;
    validFrom: Instant;
  }): Promise<IdentityMatchRow> {
    const alreadyOpen = this.store.matches.some(
      (row) =>
        row.organizationId === input.organizationId &&
        row.discoveredPersonId === input.discoveredPersonId &&
        row.validTo === null,
    );
    if (alreadyOpen) throw uniqueViolation();
    const row: IdentityMatchRow = { id: generate("idmatch").toString(), ...input, validTo: null };
    this.store.matches.push(row);
    return { ...row };
  }

  async blankUserReferences(input: {
    organizationId: string;
    discoveredPersonId: string;
  }): Promise<number> {
    let blanked = 0;
    for (const row of this.store.matches) {
      if (row.organizationId !== input.organizationId) continue;
      if (row.discoveredPersonId !== input.discoveredPersonId || row.userId === null) continue;
      row.userId = null;
      blanked += 1;
    }
    return blanked;
  }
}
