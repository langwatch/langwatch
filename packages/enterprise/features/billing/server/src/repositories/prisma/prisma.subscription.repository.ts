import type {
  PrismaClient,
  PlanTypes as PrismaPlanTypes,
  SubscriptionStatus as PrismaSubscriptionStatus,
} from "@langwatch/prisma-client/generated";
import { PlanTypes, SubscriptionStatus } from "@langwatch/enterprise-billing-contract";
import { NUMERIC_OVERRIDE_FIELDS } from "../../services/plan-provider.service";
import {
  BillingSubscriptionRepository,
  type BillingSubscriptionRecord,
  type BillingSubscriptionWithOrganization,
} from "../../ports/subscription.port";

/**
 * Prisma-backed implementation of SubscriptionRepository.
 * Handles only subscription-table CRUD -- no organization or team queries.
 */
export class PrismaSubscriptionRepository extends BillingSubscriptionRepository {
  private constructor(private readonly prisma: PrismaClient) { super(); }

  static create(database: object): PrismaSubscriptionRepository {
    return new PrismaSubscriptionRepository(database as PrismaClient);
  }

  async tryFindActive(
    organizationId: string,
  ): Promise<BillingSubscriptionRecord | null> {
    return this.prisma.subscription.findFirst({
      where: { organizationId, status: SubscriptionStatus.ACTIVE },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  }

  async tryFindLastNonCancelled(
    organizationId: string,
  ): Promise<BillingSubscriptionRecord | null> {
    return await this.prisma.subscription.findFirst({
      where: {
        organizationId,
        status: {
          not: SubscriptionStatus.CANCELLED as PrismaSubscriptionStatus,
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async createPending(input: {
    organizationId: string;
    plan: string;
  }): Promise<BillingSubscriptionRecord> {
    return await this.prisma.subscription.create({
      data: {
        organizationId: input.organizationId,
        status: SubscriptionStatus.PENDING as PrismaSubscriptionStatus,
        plan: input.plan as PrismaPlanTypes,
      },
    });
  }

  async updateStatus(input: {
    id: string;
    status: string;
  }): Promise<BillingSubscriptionRecord> {
    return await this.prisma.subscription.update({
      where: { id: input.id },
      data: { status: input.status as PrismaSubscriptionStatus },
    });
  }

  async updatePlan(
    input: { id: string; plan: string },
  ): Promise<BillingSubscriptionRecord> {
    return await this.prisma.subscription.update({
      where: { id: input.id },
      data: { plan: input.plan as PrismaPlanTypes },
    });
  }

  // --- Webhook handler methods ---

  async tryFindByStripeId(
    stripeSubscriptionId: string,
  ): Promise<BillingSubscriptionRecord | null> {
    return await this.prisma.subscription.findUnique({
      where: { stripeSubscriptionId },
    });
  }

  async linkStripeId(input: {
    id: string;
    stripeSubscriptionId: string;
  }): Promise<{ count: number }> {
    return await this.prisma.subscription.updateMany({
      where: { id: input.id },
      data: { stripeSubscriptionId: input.stripeSubscriptionId },
    });
  }

  async activate(input: {
    id: string;
    previousStatus: string;
  }): Promise<BillingSubscriptionWithOrganization> {
    const data: {
      status: PrismaSubscriptionStatus;
      startDate?: Date;
      lastPaymentFailedDate: null;
    } = {
      status: SubscriptionStatus.ACTIVE as PrismaSubscriptionStatus,
      lastPaymentFailedDate: null,
    };
    if (input.previousStatus !== SubscriptionStatus.ACTIVE) {
      data.startDate = new Date();
    }
    return await this.prisma.subscription.update({
      where: { id: input.id },
      data,
      include: { organization: true },
    });
  }

  async recordPaymentFailure(input: {
    id: string;
    currentStatus: string;
  }): Promise<void> {
    await this.prisma.subscription.update({
      where: { id: input.id },
      data: {
        status:
          input.currentStatus === SubscriptionStatus.ACTIVE
            ? (SubscriptionStatus.ACTIVE as PrismaSubscriptionStatus)
            : (SubscriptionStatus.FAILED as PrismaSubscriptionStatus),
        lastPaymentFailedDate: new Date(),
      },
    });
  }

  async cancel(input: { id: string }): Promise<void> {
    await this.prisma.subscription.update({
      where: { id: input.id },
      data: {
        status: SubscriptionStatus.CANCELLED as PrismaSubscriptionStatus,
        endDate: new Date(),
        ...Object.fromEntries(NUMERIC_OVERRIDE_FIELDS.map((f) => [f, null])),
      },
    });
  }

  async cancelTrialSubscriptions(_organizationId: string): Promise<void> {
    // No-op: the `isTrial` column does not exist in the schema yet.
    // Once the migration lands, restore the updateMany query filtering on isTrial.
  }

  async migrateToSeatEvent(input: {
    organizationId: string;
    excludeSubscriptionId: string;
  }): Promise<Array<{ stripeSubscriptionId: string | null }>> {
    const TIERED_PLAN_TYPES: PlanTypes[] = [
      PlanTypes.LAUNCH,
      PlanTypes.ACCELERATE,
      PlanTypes.LAUNCH_ANNUAL,
      PlanTypes.ACCELERATE_ANNUAL,
      PlanTypes.PRO,
      PlanTypes.GROWTH,
    ];

    return await this.prisma.$transaction(async (tx) => {
      await tx.organization.update({
        where: { id: input.organizationId },
        data: { pricingModel: "SEAT_EVENT" },
      });

      const oldSubs = await tx.subscription.findMany({
        where: {
          organizationId: input.organizationId,
          id: { not: input.excludeSubscriptionId },
          status: {
            not: SubscriptionStatus.CANCELLED as PrismaSubscriptionStatus,
          },
          stripeSubscriptionId: { not: null },
          plan: { in: TIERED_PLAN_TYPES as PrismaPlanTypes[] },
        },
      });

      for (const oldSub of oldSubs) {
        await tx.subscription.update({
          where: { id: oldSub.id },
          data: {
            status: SubscriptionStatus.CANCELLED as PrismaSubscriptionStatus,
            endDate: new Date(),
          },
        });
      }

      return oldSubs.map((s) => ({
        stripeSubscriptionId: s.stripeSubscriptionId,
      }));
    });
  }

  async updateQuantities(input: {
    id: string;
    maxMembers: number | null;
    maxMessagesPerMonth: number | null;
  }): Promise<BillingSubscriptionWithOrganization> {
    return await this.prisma.subscription.update({
      where: { id: input.id },
      data: {
        status: SubscriptionStatus.ACTIVE as PrismaSubscriptionStatus,
        lastPaymentFailedDate: null,
        maxMembers: input.maxMembers,
        maxMessagesPerMonth: input.maxMessagesPerMonth,
      },
      include: { organization: true },
    });
  }
}
