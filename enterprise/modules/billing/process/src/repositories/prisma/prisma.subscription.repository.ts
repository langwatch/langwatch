import { PlanTypes, SubscriptionStatus } from "@langwatch/enterprise-billing-contract";
import type {
  PrismaClient,
  PlanTypes as PrismaPlanTypes,
  SubscriptionStatus as PrismaSubscriptionStatus,
} from "@langwatch/prisma-client/generated";
import { fromDate } from "@langwatch/time";

import {
  BillingSubscriptionRepository,
  type BillingSubscriptionRecord,
  type BillingSubscriptionWithOrganization,
} from "../subscription.repository.ts";

const NUMERIC_OVERRIDE_FIELDS = ["maxMembers", "maxMembersLite", "maxMessagesPerMonth"];

type SubscriptionRow = {
  id: string;
  organizationId: string;
  status: string;
  plan: string;
  stripeSubscriptionId: string | null;
  createdAt: Date;
  startDate: Date | null;
  endDate: Date | null;
  maxMembers: number | null;
  maxMembersLite: number | null;
  maxMessagesPerMonth: number | null;
  lastPaymentFailedDate: Date | null;
};

/** The subscription row on the one clock every reader above this file uses. */
function subscriptionRecordOf(row: SubscriptionRow): BillingSubscriptionRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    status: row.status,
    plan: row.plan,
    stripeSubscriptionId: row.stripeSubscriptionId,
    createdAt: fromDate(row.createdAt),
    startDate: row.startDate ? fromDate(row.startDate) : null,
    endDate: row.endDate ? fromDate(row.endDate) : null,
    maxMembers: row.maxMembers,
    maxMembersLite: row.maxMembersLite,
    maxMessagesPerMonth: row.maxMessagesPerMonth,
    lastPaymentFailedDate: row.lastPaymentFailedDate ? fromDate(row.lastPaymentFailedDate) : null,
  };
}

/**
 * Prisma-backed implementation of BillingSubscriptionRepository (subscription-table
 * CRUD only). `BillingSubscriptionDatabase` below is the narrow client
 * slice composition needs, not the whole generated client.
 */
export type BillingSubscriptionDatabase = Pick<
  PrismaClient,
  "organization" | "subscription" | "$transaction"
>;

export class PrismaBillingSubscriptionRepository extends BillingSubscriptionRepository {
  private constructor(private readonly prisma: BillingSubscriptionDatabase) {
    super();
  }

  static create(database: BillingSubscriptionDatabase): PrismaBillingSubscriptionRepository {
    return new PrismaBillingSubscriptionRepository(database);
  }

  async findActive(organizationId: string): Promise<BillingSubscriptionRecord | null> {
    const row = await this.prisma.subscription.findFirst({
      where: { organizationId, status: SubscriptionStatus.ACTIVE },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });

    return row ? subscriptionRecordOf(row) : null;
  }

  async findLastNonCancelled(organizationId: string): Promise<BillingSubscriptionRecord | null> {
    const row = await this.prisma.subscription.findFirst({
      where: {
        organizationId,
        status: {
          not: SubscriptionStatus.CANCELLED as PrismaSubscriptionStatus,
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return row ? subscriptionRecordOf(row) : null;
  }

  async createPending(input: {
    organizationId: string;
    plan: string;
  }): Promise<BillingSubscriptionRecord> {
    return subscriptionRecordOf(
      await this.prisma.subscription.create({
        data: {
          organizationId: input.organizationId,
          status: SubscriptionStatus.PENDING as PrismaSubscriptionStatus,
          plan: input.plan as PrismaPlanTypes,
        },
      }),
    );
  }

  async updateStatus(input: { id: string; status: string }): Promise<BillingSubscriptionRecord> {
    return subscriptionRecordOf(
      await this.prisma.subscription.update({
        where: { id: input.id },
        data: { status: input.status as PrismaSubscriptionStatus },
      }),
    );
  }

  async updatePlan(input: { id: string; plan: string }): Promise<BillingSubscriptionRecord> {
    return subscriptionRecordOf(
      await this.prisma.subscription.update({
        where: { id: input.id },
        data: { plan: input.plan as PrismaPlanTypes },
      }),
    );
  }

  // --- Webhook handler methods ---

  async findByStripeId(stripeSubscriptionId: string): Promise<BillingSubscriptionRecord | null> {
    const row = await this.prisma.subscription.findUnique({
      where: { stripeSubscriptionId },
    });

    return row ? subscriptionRecordOf(row) : null;
  }

  async linkStripeId(input: {
    id: string;
    stripeSubscriptionId: string;
  }): Promise<{ count: number }> {
    return this.prisma.subscription.updateMany({
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
    const row = await this.prisma.subscription.update({
      where: { id: input.id },
      data,
      include: { organization: true },
    });

    return { ...subscriptionRecordOf(row), organization: row.organization };
  }

  async recordPaymentFailure(input: { id: string; currentStatus: string }): Promise<void> {
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
  }): Promise<{ stripeSubscriptionId: string | null }[]> {
    const TIERED_PLAN_TYPES: PlanTypes[] = [
      PlanTypes.LAUNCH,
      PlanTypes.ACCELERATE,
      PlanTypes.LAUNCH_ANNUAL,
      PlanTypes.ACCELERATE_ANNUAL,
      PlanTypes.PRO,
      PlanTypes.GROWTH,
    ];

    return this.prisma.$transaction(async (tx) => {
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
    const row = await this.prisma.subscription.update({
      where: { id: input.id },
      data: {
        status: SubscriptionStatus.ACTIVE as PrismaSubscriptionStatus,
        lastPaymentFailedDate: null,
        maxMembers: input.maxMembers,
        maxMessagesPerMonth: input.maxMessagesPerMonth,
      },
      include: { organization: true },
    });

    return { ...subscriptionRecordOf(row), organization: row.organization };
  }
}
