// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  holdsLivePlanSlot,
  isTieredPlan,
  type PlanSlotRow,
  SubscriptionAlreadyActiveError,
} from "@langwatch/enterprise-billing-contract";
import { generate } from "@langwatch/ksuid";
import { nowInstant } from "@langwatch/time";

import { refuseSecondLivePlan } from "../../rules/one-live-plan.rules.ts";
import {
  type BillingSubscriptionRecord,
  type BillingSubscriptionWithOrganization,
  BillingSubscriptionRepository,
  type LiveUnlinkedSubscription,
  type SupersededSubscription,
} from "../subscription.repository.ts";
import type { MemoryBillingOrganization, MemoryBillingStore } from "./memory.billing.store.ts";

const SUBSCRIPTION_KSUID_RESOURCE = "sub";
const ACTIVE = "ACTIVE";
const CANCELLED = "CANCELLED";
const FAILED = "FAILED";
const PENDING = "PENDING";

/**
 * The subscription aggregate, held in the shared store. Ordering matches the
 * Prisma twin: newest created first, so a second pending row shadows the first.
 */
export class MemoryBillingSubscriptionRepository extends BillingSubscriptionRepository {
  private constructor(private readonly store: MemoryBillingStore) {
    super();
  }

  static create(store: MemoryBillingStore): MemoryBillingSubscriptionRepository {
    return new MemoryBillingSubscriptionRepository(store);
  }

  async findActive(organizationId: string): Promise<BillingSubscriptionRecord | null> {
    return this.newestOf(
      (subscription) =>
        subscription.organizationId === organizationId && subscription.status === ACTIVE,
    );
  }

  async findLastNonCancelled(organizationId: string): Promise<BillingSubscriptionRecord | null> {
    return this.newestOf(
      (subscription) =>
        subscription.organizationId === organizationId && subscription.status !== CANCELLED,
    );
  }

  async hasAnyForOrganization(organizationId: string): Promise<boolean> {
    return this.store.subscriptions.some(
      (subscription) => subscription.organizationId === organizationId,
    );
  }

  async createPending(input: {
    organizationId: string;
    plan: string;
  }): Promise<BillingSubscriptionRecord> {
    const created: BillingSubscriptionRecord = {
      id: generate(SUBSCRIPTION_KSUID_RESOURCE).toString(),
      organizationId: input.organizationId,
      status: PENDING,
      plan: input.plan,
      stripeSubscriptionId: null,
      createdAt: nowInstant(),
      startDate: null,
      endDate: null,
      maxMembers: null,
      maxMembersLite: null,
      maxMembersDeveloper: null,
      maxMessagesPerMonth: null,
      lastPaymentFailedDate: null,
      seatsKept: null,
      seatsKeptUntil: null,
    };
    this.store.subscriptions.push(created);
    return created;
  }

  async updateStatus(input: { id: string; status: string }): Promise<BillingSubscriptionRecord> {
    return this.update(input.id, (subscription) => ({ ...subscription, status: input.status }));
  }

  async updatePlan(input: { id: string; plan: string }): Promise<BillingSubscriptionRecord> {
    return this.update(input.id, (subscription) => ({ ...subscription, plan: input.plan }));
  }

  async findByStripeId(stripeSubscriptionId: string): Promise<BillingSubscriptionRecord | null> {
    return (
      this.store.subscriptions.find(
        (subscription) => subscription.stripeSubscriptionId === stripeSubscriptionId,
      ) ?? null
    );
  }

  async linkStripeId(input: {
    id: string;
    stripeSubscriptionId: string;
  }): Promise<{ count: number }> {
    const index = this.store.subscriptions.findIndex(
      (subscription) => subscription.id === input.id,
    );
    if (index < 0) return { count: 0 };

    const subscription = this.store.subscriptions[index];
    if (!subscription) return { count: 0 };
    if (
      subscription.stripeSubscriptionId !== null &&
      subscription.stripeSubscriptionId !== input.stripeSubscriptionId
    ) {
      throw new SubscriptionAlreadyActiveError();
    }
    const linked = { ...subscription, stripeSubscriptionId: input.stripeSubscriptionId };
    refuseSecondLivePlan({ rows: this.store.subscriptions, written: linked });
    this.store.subscriptions[index] = linked;
    return { count: 1 };
  }

