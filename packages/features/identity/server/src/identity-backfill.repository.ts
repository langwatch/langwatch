import type { BackfillIdentifierRow } from "@langwatch/identity-contract";

/** The legacy `User` row as the backfill reads it. */
export interface BackfillUserRow {
  id: string;
  email: string | null;
  emailVerified: boolean;
  createdAtMs: number;
  userHashKey: string | null;
}

/** A legacy `Account` row: one sign-in method the user already holds. */
export interface BackfillAccountRow {
  id: string;
  provider: string;
  /** better-auth 1.7's account key half, as the legacy row carries it. Null
   *  on a row written before the column existed and never backfilled. */
  issuer: string | null;
  providerAccountId: string;
  createdAtMs: number;
}

/**
 * The backfill's reads over the legacy truth (`User`/`Account`) and the
 * `Identifier` projection it proves itself against. Reads only; the one
 * write the pass owns besides its facts is on IdentityUsersRepository.
 */
export interface IdentityBackfillRepository {
  tryFindUser(args: { userId: string }): Promise<BackfillUserRow | null>;
  findAccountRows(args: { userId: string }): Promise<BackfillAccountRow[]>;
  findIdentifierRows(args: {
    userId: string;
  }): Promise<BackfillIdentifierRow[]>;
}
