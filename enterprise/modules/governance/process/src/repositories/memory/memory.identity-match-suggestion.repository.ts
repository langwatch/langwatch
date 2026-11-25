// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { generate } from "@langwatch/ksuid";
import type { Instant } from "@langwatch/time";

import {
  IdentityMatchSuggestionRepository,
  type IdentityMatchSuggestionRow,
} from "../identity-match-suggestion.repository.ts";
import type { MemoryDiscoveredPeopleStore } from "./memory.discovered-people.store.ts";

export class MemoryIdentityMatchSuggestionRepository extends IdentityMatchSuggestionRepository {
  private constructor(private readonly store: MemoryDiscoveredPeopleStore) {
    super();
  }

  static create(store: MemoryDiscoveredPeopleStore): MemoryIdentityMatchSuggestionRepository {
    return new MemoryIdentityMatchSuggestionRepository(store);
  }

  async findAllByOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<IdentityMatchSuggestionRow[]> {
    return this.store.suggestions
      .filter((row) => row.organizationId === organizationId)
      .toSorted((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .map((row) => ({ ...row }));
  }

  async findOne(input: {
    id: string;
    organizationId: string;
  }): Promise<IdentityMatchSuggestionRow | null> {
    const row = this.store.suggestions.find(
      (suggestion) =>
        suggestion.id === input.id && suggestion.organizationId === input.organizationId,
    );
    return row ? { ...row } : null;
  }

  async replaceForOrganization(input: {
    organizationId: string;
    suggestions: { discoveredPersonId: string; userId: string; score: number }[];
    computedAt: Instant;
  }): Promise<{ removed: number; written: number }> {
    const removed = this.removeWhere((row) => row.organizationId === input.organizationId);
    let written = 0;
    for (const suggestion of input.suggestions) {
      const duplicate = this.store.suggestions.some(
        (row) =>
          row.organizationId === input.organizationId &&
          row.discoveredPersonId === suggestion.discoveredPersonId &&
          row.userId === suggestion.userId,
      );
      if (duplicate) continue;
      this.store.suggestions.push({
        id: generate("idsugg").toString(),
        organizationId: input.organizationId,
        ...suggestion,
        computedAt: input.computedAt,
      });
      written += 1;
    }
    return { removed, written };
  }

  async deleteAllForPerson(input: {
    organizationId: string;
    discoveredPersonId: string;
  }): Promise<number> {
    return this.removeWhere(
      (row) =>
        row.organizationId === input.organizationId &&
        row.discoveredPersonId === input.discoveredPersonId,
    );
  }

  private removeWhere(predicate: (row: IdentityMatchSuggestionRow) => boolean): number {
    const kept = this.store.suggestions.filter((row) => !predicate(row));
    const removed = this.store.suggestions.length - kept.length;
    this.store.suggestions.splice(0, this.store.suggestions.length, ...kept);
    return removed;
  }
}