  async activate(input: {
    id: string;
    previousStatus: string;
  }): Promise<BillingSubscriptionWithOrganization> {
    const activated = this.update(input.id, (subscription) => ({
      ...subscription,
      status: ACTIVE,
      lastPaymentFailedDate: null,
      startDate: input.previousStatus === ACTIVE ? subscription.startDate : nowInstant(),
    }));

    return this.withOrganization(activated);
  }

  async recordPaymentFailure(input: { id: string; currentStatus: string }): Promise<void> {
    this.update(input.id, (subscription) => ({
      ...subscription,
      status: input.currentStatus === ACTIVE ? ACTIVE : FAILED,
      lastPaymentFailedDate: nowInstant(),
    }));
  }

  async cancel(input: { id: string }): Promise<void> {
    this.update(input.id, (subscription) => ({
      ...subscription,
      status: CANCELLED,
      endDate: nowInstant(),
      maxMembers: null,
      maxMembersLite: null,
      maxMembersDeveloper: null,
      maxMessagesPerMonth: null,
      paymentRecoveryInvoiceId: null,
      paymentRecoveryStartedAt: null,
      paymentRecoveryNoticeDay: null,
    }));
  }

  async cancelTrialSubscriptions(_organizationId: string): Promise<void> {
    // No-op, as the Prisma twin is: the `isTrial` column does not exist yet.
  }

  async findSupersededBySeatEvent(input: {
    organizationId: string;
    excludeSubscriptionId: string;
  }): Promise<SupersededSubscription[]> {
    return this.store.subscriptions.flatMap(
      ({ id, organizationId, status, plan, stripeSubscriptionId }) => {
        if (organizationId !== input.organizationId || id === input.excludeSubscriptionId)
          return [];
        if (!isTieredPlan(plan) || stripeSubscriptionId === null) return [];
        return [{ id, stripeSubscriptionId, cancelledInRecords: status === CANCELLED }];
      },
    );
  }

  async findLiveUnlinkedBeside({
    pendingId,
  }: {
    pendingId: string;
  }): Promise<LiveUnlinkedSubscription[]> {
    const pending = this.store.subscriptions.find((subscription) => subscription.id === pendingId);
    if (!pending) return [];
    return this.store.subscriptions
      .filter(
        (subscription) =>
          subscription.organizationId === pending.organizationId &&
          subscription.id !== pendingId &&
          subscription.status === ACTIVE &&
          subscription.stripeSubscriptionId === null,
      )
      .toSorted((a, b) => b.createdAt.epochMilliseconds - a.createdAt.epochMilliseconds)
      .map((subscription) => ({
        ...subscription,
        customLimits: this.store.customLimitSubscriptions.has(subscription.id),
      }));
  }

  async findLiveLinkedBeside({
    pendingId,
  }: {
    pendingId: string;
  }): Promise<BillingSubscriptionRecord[]> {
    const pending = this.store.subscriptions.find((subscription) => subscription.id === pendingId);
    if (!pending) return [];
    return this.store.subscriptions
      .filter(
        (subscription) =>
          subscription.organizationId === pending.organizationId &&
          subscription.id !== pendingId &&
          holdsLivePlanSlot(subscription),
      )
      .toSorted((a, b) => b.createdAt.epochMilliseconds - a.createdAt.epochMilliseconds);
  }

  async findPlanSlots({ ids }: { ids: readonly string[] }): Promise<PlanSlotRow[]> {
    return this.store.subscriptions.filter((subscription) => ids.includes(subscription.id));
  }

  async findLivePlanHolders({
    organizationIds,
  }: {
    organizationIds: readonly string[];
  }): Promise<PlanSlotRow[]> {
    return this.store.subscriptions.filter(
      (subscription) =>
        organizationIds.includes(subscription.organizationId) && holdsLivePlanSlot(subscription),
    );
  }

