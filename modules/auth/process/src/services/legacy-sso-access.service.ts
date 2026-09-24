import { isSsoProviderMatch, type LegacySsoAccessQuery } from "@langwatch/auth-contract";

import type {
  BetterAuthHooksRepository,
  FederatedAccountRow,
} from "../repositories/better-auth-hooks.repository.ts";

/** The organization's own member rows, asked for rather than queried: auth
 *  owns no membership. */
export interface LegacySsoAccessMemberships {
  listMemberIds(args: { organizationId: string }): Promise<string[]>;
}

/** What the retiring connection speaks to, from the module that registered
 *  it. Refuses for a connection that is not this organization's. */
export interface LegacySsoAccessConnections {
  getProvider(args: {
    organizationId: string;
    connectionId: string;
  }): Promise<{ providerId: string }>;
}

export interface LegacySsoAccessServiceDeps {
  accounts: BetterAuthHooksRepository;
  memberships: LegacySsoAccessMemberships;
  connections: LegacySsoAccessConnections;
}

/**
 * What a retiring SSO connection still holds open, over auth's own `Account`
 * rows. Named by the connection alone, and matched the way the sign-in door
 * matches, so counting and admitting cannot disagree.
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
    organizationId,
    connectionId,
    strandedUserIds,
  }: LegacySsoAccessQuery): Promise<FederatedAccountRow[]> {
    const { providerId } = await this.deps.connections.getProvider({
      organizationId,
      connectionId,
    });
    const kept = new Set(strandedUserIds);
    const userIds = (await this.deps.memberships.listMemberIds({ organizationId })).filter(
      (userId) => !kept.has(userId),
    );
    if (userIds.length === 0) return [];

    const accounts = await this.deps.accounts.findFederatedAccountsForUsers({ userIds });

    return accounts.filter((account) => isSsoProviderMatch({ ssoProvider: providerId }, account));
  }
}
