// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { Instant } from "@langwatch/time";

/** A dated link between a provider-side person and a platform user. */
export interface IdentityMatchRow {
  id: string;
  organizationId: string;
  discoveredPersonId: string;
  userId: string | null;
  evidenceKind: string;
  validFrom: Instant;
  validTo: Instant | null;
}

/** An open link, as the match engine reads "who is already spoken for". */
export interface OpenIdentityMatch {
  discoveredPersonId: string;
  userId: string | null;
  evidenceKind: string;
}

export abstract class IdentityMatchRepository {
  abstract findAllByDiscoveredPerson(input: {
    organizationId: string;
    discoveredPersonId: string;
  }): Promise<IdentityMatchRow[]>;
  /** Open (`validTo` null) links to somebody; an erasure-blanked link is excluded. */
  abstract findOpenByOrganization(input: { organizationId: string }): Promise<OpenIdentityMatch[]>;
  /** No catch: the one-open-link index refuses a second one, and the caller maps it. */
  abstract open(input: {
    organizationId: string;
    discoveredPersonId: string;
    userId: string;
    evidenceKind: string;
    validFrom: Instant;
  }): Promise<IdentityMatchRow>;
  /** Blanks the user on every link this person holds, open and closed; rows and dates stay. */
  abstract blankUserReferences(input: {
    organizationId: string;
    discoveredPersonId: string;
  }): Promise<number>;
}