  async adoptCheckout({
    pendingId,
    liveId,
    stripeSubscriptionId,
  }: {
    pendingId: string;
    liveId: string;
    stripeSubscriptionId: string;
  }): Promise<void> {
    const pending = this.store.subscriptions.find((subscription) => subscription.id === pendingId);
    if (!pending) throw new Error(`No checkout subscription ${pendingId}`);
    const live = this.store.subscriptions.find((subscription) => subscription.id === liveId);
    if (
      live?.stripeSubscriptionId !== null &&
      live?.stripeSubscriptionId !== stripeSubscriptionId
    ) {
      throw new SubscriptionAlreadyActiveError();
    }
    this.update(liveId, (subscription) => ({
      ...subscription,
      plan: pending.plan,
      maxMembers: pending.maxMembers,
      maxRetentionDays: pending.maxRetentionDays ?? subscription.maxRetentionDays ?? null,
      stripeSubscriptionId,
    }));
    this.update(pendingId, (subscription) => ({
      ...subscription,
      status: CANCELLED,
      endDate: nowInstant(),
    }));
  }

  async updateQuantities(input: {
    id: string;
    maxMembers: number | null;
    /** Undefined leaves the stored cap alone: only a seat-priced subscription states it. */
    maxMembersDeveloper?: number;
    maxMessagesPerMonth: number | null;
  }): Promise<BillingSubscriptionWithOrganization> {
    const updated = this.update(input.id, (subscription) => ({
      ...subscription,
      status: ACTIVE,
      lastPaymentFailedDate: null,
      maxMembers: input.maxMembers,
      maxMembersDeveloper: input.maxMembersDeveloper ?? subscription.maxMembersDeveloper,
      maxMessagesPerMonth: input.maxMessagesPerMonth,
    }));

    return this.withOrganization(updated);
  }

  private newestOf(
    matches: (subscription: BillingSubscriptionRecord) => boolean,
  ): BillingSubscriptionRecord | null {
    const found = this.store.subscriptions.filter(matches);
    found.sort((left, right) => {
      const byCreated = right.createdAt.epochMilliseconds - left.createdAt.epochMilliseconds;
      return byCreated === 0 ? right.id.localeCompare(left.id) : byCreated;
    });
    return found[0] ?? null;
  }

  async cancelPendingCheckout({ id }: { id: string }): Promise<BillingSubscriptionRecord[]> {
    const row = this.store.subscriptions.find((subscription) => subscription.id === id);
    if (row?.status !== PENDING) return [];
    return [
      this.update(id, (current) => ({ ...current, status: CANCELLED, endDate: nowInstant() })),
    ];
  }

  private update(
    id: string,
    change: (subscription: BillingSubscriptionRecord) => BillingSubscriptionRecord,
  ): BillingSubscriptionRecord {
    const index = this.store.subscriptions.findIndex((subscription) => subscription.id === id);
    const current = index < 0 ? void 0 : this.store.subscriptions[index];
    if (!current) throw new Error(`No subscription "${id}" exists.`);

    const updated = change(current);
    refuseSecondLivePlan({ rows: this.store.subscriptions, written: updated });
    this.store.subscriptions[index] = updated;
    return updated;
  }

  private withOrganization(
    subscription: BillingSubscriptionRecord,
  ): BillingSubscriptionWithOrganization {
    const organization = this.store.organizations.get(subscription.organizationId);
    if (!organization) {
      throw new Error(`No organization "${subscription.organizationId}" exists.`);
    }

    return { ...subscription, organization: organizationRecordOf(organization) };
  }
}

/** The three organization facts a subscription answer carries. */
function organizationRecordOf(organization: MemoryBillingOrganization): {
  id: string;
  name: string;
  stripeCustomerId: string | null;
} {
  return {
    id: organization.id,
    name: organization.name,
    stripeCustomerId: organization.stripeCustomerId,
  };
}
