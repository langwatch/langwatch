/**
 * Whoever paid keeps paying: the person who started a checkout gets the Billing role,
 * unless they already administer the organization. Spec: specs/licensing/billing-role.feature
 */
import {
  type AuthzApi,
  BILLING_CHECKOUT_ACTOR,
  BindingMissingError,
} from "@langwatch/authz-contract";

/** Authz's Billing role, as a checkout's completion hands it out. */
export type CheckoutBillingRoles = Pick<
  AuthzApi,
  "setBillingRole" | "findActiveOrganizationAdministrators"
>;

export class BillingStarterRoleService {
  static create({
    billingRoles,
  }: {
    billingRoles: CheckoutBillingRoles;
  }): BillingStarterRoleService {
    return new BillingStarterRoleService(billingRoles);
  }

  private constructor(private readonly billingRoles: CheckoutBillingRoles) {}

  /** Safe to repeat on a redelivery: the command id is the Stripe event's. */
  async grantToStarter({
    organizationId,
    startedByUserId,
    eventId,
  }: {
    organizationId: string;
    startedByUserId: string | null;
    eventId: string;
  }): Promise<void> {
    if (!startedByUserId) return;
    const administrators = await this.billingRoles.findActiveOrganizationAdministrators({
      organizationId,
    });
    if (administrators.includes(startedByUserId)) return;
    await this.billingRoles
      .setBillingRole({
        organizationId,
        userId: startedByUserId,
        holds: true,
        caller: { type: "system" },
        actor: BILLING_CHECKOUT_ACTOR,
        commandId: `billing-checkout:${eventId}`,
        source: "checkout",
      })
      .catch((error: unknown) => {
        // A starter who left the organization has no membership to hold the role; a retry
        // would fail the same way, so the checkout completes without it.
        if (error instanceof BindingMissingError) return;
        throw error;
      });
  }
}
