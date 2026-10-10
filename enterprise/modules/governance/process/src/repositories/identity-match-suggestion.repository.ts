// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { Instant } from "@langwatch/time";

/** A candidate match the background job computed, waiting on a human (ADR-128 §12). */
export interface IdentityMatchSuggestionRow {
  id: string;
  organizationId: string;
  discoveredPersonId: string;
  userId: string;
  score: number;
  computedAt: Instant;
}

export abstract class IdentityMatchSuggestionRepository {
  /** One organization's review queue, strongest candidate first. */
  abstract findAllByOrganization(input: {
    organizationId: string;
  }): Promise<IdentityMatchSuggestionRow[]>;
  /** Cross-org-safe: the organization is in the predicate. */
  abstract findOne(input: {
    id: string;
    organizationId: string;
  }): Promise<IdentityMatchSuggestionRow | null>;
  /** Swaps the whole queue atomically; a row the pass did not re-derive no longer means anything. */
  abstract replaceForOrganization(input: {
    organizationId: string;
    suggestions: { discoveredPersonId: string; userId: string; score: number }[];
    computedAt: Instant;
  }): Promise<{ removed: number; written: number }>;
  /** Confirming one candidate makes every other candidate for that person moot. */
  abstract deleteAllForPerson(input: {
    organizationId: string;
    discoveredPersonId: string;
  }): Promise<number>;
}
