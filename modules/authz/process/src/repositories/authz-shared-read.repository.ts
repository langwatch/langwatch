import type { GrantCondition } from "@langwatch/authz-contract";
import type { Instant } from "@langwatch/time";

/** One live shared read (ADR-175) as the minter turns it into a shared grant on a proof. */
export type SharedReadRow = Readonly<{
  grantId: string;
  memberProjectId: string;
  condition: GrantCondition;
  expiresAt: Instant | null;
}>;

/** One live shared read as the ledger compares and revokes it: which member holds a row. */
export type SharedReadGrant = Readonly<{ grantId: string; memberProjectId: string }>;

/**
 * ADR-175: the `project-reader` rows one reader project holds on its members, the grants the
 * aggregate reconciler writes. Stored facts only; which reach a proof is the service's call.
 */
export abstract class AuthzSharedReadRepository {
  /** The live shared reads, minus any whose stored condition does not parse: a window the proof
   *  cannot state is a window it must not open. */
  abstract findLiveSharedReads(input: {
    organizationId: string;
    readerProjectId: string;
  }): Promise<SharedReadRow[]>;

  /** The live shared reads by member, ordered by member, whatever their condition says: a row
   *  whose condition no longer parses is still one the reconciler must be able to revoke. */
  abstract findLiveSharedReadGrants(input: {
    organizationId: string;
    readerProjectId: string;
    memberProjectIds?: readonly string[];
  }): Promise<SharedReadGrant[]>;

  /** Which of these grant ids a row holds, live or revoked; an id nobody holds is absent. */
  abstract findGrantStates(input: {
    organizationId: string;
    grantIds: readonly string[];
  }): Promise<{ grantId: string; isRevoked: boolean }[]>;
}
