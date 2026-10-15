/**
 * The tokens that can only ask for a testing licence (ADR-180 section 2). The row holds
 * the token's hash, never the token; what leaves the feature is the view.
 */

import type { TestingLicenseTokenKind } from "@langwatch/enterprise-licensing-contract";
import type { Instant } from "@langwatch/time";

export interface TestingLicenseTokenRecord {
  id: string;
  kind: TestingLicenseTokenKind;
  /** The person who made the token and whom it acts as. */
  ownerUserId: string;
  /** A service token's name; null on a personal token. */
  name: string | null;
  expiresAt: Instant;
  revokedAt: Instant | null;
  revokedById: string | null;
  lastUsedAt: Instant | null;
  createdAt: Instant;
}

export type TestingLicenseTokenDraft = Readonly<{
  id: string;
  tokenHash: string;
  kind: TestingLicenseTokenKind;
  ownerUserId: string;
  name: string | null;
  expiresAt: Instant;
}>;

export interface TestingLicenseTokenRepository {
  create(draft: TestingLicenseTokenDraft): Promise<TestingLicenseTokenRecord>;
  /** The token a presented hash names: one row, or none. */
  findByTokenHash(tokenHash: string): Promise<TestingLicenseTokenRecord[]>;
  findById(id: string): Promise<TestingLicenseTokenRecord[]>;
  /** Every token, newest first. */
  listAll(input: {
    page: number;
    pageSize: number;
  }): Promise<{ rows: TestingLicenseTokenRecord[]; total: number }>;
  /** Answers true only to the call that revoked it; revoking twice is false. */
  revoke(input: { id: string; at: Instant; revokedById: string }): Promise<boolean>;
  /** Records that the token just issued a testing licence. */
  recordUse(input: { id: string; at: Instant }): Promise<void>;
}
