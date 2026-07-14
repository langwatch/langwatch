import type { PricingModel, PrismaClient } from "@prisma/client";
import { GROWTH_SEAT_PLAN_TYPES } from "../../../ee/billing/utils/growthSeatEvent";

/**
 * Repository for organization-related data access
 */
export class OrganizationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Gets all project IDs for an organization
   */
  async getProjectIds(organizationId: string): Promise<string[]> {
    const projects = await this.prisma.project.findMany({
      where: { team: { organizationId } },
      select: { id: true },
    });
    return projects.map((p) => p.id);
  }

  /**
   * Gets organizationId from teamId
   */
  async getOrganizationIdByTeamId(teamId: string): Promise<string | null> {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: { organizationId: true },
    });
    return team?.organizationId ?? null;
  }

  /**
   * Gets the pricing model for an organization
   */
  async getPricingModel(organizationId: string): Promise<PricingModel | null> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { pricingModel: true },
    });
    return org?.pricingModel ?? null;
  }

  /**
   * Whether the organization holds an ACTIVE seat-event (GROWTH_SEAT_*)
   * subscription. Seat-billing decisions derive from this subscription fact
   * (ADR-039) — never from the pricingModel display cache, which can drift.
   */
  async hasActiveSeatEventSubscription(
    organizationId: string,
  ): Promise<boolean> {
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        organizationId,
        status: "ACTIVE",
        plan: { in: [...GROWTH_SEAT_PLAN_TYPES] },
      },
      select: { id: true },
    });
    return subscription !== null;
  }

  /**
   * Converges the pricingModel display cache (ADR-039 Decision 3). Only the
   * self-heal writes through this — decisions never read the column.
   */
  async setPricingModel({
    organizationId,
    pricingModel,
  }: {
    organizationId: string;
    pricingModel: PricingModel;
  }): Promise<void> {
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { pricingModel },
    });
  }

  /**
   * Gets the Stripe customer ID for an organization
   */
  async getStripeCustomerId(organizationId: string): Promise<string | null> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { stripeCustomerId: true },
    });
    return org?.stripeCustomerId ?? null;
  }
}
