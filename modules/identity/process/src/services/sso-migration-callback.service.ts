import { extractEmailDomain } from "@langwatch/auth-contract";
import {
  normalizeDomain,
  type SsoConnectionState,
  type SsoMigrationAccountLinkDecision,
  type SsoMigrationAuthenticationDecision,
} from "@langwatch/identity-contract";

import type { IdentityUsersRepository } from "../repositories/identity-users.repository.ts";
import type { SsoConnectionReadRepository } from "../repositories/sso-connection.repository.ts";
import {
  keepableAccountsForPair,
  migrationAuthenticationDecision,
  migrationCallbackPairs,
  pairProvesDomain,
  resolveMigrationLinkPair,
  findStandaloneLegacyConnections,
  ssoCallbackForPath,
  type MigrationCallbackAccount,
  type SsoMigrationCallbackPair,
} from "../rules/sso-migration-callback.rules.ts";

/** Which organizations a person belongs to — the module that owns them. */
export interface SsoMigrationMemberships {
  organizationIdsForMember(args: { userId: string }): Promise<string[]>;
}

/** The trail a connection's sign-ins leave, written by whoever owns it. */
export interface SsoAuthenticationTrail {
  record(args: {
    connectionId: string;
    userId: string;
    providerAccountId?: string | null;
  }): Promise<void>;
}

export interface SsoMigrationCallbackServiceDeps {
  connections: SsoConnectionReadRepository;
  users: IdentityUsersRepository;
  memberships: SsoMigrationMemberships;
  trail: SsoAuthenticationTrail;
}

const NOT_MIGRATING = { kind: "not_migrating" } as const;
const CONTINUE = { action: "continue" } as const;

/**
 * Which connection a callback belongs to while an organization cuts over to
 * its own (ADR-117 §6). The pair's two sides are two providers for one
 * person, and only one of them may still authenticate.
 */
export class SsoMigrationCallbackService {
  static create(deps: SsoMigrationCallbackServiceDeps): SsoMigrationCallbackService {
    return new SsoMigrationCallbackService(deps);
  }

  private constructor(private readonly deps: SsoMigrationCallbackServiceDeps) {}

  async decideAccountLink({
    userId,
    account,
    otherAccounts,
  }: {
    userId: string;
    account: MigrationCallbackAccount;
    otherAccounts: readonly MigrationCallbackAccount[];
  }): Promise<SsoMigrationAccountLinkDecision> {
    const context = await this.contextFor({ userId, account });
    if (context.kind !== "ready") return context.decision;

    const resolved = resolveMigrationLinkPair({ pairs: context.pairs, account });
    if (resolved.kind === "reject") return resolved;

    const keep = keepableAccountsForPair({ account, otherAccounts, pair: resolved.pair });
    if (keep.kind === "reject") return { kind: "reject", code: "SSO_MIGRATION_LINK_AMBIGUOUS" };

    return {
      kind: "allow_replacement_pair",
      arrivalConnectionId: resolved.direct
        ? resolved.pair.replacement.connectionId
        : resolved.pair.legacy.connectionId,
    };
  }

  /**
   * Whether the way in this callback used still authenticates (ADR-117 §6).
   * The decision above sees only a NEW account row, so a member who linked
   * before the cutover would otherwise keep signing in through a retired side.
   */
  async authorizeAndRecordAuthentication({
    userId,
    callbackPath,
    accounts,
  }: {
    userId: string;
    callbackPath: string | undefined;
    accounts: readonly MigrationCallbackAccount[];
  }): Promise<SsoMigrationAuthenticationDecision> {
    const callback = ssoCallbackForPath({ path: callbackPath });
    if (!callback.recognized) return CONTINUE;

    const pairs = migrationCallbackPairs(await this.connectionsForMemberOf({ userId }));
    if (pairs.length === 0) return CONTINUE;

    const outcome = migrationAuthenticationDecision({ callback, accounts, pairs });
    if (outcome.action !== "record") return outcome;

    await this.deps.trail.record({
      connectionId: outcome.connectionId,
      userId,
      providerAccountId: outcome.providerAccountId,
    });
    return CONTINUE;
  }

  /**
   * The pairs this callback may be decided from, or the answer that stands in
   * their place. An address that is not proved, or that several people hold,
   * is refused rather than resolved: both would pick a person for an assertion.
   */
  private async contextFor({
    userId,
    account,
  }: {
    userId: string;
    account: MigrationCallbackAccount;
  }): Promise<
    | { kind: "ready"; pairs: SsoMigrationCallbackPair[] }
    | { kind: "settled"; decision: SsoMigrationAccountLinkDecision }
  > {
    const standing = await this.deps.users.findAddressStanding({ userId });
    if (!standing) return { kind: "settled", decision: NOT_MIGRATING };

    const connections = await this.connectionsForMemberOf({ userId });
    const pairs = migrationCallbackPairs(connections);
    if (pairs.length === 0) {
      return {
        kind: "settled",
        decision: await this.decideStandaloneLegacyConnection({ account, standing }),
      };
    }
    if (!standing.email || !standing.emailVerified) {
      return {
        kind: "settled",
        decision: { kind: "reject", code: "SSO_MIGRATION_LINK_UNVERIFIED" },
      };
    }
    if (standing.holders !== 1) {
      return {
        kind: "settled",
        decision: { kind: "reject", code: "SSO_MIGRATION_LINK_AMBIGUOUS" },
      };
    }

    const address = extractEmailDomain(standing.email);
    const domain = address ? normalizeDomain(address) : null;
    const qualified = domain ? pairs.filter((pair) => pairProvesDomain({ pair, domain })) : [];
    if (qualified.length === 0) {
      return {
        kind: "settled",
        decision: { kind: "reject", code: "SSO_MIGRATION_LINK_NOT_ALLOWED" },
      };
    }
    return { kind: "ready", pairs: qualified };
  }

  /**
   * The grandfathered connection that still stands alone, for the population
   * whose organization never started a cutover. Nothing here is a refusal:
   * an account this cannot place is simply not the migration's business.
   */
  private async decideStandaloneLegacyConnection({
    account,
    standing,
  }: {
    account: MigrationCallbackAccount;
    standing: { email: string | null; emailVerified: boolean };
  }): Promise<SsoMigrationAccountLinkDecision> {
    if (!standing.emailVerified) return NOT_MIGRATING;
    // Folded the way a claimed domain is, so a trailing dot compares equal.
    const address = extractEmailDomain(standing.email);
    const domain = address ? normalizeDomain(address) : null;
    if (!domain) return NOT_MIGRATING;

    const owner = await this.deps.connections.tryFindDomainOwner({ domain });
    if (!owner) return NOT_MIGRATING;

    const matching = findStandaloneLegacyConnections({
      connections: await this.deps.connections.findForOrganization({
        organizationId: owner.organizationId,
      }),
      account,
      domain,
    });
    const connection = matching.length === 1 ? matching[0] : undefined;
    if (!connection) return NOT_MIGRATING;
    return { kind: "allow_connection", arrivalConnectionId: connection.connectionId };
  }

  private async connectionsForMemberOf({
    userId,
  }: {
    userId: string;
  }): Promise<SsoConnectionState[]> {
    const organizationIds = await this.deps.memberships.organizationIdsForMember({ userId });
    const perOrganization = await Promise.all(
      organizationIds.map((organizationId) =>
        this.deps.connections.findForOrganization({ organizationId }),
      ),
    );
    return perOrganization.flat();
  }
}
