import {
  type AccountSignInMethods,
  isLiveIdentifierState,
} from "@langwatch/identity";
import type {
  IdentityHeadsRepository,
  IdentityUserGate,
  SignInAccountLookupPort,
} from "@langwatch/identity-server";

/** The non-secret legacy answer used while identifier backfill is pending. */
export interface LegacySignInAccount {
  userId: string;
  methods: AccountSignInMethods;
}

export interface LegacySignInAccountDirectory {
  findLegacySignInAccount(args: {
    normalizedValue: string;
  }): Promise<LegacySignInAccount | null>;
}

/**
 * What the address's account holds, for the sign-in router (ADR-117).
 *
 * Finalized users resolve from the Identifier projection. A miss falls back
 * to legacy User/Account/Passkey rows only when that user's D01 migration has
 * not latched, preserving the same per-user fork as the storage adapter.
 * Detached identifiers never count, and the repository exposes only method
 * presence, never credential material.
 */
export class ProjectionSignInAccountLookup implements SignInAccountLookupPort {
  constructor(
    private readonly heads: IdentityHeadsRepository,
    private readonly legacy: LegacySignInAccountDirectory,
    private readonly isLatched: IdentityUserGate,
  ) {}

  async findAccountMethods({
    normalizedValue,
  }: {
    normalizedValue: string;
  }): Promise<AccountSignInMethods | null> {
    const holder = await this.heads.findActiveIdentifierByValue({
      normalizedValue,
    });
    if (!holder) {
      return await this.findLegacyAccountMethods({ normalizedValue });
    }
    if (!(await this.isLatched({ userId: holder.userId }))) {
      return await this.findLegacyAccountMethods({
        normalizedValue,
        knownUnlatchedUserId: holder.userId,
      });
    }

    const heads = await this.heads.findHeads({ userId: holder.userId });
    const live = Object.values(heads.identifiers).filter((identifier) =>
      isLiveIdentifierState(identifier.state),
    );

    return {
      hasPassword: live.some(
        (identifier) => identifier.provider === "credential",
      ),
      hasPasskey: live.some((identifier) => identifier.provider === "passkey"),
      // Deduplicated, because one connection can back several identifiers for
      // the same person — a work address and an alias on the same provider —
      // and the router ranks connections, not rows.
      connectionIds: [
        ...new Set(
          live
            .map((identifier) => identifier.connectionId)
            .filter((id): id is string => id !== null),
        ),
      ],
    };
  }

  private async findLegacyAccountMethods({
    normalizedValue,
    knownUnlatchedUserId,
  }: {
    normalizedValue: string;
    knownUnlatchedUserId?: string;
  }): Promise<AccountSignInMethods | null> {
    const account = await this.legacy.findLegacySignInAccount({
      normalizedValue,
    });
    if (!account) {
      return null;
    }
    const alreadyKnownUnlatched = knownUnlatchedUserId === account.userId;
    if (
      !alreadyKnownUnlatched &&
      (await this.isLatched({ userId: account.userId }))
    ) {
      return null;
    }

    return account.methods;
  }
}
