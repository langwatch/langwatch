import { SubscriptionStatus, TIERED_PLAN_TYPES } from "@langwatch/enterprise-billing-contract";
import type {
  PrismaClient,
  PlanTypes as PrismaPlanTypes,
  SubscriptionStatus as PrismaSubscriptionStatus,
} from "@langwatch/prisma-client/generated";
import { fromDate, nowInstant, toDate } from "@langwatch/time";

import { hasCustomLimits } from "../../rules/seat-checkout-guard.rules.ts";
import {
  BillingSubscriptionRepository,
  type BillingSubscriptionRecord,
  type BillingSubscriptionWithOrganization,
  type LiveUnlinkedSubscription,
  type SupersededSubscription,
} from "../subscription.repository.ts";

const NUMERIC_OVERRIDE_FIELDS = [
  "maxMembers",
  "maxMembersLite",
  "maxMembersDeveloper",
  "maxMessagesPerMonth",
];

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
  maxMembersDeveloper: number | null;
  maxMessagesPerMonth: number | null;
  lastPaymentFailedDate: Date | null;
  seatsKept: number | null;
  seatsKeptUntil: Date | null;
  maxRetentionDays?: number | null;
  paymentRecoveryInvoiceId?: string | null;
  paymentRecoveryStartedAt?: Date | null;
  paymentRecoveryNoticeDay?: number | null;
};

const RECOVERY_CLEARED = {
  paymentRecoveryInvoiceId: null,
  paymentRecoveryStartedAt: null,
  paymentRecoveryNoticeDay: null,
} as const;

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
    maxMembersDeveloper: row.maxMembersDeveloper,
    maxMessagesPerMonth: row.maxMessagesPerMonth,
    lastPaymentFailedDate: row.lastPaymentFailedDate ? fromDate(row.lastPaymentFailedDate) : null,
    seatsKept: row.seatsKept,
    seatsKeptUntil: row.seatsKeptUntil ? fromDate(row.seatsKeptUntil) : null,
    maxRetentionDays: row.maxRetentionDays ?? null,
    paymentRecoveryInvoiceId: row.paymentRecoveryInvoiceId ?? null,
    paymentRecoveryStartedAt: row.paymentRecoveryStartedAt
      ? fromDate(row.paymentRecoveryStartedAt)
      : null,
    paymentRecoveryNoticeDay: row.paymentRecoveryNoticeDay ?? null,
  };
}

/**
 * Prisma-backed implementation of BillingSubscriptionRepository (subscription-table
 * CRUD only). `BillingSubscriptionDatabase` below is the narrow client
 * slice composition needs, not the whole generated client.
 */
