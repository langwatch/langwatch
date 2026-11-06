/**
 * The Billing role (specs/licensing/billing-role.feature): who pays for an organization,
 * granted as a USER grant at its scope. It takes no seat and confers only its own bag.
 */
import type {
  AuthzBillingMember,
  AuthzListBillingMembersInput,
  AuthzSetBillingRoleInput,
} from "@langwatch/authz-contract";
import { generate } from "@langwatch/ksuid";

import type { EventingAuthzLedgerAdapter } from "../eventing/authz-grant.store.ts";
import type { AuthzBillingGrantRepository } from "../repositories/authz-billing-grant.repository.ts";
import type { AuthzUserStandingRepository } from "../repositories/authz-user-standing.repository.ts";

/** The ledger's Billing writes. */
export type BillingGrantLedger = Pick<
  EventingAuthzLedgerAdapter,
  "attachBillingGrant" | "revokeBillingGrants"
>;

type AuthzBillingRoleOptions = {
  grants: AuthzBillingGrantRepository;
  standings: AuthzUserStandingRepository;
  ledger: BillingGrantLedger;
  newGrantId: () => string;
};

export class AuthzBillingRoleService {
  static create(options: AuthzBillingRoleOptions): AuthzBillingRoleService {
    return new AuthzBillingRoleService(options);
  }

  private constructor(private readonly options: AuthzBillingRoleOptions) {}

  /** Live holders on an enabled membership whose account is active, oldest grant first. */
  async listMembers({
    organizationId,
  }: AuthzListBillingMembersInput): Promise<AuthzBillingMember[]> {
    const held = await this.options.grants.findGrants({ organizationId });
    const userIds = [...new Set(held.map((row) => row.userId))];
    if (userIds.length === 0) return [];
    const [enabled, inactive] = await Promise.all([
      this.options.grants.findEnabledMemberIds({ organizationId, userIds }),
      this.options.standings.findInactiveUserIds({ userIds }),
    ]);
    const enabledIds = new Set(enabled);
    const inactiveIds = new Set(inactive);

    return userIds
      .filter((userId) => enabledIds.has(userId) && !inactiveIds.has(userId))
      .map((userId) => ({ userId }));
  }

  /** Grants or revokes; a holder asked to hold keeps the grant they have. */
  async setRole({
    organizationId,
    userId,
    holds,
    actor,
    commandId,
    source = "grants-service",
  }: AuthzSetBillingRoleInput): Promise<void> {
    const held = await this.options.grants.findGrants({ organizationId, userId });
    if (holds) {
      if (held.length > 0) return;
      await this.options.ledger.attachBillingGrant({
        organizationId,
        grantId: this.options.newGrantId(),
        userId,
        actor,
        source,
        commandId: commandId ?? generate("authzcmd").toString(),
      });
      return;
    }
    await this.options.ledger.revokeBillingGrants({
      organizationId,
      grantIds: held.map((row) => row.grantId),
      actor,
    });
  }
}
