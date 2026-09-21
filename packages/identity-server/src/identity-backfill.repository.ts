import type {
  BackfillIdentifierRow,
  SubjectHolder,
} from "@langwatch/identity";

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
  findUser(args: { userId: string }): Promise<BackfillUserRow | null>;
  findAccountRows(args: { userId: string }): Promise<BackfillAccountRow[]>;
  findIdentifierRows(args: {
    userId: string;
  }): Promise<BackfillIdentifierRow[]>;
  /**
   * Who holds these provider subjects right now, across ALL users.
   *
   * The one read in the backfill that is not scoped to the user being
   * proven, and deliberately so: a subject this user's identifier failed to
   * take is held by somebody else's row, which `findIdentifierRows` can
   * never see. Asked only for the subjects an expectation is actually
   * missing, so a pass that proves cleanly issues no query at all.
   */
  findSubjectHolders(args: {
    subjects: { providerId: string; providerAccountId: string }[];
  }): Promise<SubjectHolder[]>;
}
