/**
 * A project's braid signing keys (ADR-183 §4). Every read names the organisation, and every
 * read but `findCredentials` leaves the sealed secret in the store: only verification opens it.
 */
import type { Instant } from "@langwatch/time";

/** One stored key, without its secret. */
export type SigningKeyRow = Readonly<{
  id: string;
  organizationId: string;
  projectId: string;
  name: string;
  publicId: string;
  createdByUserId: string;
  createdAt: Instant;
  rotatedAt: Instant | null;
  verifiesUntil: Instant | null;
  revokedAt: Instant | null;
  lastUsedAt: Instant | null;
}>;

/** A new key as issued; the repository seals `secret` before it rests. */
export type SigningKeyCreateRecord = Readonly<{
  id: string;
  organizationId: string;
  projectId: string;
  name: string;
  publicId: string;
  secret: string;
  createdByUserId: string;
}>;

/** What verification reads: the opened secret and what decides whether it still verifies. */
export type SigningKeyCredential = Readonly<{
  id: string;
  projectId: string;
  publicId: string;
  secret: string;
  verifiesUntil: Instant | null;
  revokedAt: Instant | null;
}>;

type ProjectKeyAddress = Readonly<{ organizationId: string; projectId: string; id: string }>;

export interface SigningKeyRepository {
  findByProject(input: { organizationId: string; projectId: string }): Promise<SigningKeyRow[]>;
  findById(input: ProjectKeyAddress): Promise<SigningKeyRow | undefined>;
  create(input: SigningKeyCreateRecord): Promise<SigningKeyRow>;
  /** Starts a live key's overlap; false when it is not live (rotated, revoked or absent). */
  markRotated(
    input: ProjectKeyAddress & { rotatedAt: Instant; verifiesUntil: Instant },
  ): Promise<boolean>;
  /** Ends a key; revoking a revoked key keeps its first `revokedAt`. */
  revoke(input: ProjectKeyAddress & { revokedAt: Instant }): Promise<void>;
  /** The only read that opens a secret; at most one key answers a public id. */
  findCredentials(input: {
    organizationId: string;
    publicId: string;
  }): Promise<SigningKeyCredential[]>;
  markUsed(input: { organizationId: string; ids: readonly string[]; at: Instant }): Promise<void>;
}
