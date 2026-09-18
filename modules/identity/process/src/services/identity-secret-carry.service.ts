import { createLogger } from "@langwatch/observability";
import type { IdentityAccountSecrets } from "../rules/identity-storage.rules.ts";

const logger = createLogger("langwatch:identity:secret-carry");

/**
 * One `Account` row's secrets beside the `AccountCredential` row that mirrors it, if there is
 * one.
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
  findAccountSecretPairs(args: { userId: string }): Promise<AccountSecretPair[]>;
  /**
   * Create the credential row for an account that has none, PRESERVING the
   * `Account` row's own timestamps rather than stamping `now()`. Idempotent:
   * a row that already exists is left exactly as it is.
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
 */
export class IdentitySecretCarryService {
  static create(reads: IdentitySecretCarryRepository): IdentitySecretCarryService {
    return new IdentitySecretCarryService(reads);
  }

  private constructor(private readonly reads: IdentitySecretCarryRepository) {}

  async carryForUser({ userId }: { userId: string }): Promise<IdentitySecretCarryOutcome> {
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
        if (inserted) {
          outcome.carried += 1;
        }

        continue;
      }

      if (pair.accountUpdatedAtMs <= pair.credentialUpdatedAtMs) {
        continue;
      }

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
