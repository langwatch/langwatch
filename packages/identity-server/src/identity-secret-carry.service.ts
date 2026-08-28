import { createLogger } from "@langwatch/observability";
import type { IdentityAccountSecrets } from "./better-auth/storage-ports";

const logger = createLogger("langwatch:identity:secret-carry");

/**
 * One `Account` row's secrets beside the `AccountCredential` row that
 * mirrors it, if there is one.
 *
 * `credentialUpdatedAtMs` is `null` when no credential row exists yet —
 * which is the difference between the two jobs this service does, and the
 * reason they are one service: a missing row is a user LATCHING and needs
 * their secrets carried across; an older row is a secret that landed on the
 * legacy branch AFTER they latched and needs healing back.
 */
export interface AccountSecretPair {
  /** The pinned account id: the `Account` row's id and the credential's. */
  accountId: string;
  userId: string;
  /** better-auth's own provider id, stored verbatim on the credential row. */
  providerId: string;
  accountUpdatedAtMs: number;
  accountCreatedAtMs: number;
  credentialUpdatedAtMs: number | null;
  secrets: IdentityAccountSecrets;
}

export interface IdentitySecretCarryRepository {
  /** Every `Account` row of this user, with its credential row's timestamp
   *  beside it. Reads only; the decision is this service's. */
  findAccountSecretPairs(args: {
    userId: string;
  }): Promise<AccountSecretPair[]>;
  /**
   * Create the credential row for an account that has none, PRESERVING the
   * `Account` row's own timestamps — the credential is a copy of a fact that
   * already happened, not a new one, and stamping it `now()` would make
   * every later `updatedAt` comparison lie about which branch wrote last.
   *
   * Idempotent: a row that already exists is left exactly as it is, so
   * running the carry again inserts nothing.
   */
  insertCredentialIfMissing(args: {
    accountId: string;
    userId: string;
    providerId: string;
    secrets: IdentityAccountSecrets;
    createdAtMs: number;
    updatedAtMs: number;
  }): Promise<boolean>;
  /** Copy newer legacy-written secrets onto an existing credential row,
   *  carrying the `Account` row's `updatedAt` with them so the comparison
   *  settles rather than repeating every pass. */
  overwriteCredential(args: {
    accountId: string;
    secrets: IdentityAccountSecrets;
    updatedAtMs: number;
  }): Promise<void>;
}

export interface IdentitySecretCarryOutcome {
  /** Credential rows created — a user's secrets carried across at latch. */
  carried: number;
  /** Credential rows overwritten — the reverse mirror's heal leg. */
  healed: number;
}

/**
 * Both directions of the bridge mirror's row half (ADR-116 §4).
 *
 * The forward direction — an identity-branch write mirrored onto the
 * `Account` row — is the adapter's, because it happens at write time. This
 * is everything that happens at PASS time, and there are two of those,
 * different only in whether the credential row exists yet:
 *
 * **Carry (the latch).** When a user finalizes, the secrets they already
 * hold live only in `Account`. Copy each row's secret columns into an
 * `AccountCredential` row once, preserving the `Account` row's own
 * timestamps. Without it, a user's first sign-in after latching verifies
 * against an empty credential row and fails.
 *
 * **Heal (the reverse mirror).** A finalized user's secret write can still
 * land on the legacy branch — deterministically for up to the write gate's
 * TTL per pod right after their latch, and during any gate-cache failure.
 * Where the `Account` row is NEWER than its credential row, copy it back.
 * Without this leg, a password changed in that window is rejected forever.
 *
 * The rule is one `updatedAt` comparison, and it lives here rather than in
 * SQL so it can be read and tested: strictly newer wins, equal does nothing.
 * Equal-does-nothing is what keeps a pass that changes nothing from
 * rewriting every credential row it looks at.
 */
export class IdentitySecretCarryService {
  constructor(private readonly reads: IdentitySecretCarryRepository) {}

  async carryForUser({
    userId,
  }: {
    userId: string;
  }): Promise<IdentitySecretCarryOutcome> {
    const outcome: IdentitySecretCarryOutcome = { carried: 0, healed: 0 };
    for (const pair of await this.reads.findAccountSecretPairs({ userId })) {
      if (pair.credentialUpdatedAtMs === null) {
        const inserted = await this.reads.insertCredentialIfMissing({
          accountId: pair.accountId,
          userId: pair.userId,
          providerId: pair.providerId,
          secrets: pair.secrets,
          createdAtMs: pair.accountCreatedAtMs,
          updatedAtMs: pair.accountUpdatedAtMs,
        });
        if (inserted) outcome.carried += 1;
        continue;
      }
      if (pair.accountUpdatedAtMs <= pair.credentialUpdatedAtMs) continue;
      await this.reads.overwriteCredential({
        accountId: pair.accountId,
        secrets: pair.secrets,
        updatedAtMs: pair.accountUpdatedAtMs,
      });
      outcome.healed += 1;
    }
    if (outcome.carried > 0 || outcome.healed > 0) {
      logger.info(
        { userId, ...outcome },
        "carried or healed a user's account secrets onto their credential rows",
      );
    }
    return outcome;
  }
}
