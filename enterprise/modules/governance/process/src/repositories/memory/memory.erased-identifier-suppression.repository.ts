// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { Instant } from "@langwatch/time";

import {
  ErasedIdentifierSuppressionRepository,
  type ErasedIdentifierSuppressionRow,
} from "../erased-identifier-suppression.repository.ts";
import type { MemoryDiscoveredPeopleStore } from "./memory.discovered-people.store.ts";

export class MemoryErasedIdentifierSuppressionRepository extends ErasedIdentifierSuppressionRepository {
  private constructor(private readonly store: MemoryDiscoveredPeopleStore) {
    super();
  }

  static create(store: MemoryDiscoveredPeopleStore): MemoryErasedIdentifierSuppressionRepository {
    return new MemoryErasedIdentifierSuppressionRepository(store);
  }

  async findAllByOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<ErasedIdentifierSuppressionRow[]> {
    return this.store.suppressions
      .filter((row) => row.organizationId === organizationId)
      .map((row) => ({ ...row }));
  }

  async findAll(): Promise<ErasedIdentifierSuppressionRow[]> {
    return this.store.suppressions.map((row) => ({ ...row }));
  }

  async recordAll(input: {
    organizationId: string;
    provider: string;
    identifierHashes: string[];
    erasedAt: Instant;
  }): Promise<number> {
    let recorded = 0;
    for (const identifierHash of new Set(input.identifierHashes)) {
      const exists = this.store.suppressions.some(
        (row) =>
          row.organizationId === input.organizationId &&
          row.provider === input.provider &&
          row.identifierHash === identifierHash,
      );
      if (exists) continue;
      this.store.suppressions.push({
        organizationId: input.organizationId,
        provider: input.provider,
        identifierHash,
      });
      recorded += 1;
    }
    return recorded;
  }
}