type BillingSubscriptionDatabase = Pick<
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

  async hasAnyForOrganization(organizationId: string): Promise<boolean> {
    const row = await this.prisma.subscription.findFirst({
      where: { organizationId },
      select: { id: true },
    });
    return row !== null;
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
      data.startDate = toDate(nowInstant());
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
        lastPaymentFailedDate: toDate(nowInstant()),
      },
    });
  }

  async cancel(input: { id: string }): Promise<void> {
    await this.prisma.subscription.update({
      where: { id: input.id },
      data: {
        status: SubscriptionStatus.CANCELLED as PrismaSubscriptionStatus,
        endDate: toDate(nowInstant()),
        ...Object.fromEntries(NUMERIC_OVERRIDE_FIELDS.map((f) => [f, null])),
        // A cancelled subscription has nothing left to recover; no email goes for it.
        ...RECOVERY_CLEARED,
      },
    });
  }

  async cancelTrialSubscriptions(_organizationId: string): Promise<void> {
    // No-op: the `isTrial` column does not exist in the schema yet.
    // Once the migration lands, restore the updateMany query filtering on isTrial.
  }

  async findSupersededBySeatEvent(input: {
    organizationId: string;
    excludeSubscriptionId: string;
  }): Promise<SupersededSubscription[]> {
    const rows = await this.prisma.subscription.findMany({
      where: {
        organizationId: input.organizationId,
        id: { not: input.excludeSubscriptionId },
        stripeSubscriptionId: { not: null },
        plan: { in: [...TIERED_PLAN_TYPES] as PrismaPlanTypes[] },
      },
      select: { id: true, stripeSubscriptionId: true, status: true },
    });

    return rows.flatMap(({ id, stripeSubscriptionId, status }) =>
      stripeSubscriptionId
        ? [
            {
              id,
              stripeSubscriptionId,
              cancelledInRecords: status === SubscriptionStatus.CANCELLED,
            },
          ]
        : [],
    );
  }

  async findLiveUnlinkedBeside({
    pendingId,
  }: {
    pendingId: string;
  }): Promise<LiveUnlinkedSubscription[]> {
    const pending = await this.prisma.subscription.findUnique({
      where: { id: pendingId },
      select: { organizationId: true },
    });
    if (!pending) return [];
    const rows = await this.prisma.subscription.findMany({
      where: {
        organizationId: pending.organizationId,
        id: { not: pendingId },
        status: SubscriptionStatus.ACTIVE as PrismaSubscriptionStatus,
        stripeSubscriptionId: null,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return rows.map((row) => ({
      ...subscriptionRecordOf(row),
      customLimits: hasCustomLimits(row),
    }));
  }

  async findLiveLinkedBeside({
    pendingId,
  }: {
    pendingId: string;
  }): Promise<BillingSubscriptionRecord[]> {
    const pending = await this.prisma.subscription.findUnique({
      where: { id: pendingId },
      select: { organizationId: true },
    });
    if (!pending) return [];
    const rows = await this.prisma.subscription.findMany({
      where: {
        organizationId: pending.organizationId,
        id: { not: pendingId },
        status: SubscriptionStatus.ACTIVE as PrismaSubscriptionStatus,
        stripeSubscriptionId: { not: null },
        plan: { notIn: [...TIERED_PLAN_TYPES] as PrismaPlanTypes[] },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return rows.map(subscriptionRecordOf);
  }

  async cancelPendingCheckout({ id }: { id: string }): Promise<BillingSubscriptionRecord[]> {
    const { count } = await this.prisma.subscription.updateMany({
      where: { id, status: SubscriptionStatus.PENDING as PrismaSubscriptionStatus },
      data: {
        status: SubscriptionStatus.CANCELLED as PrismaSubscriptionStatus,
        endDate: toDate(nowInstant()),
      },
    });
    if (count === 0) return [];
    const row = await this.prisma.subscription.findUnique({ where: { id } });
    return row ? [subscriptionRecordOf(row)] : [];
  }

  async adoptCheckout({ pendingId, liveId }: { pendingId: string; liveId: string }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const pending = await tx.subscription.findUniqueOrThrow({ where: { id: pendingId } });
      await tx.subscription.update({
        where: { id: liveId },
        data: {
          plan: pending.plan,
          maxMembers: pending.maxMembers,
          ...(pending.maxRetentionDays === null
            ? {}
            : { maxRetentionDays: pending.maxRetentionDays }),
        },
      });
      await tx.subscription.update({
        where: { id: pendingId },
        data: {
          status: SubscriptionStatus.CANCELLED as PrismaSubscriptionStatus,
          endDate: toDate(nowInstant()),
        },
      });
    });
  }

  async updateQuantities(input: {
    id: string;
    maxMembers: number | null;
    /** Undefined leaves the stored cap alone: only a seat-priced subscription states it. */
    maxMembersDeveloper?: number;
    maxMessagesPerMonth: number | null;
  }): Promise<BillingSubscriptionWithOrganization> {
    const row = await this.prisma.subscription.update({
      where: { id: input.id },
      data: {
        status: SubscriptionStatus.ACTIVE as PrismaSubscriptionStatus,
        lastPaymentFailedDate: null,
        maxMembers: input.maxMembers,
        ...(input.maxMembersDeveloper === undefined
          ? {}
          : { maxMembersDeveloper: input.maxMembersDeveloper }),
        maxMessagesPerMonth: input.maxMessagesPerMonth,
      },
      include: { organization: true },
    });

    return { ...subscriptionRecordOf(row), organization: row.organization };
  }
}
