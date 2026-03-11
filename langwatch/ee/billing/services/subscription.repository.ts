import {
  type PrismaClient,
  type Subscription,
  SubscriptionStatus as PrismaSubscriptionStatus,
  PlanTypes as PrismaPlanTypes,
} from "@prisma/client";
import type {
  CancelledSubscription,
  SubscriptionRepository,
  SubscriptionWithOrg,
} from "../../../src/server/app-layer/subscription/subscription.repository";
import { NUMERIC_OVERRIDE_FIELDS } from "../planProvider";
import { PlanTypes, SubscriptionStatus } from "../planTypes";

/**
 * Prisma-backed implementation of SubscriptionRepository.
 * Handles only subscription-table CRUD -- no organization or team queries.
 */
export class PrismaSubscriptionRepository implements SubscriptionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findLastNonCancelled(
    organizationId: string,
  ): Promise<Subscription | null> {
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
  }): Promise<Subscription> {
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
  }): Promise<Subscription> {
    return await this.prisma.subscription.update({
      where: { id: input.id },
      data: { status: input.status as PrismaSubscriptionStatus },
    });
  }

  async updatePlan(input: {
    id: string;
    plan: string;
  }): Promise<Subscription> {
    return await this.prisma.subscription.update({
      where: { id: input.id },
      data: { plan: input.plan as PrismaPlanTypes },
    });
  }

  // --- Webhook handler methods ---

  async findByStripeId(
    stripeSubscriptionId: string,
  ): Promise<Subscription | null> {
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
  }): Promise<SubscriptionWithOrg> {
    return await this.prisma.subscription.update({
      where: { id: input.id },
      data: {
        status: SubscriptionStatus.ACTIVE as PrismaSubscriptionStatus,
        ...(input.previousStatus !== SubscriptionStatus.ACTIVE && {
          startDate: new Date(),
        }),
        lastPaymentFailedDate: null,
      },
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
        ...Object.fromEntries(
          NUMERIC_OVERRIDE_FIELDS.map((f) => [f, null]),
        ),
      },
    });
  }

  async cancelTrialSubscriptions(organizationId: string): Promise<void> {
    await this.prisma.subscription.updateMany({
      where: {
        organizationId,
        isTrial: true,
        status: SubscriptionStatus.ACTIVE as PrismaSubscriptionStatus,
      },
      data: {
        status: SubscriptionStatus.CANCELLED as PrismaSubscriptionStatus,
        endDate: new Date(),
      },
    });
  }

  async migrateToSeatEvent(input: {
    organizationId: string;
    excludeSubscriptionId: string;
  }): Promise<CancelledSubscription[]> {
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
  }): Promise<SubscriptionWithOrg> {
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
