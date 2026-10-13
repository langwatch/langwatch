import type {
  IdentityCeremonyAccountPin,
  IdentityCeremonyAccountRow,
} from "@langwatch/identity-contract";

/** The effect seams the ceremonies share, composed once in the app. */
export interface IdentityCeremonyClock {
  now: () => number;
  newCommandId: () => string;
}

export type CeremonyAccountRow = IdentityCeremonyAccountRow;

export type CeremonyAccountPin = IdentityCeremonyAccountPin;

/**
 * What the identity storage adapter needs a ceremony to do: the same two
 * ceremonies better-auth's hooks bind, reached one layer lower.
 * ADR-116 §5 moves the fact from a hook-level veto to a storage-level one.
 */
export interface IdentityAccountCeremonies {
  createAccountIdentifier(account: CeremonyAccountRow): Promise<CeremonyAccountPin>;
  beforeAccountDelete(account: CeremonyAccountRow): Promise<void>;
  /**
   * A `user` update that touches `email`, on the identity branch (ADR-116
   */
  beforeEmailChange(args: { userId: string; email: string }): Promise<void>;
}
