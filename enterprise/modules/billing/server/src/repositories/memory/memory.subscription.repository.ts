// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { generate } from "@langwatch/ksuid";
import { nowInstant } from "@langwatch/time";
import {
  type BillingSubscriptionRecord,
  type BillingSubscriptionWithOrganization,
  SubscriptionRepository,
} from "../subscription.repository.ts";
import type { MemoryBillingOrganization, MemoryBillingStore } from "./memory-billing.store.ts";

const SUBSCRIPTION_KSUID_RESOURCE = "sub";
const ACTIVE = "ACTIVE";
const CANCELLED = "CANCELLED";
const FAILED = "FAILED";
const PENDING = "PENDING";

/** The tiered plans a seat-event migration cancels, as the Prisma twin lists them. */
const TIERED_PLANS: readonly string[] = [
  "LAUNCH",
  "ACCELERATE",
  "LAUNCH_ANNUAL",
  "ACCELERATE_ANNUAL",
  "PRO",
  "GROWTH",
];

/**
 * The subscription aggregate, held in the shared store. Ordering matches the
 * Prisma twin: newest created first, so a second pending row shadows the first.
 */
export class MemorySubscriptionRepository extends SubscriptionRepository {
  private constructor(private readonly store: MemoryBillingStore) {
    super();
  }

  static create(store: MemoryBillingStore): MemorySubscriptionRepository {
    return new MemorySubscriptionRepository(store);
  }

  async tryFindActive(organizationId: string): Promise<BillingSubscriptionRecord | null> {
    return this.newestOf(
      (subscription) =>
        subscription.organizationId === organizationId && subscription.status === ACTIVE,
    );
  }

  async tryFindLastNonCancelled(organizationId: string): Promise<BillingSubscriptionRecord | null> {
    return this.newestOf(
      (subscription) =>
        subscription.organizationId === organizationId && subscription.status !== CANCELLED,
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
      maxMessagesPerMonth: null,
      lastPaymentFailedDate: null,
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

  async tryFindByStripeId(
    stripeSubscriptionId: string,
  ): Promise<BillingSubscriptionRecord | null> {
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
    this.store.subscriptions[index] = {
      ...subscription,
      stripeSubscriptionId: input.stripeSubscriptionId,
    };
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
      maxMessagesPerMonth: null,
    }));
  }

  async cancelTrialSubscriptions(_organizationId: string): Promise<void> {
    // No-op, as the Prisma twin is: the `isTrial` column does not exist yet.
  }

  async migrateToSeatEvent(input: {
    organizationId: string;
    excludeSubscriptionId: string;
  }): Promise<Array<{ stripeSubscriptionId: string | null }>> {
    const organization = this.store.organizations.get(input.organizationId);
    if (organization) organization.pricingModel = "SEAT_EVENT";

    const superseded = this.store.subscriptions.filter(
      (subscription) =>
        subscription.organizationId === input.organizationId &&
        subscription.id !== input.excludeSubscriptionId &&
        subscription.status !== CANCELLED &&
        subscription.stripeSubscriptionId !== null &&
        TIERED_PLANS.includes(subscription.plan),
    );

    for (const subscription of superseded) await this.cancel({ id: subscription.id });

    return superseded.map(({ stripeSubscriptionId }) => ({ stripeSubscriptionId }));
  }

  async updateQuantities(input: {
    id: string;
    maxMembers: number | null;
    maxMessagesPerMonth: number | null;
  }): Promise<BillingSubscriptionWithOrganization> {
    const updated = this.update(input.id, (subscription) => ({
      ...subscription,
      status: ACTIVE,
      lastPaymentFailedDate: null,
      maxMembers: input.maxMembers,
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

  private update(
    id: string,
    change: (subscription: BillingSubscriptionRecord) => BillingSubscriptionRecord,
  ): BillingSubscriptionRecord {
    const index = this.store.subscriptions.findIndex((subscription) => subscription.id === id);
    const current = index < 0 ? void 0 : this.store.subscriptions[index];
    if (!current) throw new Error(`No subscription "${id}" exists.`);

    const updated = change(current);
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
