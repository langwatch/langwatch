import type { LinkSource } from "./constants";

/**
 * One provider login, fully qualified. Lookups never cross connections
 * (ADR-094 Decision 2): the connection id is part of the key because a
 * customer can hold two connections to the same provider with
 * non-interchangeable id spaces.
 */
export interface LoginRef {
  provider: string;
  providerConnectionId: string;
  externalKind: string;
  externalId: string;
}

/**
 * A stored link row. Rows are only added, never edited (ADR-094 Decision 3);
 * erasure is the single exception and marks itself with `erasedAt`.
 */
export interface IdentityLinkRow extends LoginRef {
  id: string;
  /** Database-assigned tie-break for rows sharing an `effectiveFrom`. */
  seq: bigint;
  organizationId: string;
  /** Null = unlink row (nobody owns this login from `effectiveFrom` on). */
  userId: string | null;
  effectiveFrom: Date;
  recordedAt: Date;
  source: LinkSource;
  actorUserId: string | null;
  /** Set only by erasure — "person forgotten", not "admin unlinked". */
  erasedAt: Date | null;
}

export interface AppendLinkInput extends LoginRef {
  organizationId: string;
  /** Null appends an unlink row. */
  userId: string | null;
  /**
   * May sit in the past — that is how corrections work (Decision 3). To
   * displace a wrong row for its own periods, carry the same or a later
   * `effectiveFrom`; the append order (`seq`) wins the tie.
   */
  effectiveFrom: Date;
  source: LinkSource;
  /** From the session, never the request body. Null only for system paths. */
  actorUserId: string | null;
}

/**
 * Erasure input (ADR-094 Decision 9). Token derivation is NOT the storage
 * layer's job: the caller derives the org-scoped keyed-hash token for each
 * email-kind login and passes the replacement values in, so the key never
 * travels below the erasure service.
 */
export interface EraseIdentifiersInput {
  organizationId: string;
  /** The person being forgotten. */
  userId: string;
  /**
   * Replacement value per email-kind `externalId` (raw value → token).
   * Non-email ids survive as pseudonyms and need no entry.
   */
  emailTokenByExternalId: ReadonlyMap<string, string>;
  erasedAt: Date;
}

export interface EraseIdentifiersResult {
  /** Link rows whose userId / actorUserId / externalId were blanked or swapped. */
  linkRowsTouched: number;
}
