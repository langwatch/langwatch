import { isSsoProviderMatch, type LegacySsoAccessQuery } from "@langwatch/auth-contract";

import type {
  BetterAuthHooksRepository,
  FederatedAccountRow,
} from "../repositories/better-auth-hooks.repository.ts";

export interface LegacySsoAccessServiceDeps {
  accounts: BetterAuthHooksRepository;
}

/**
 * What a retiring SSO connection still holds open, over auth's own `Account`
 * rows. The provider comparison is the one the sign-in door already enforces,
 * so what a cutover counts and what a sign-in accepts cannot disagree.
 */
export class LegacySsoAccessService {
  static create(deps: LegacySsoAccessServiceDeps): LegacySsoAccessService {
    return new LegacySsoAccessService(deps);
  }

  private constructor(private readonly deps: LegacySsoAccessServiceDeps) {}

  /** Deletes what the provider still answers for, then re-reads: `remaining`
   *  is a fresh count, never the arithmetic of what this pass removed. */
  async retire(query: LegacySsoAccessQuery): Promise<{ retired: number; remaining: number }> {
    const held = await this.matching(query);
    const retired = await this.deps.accounts.deleteAccounts({
      accountRowIds: held.map((account) => account.rowId),
    });

    return { retired, remaining: await this.count(query) };
  }

  async count(query: LegacySsoAccessQuery): Promise<number> {
    const held = await this.matching(query);

    return held.length;
  }

  private async matching({
    userIds,
    providerId,
  }: LegacySsoAccessQuery): Promise<FederatedAccountRow[]> {
    if (userIds.length === 0) return [];

    const accounts = await this.deps.accounts.findFederatedAccountsForUsers({ userIds });

    return accounts.filter((account) => isSsoProviderMatch({ ssoProvider: providerId }, account));
  }
}
