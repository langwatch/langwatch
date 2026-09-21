import { isLiveIdentifierState, type AccountSignInMethods } from "@langwatch/identity-contract";

import type { IdentityHeadsRepository } from "../repositories/identity-heads.repository.ts";
import type { IdentitySignInAccountsRepository } from "../repositories/identity-signin-accounts.repository.ts";
import type { IdentityUserGate } from "../rules/identity-user-gate.rules.ts";
import type { SignInAccountLookup } from "./signin-router.service.ts";

export interface SignInAccountLookupServiceDeps {
  heads: IdentityHeadsRepository;
  legacy: IdentitySignInAccountsRepository;
  isLatched: IdentityUserGate;
}

/**
 * What the address's account holds, for the sign-in router (ADR-117).
 * Finalized users resolve from the projection; a miss falls back to legacy
 * rows only while that user has not latched. KINDS only, never a credential.
 */
export class SignInAccountLookupService implements SignInAccountLookup {
  static create(deps: SignInAccountLookupServiceDeps): SignInAccountLookupService {
    return new SignInAccountLookupService(deps);
  }

  private constructor(private readonly deps: SignInAccountLookupServiceDeps) {}

  async findAccountMethods({
    normalizedValue,
  }: {
    normalizedValue: string;
  }): Promise<AccountSignInMethods | null> {
    const holder = await this.deps.heads.tryFindActiveIdentifierByValue({ normalizedValue });
    if (!holder) {
      return this.legacyMethods({ normalizedValue });
    }
    if (!(await this.deps.isLatched({ userId: holder.userId }))) {
      return this.legacyMethods({ normalizedValue, knownUnlatchedUserId: holder.userId });
    }

    return this.projectedMethods({ userId: holder.userId });
  }

  private async projectedMethods({ userId }: { userId: string }): Promise<AccountSignInMethods> {
    const heads = await this.deps.heads.findHeads({ userId });
    const live = Object.values(heads.identifiers).filter((identifier) =>
      isLiveIdentifierState(identifier.state),
    );

    return {
      hasPassword: live.some((identifier) => identifier.provider === "credential"),
      hasPasskey: live.some((identifier) => identifier.provider === "passkey"),
      providerIds: [...new Set(live.flatMap((i) => (i.providerId === null ? [] : [i.providerId])))],
      // Deduplicated, because one connection can back several identifiers for
      // the same person — a work address and an alias on the same provider —
      // and the router ranks connections, not rows.
      connectionIds: [
        ...new Set(live.flatMap((i) => (i.connectionId === null ? [] : [i.connectionId]))),
      ],
    };
  }

  /**
   * A latched user whose projection did not hold the address has no legacy
   * answer to give: their truth is the projection, and reading the old rows
   * would resurrect a method the migration already moved.
   */
  private async legacyMethods({
    normalizedValue,
    knownUnlatchedUserId,
  }: {
    normalizedValue: string;
    knownUnlatchedUserId?: string;
  }): Promise<AccountSignInMethods | null> {
    const [account] = await this.deps.legacy.findLegacySignInAccounts({ normalizedValue });
    if (!account) return null;

    const alreadyKnownUnlatched = knownUnlatchedUserId === account.userId;
    if (!alreadyKnownUnlatched && (await this.deps.isLatched({ userId: account.userId }))) {
      return null;
    }

    return account.methods;
  }
}
