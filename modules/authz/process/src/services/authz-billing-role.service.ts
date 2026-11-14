/**
 * The Billing role (specs/licensing/billing-role.feature): who pays for an organization,
 * granted as a USER grant at its scope. It takes no seat and confers only its own bag.
 */
import {
  BILLING_PERMISSIONS,
  GrantExceedsCallerPermissionsError,
  type AuthzBillingMember,
  type AuthzGrantCaller,
  type AuthzListBillingMembersInput,
  type AuthzSetBillingRoleInput,
} from "@langwatch/authz-contract";
import { generate } from "@langwatch/ksuid";

import type { EventingAuthzLedgerAdapter } from "../eventing/authz-grant.store.ts";
import type { AuthzBillingGrantRepository } from "../repositories/authz-billing-grant.repository.ts";
import type { AuthzUserStandingRepository } from "../repositories/authz-user-standing.repository.ts";
import type { AuthzService } from "./authz.service.ts";

/** The ledger's Billing writes. */
export type BillingGrantLedger = Pick<
  EventingAuthzLedgerAdapter,
  "attachBillingGrant" | "revokeBillingGrants"
>;

type AuthzBillingRoleOptions = {
  grants: AuthzBillingGrantRepository;
  standings: AuthzUserStandingRepository;
  ledger: BillingGrantLedger;
  permissions: Pick<AuthzService, "findPermissionsBeyondCaller">;
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

  /**
   * Grants or revokes; a holder asked to hold keeps the grant they have. Either way the caller
   * must hold every Billing permission at the organization, as every other grant write does.
   */
  async setRole({
    organizationId,
    userId,
    holds,
    caller,
    actor,
    commandId,
    source = "grants-service",
  }: AuthzSetBillingRoleInput): Promise<void> {
    await this.assertWithinCaller({ organizationId, caller });
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

  private async assertWithinCaller({
    organizationId,
    caller,
  }: {
    organizationId: string;
    caller: AuthzGrantCaller;
  }): Promise<void> {
    if (caller.type === "system") return;
    const missing =
      caller.type === "anonymous"
        ? [...BILLING_PERMISSIONS]
        : await this.options.permissions.findPermissionsBeyondCaller({
            organizationId,
            caller,
            scope: { type: "organization", id: organizationId },
            permissions: [...BILLING_PERMISSIONS],
          });
    if (missing.length > 0) throw new GrantExceedsCallerPermissionsError(missing);
  }
}
