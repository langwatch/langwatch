import type { PricingModel } from "@langwatch/prisma-client/generated";
import type { UsageUnit } from "@langwatch/entitlement-contract";

/**
 * What enforcement needs of the organization graph: which organization a team belongs to, which
 * projects it owns, and the pricing model a licence override is read against. The aggregate is
 * another feature's, so this is the shape rather than its repository.
 */
export abstract class UsageOrganizationPort {
  abstract tryGetOrganizationIdByTeamId(input: { teamId: string }): Promise<string | null>;

  abstract getProjectIds(organizationId: string): Promise<string[]>;

  abstract tryGetPricingModel(organizationId: string): Promise<PricingModel | null>;
}

/** Which unit an organization is metered in, once resolved. */
export interface UsageMeterReading {
  usageUnit: UsageUnit;
  reason: string;
}
