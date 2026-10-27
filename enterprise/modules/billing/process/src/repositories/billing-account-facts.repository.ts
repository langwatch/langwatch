import type {
  OrganizationIdPage,
  OrganizationIdPageInput,
  OrganizationWithAdministrators,
} from "@langwatch/organization-contract";

/** Narrow organization reads needed by the billing lifecycle services. */
export abstract class BillingAccountFactsRepository {
  abstract findPricingModel(organizationId: string): Promise<string | null>;
  abstract findStripeCustomerId(organizationId: string): Promise<string | null>;
  abstract findName(organizationId: string): Promise<{ id: string; name: string } | null>;
  abstract findFirstTeamId(organizationId: string): Promise<string | null>;
  /** The name and Stripe customer a checkout bills, or null when the organization is gone. */
  abstract findBillingProfile(
    organizationId: string,
  ): Promise<{ name: string; stripeCustomerId: string | null } | null>;
  /**
   * Claims the Stripe customer id when none is set; false when another checkout won. The one
   * write billing keeps on organization's table (Alex, 2026-10-08, round 46 D-b).
   */
  abstract claimStripeCustomerId(input: {
    organizationId: string;
    stripeCustomerId: string;
  }): Promise<boolean>;
  /** The organization and every ADMIN membership's person, through the shares (C2 B). */
  abstract findWithAdministrators(
    organizationId: string,
  ): Promise<OrganizationWithAdministrators | null>;
  /** Members neither disabled nor deactivated, by user id (C2 B). */
  abstract findActiveMemberIds(organizationId: string): Promise<string[]>;
  /** Organizations an operator marked connected self-hosted customers, oldest first. */
  abstract findSelfHostedCustomers(): Promise<
    { organizationId: string; organizationName: string }[]
  >;
  /** Every organization id, a page at a time by id cursor (round 49). */
  abstract listIds(input?: OrganizationIdPageInput): Promise<OrganizationIdPage>;
}
