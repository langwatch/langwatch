import {
  isGrowthSeatEventPlan,
  type GrowthSeatPlanType,
} from "@langwatch/enterprise-billing-contract";
import { generate } from "@langwatch/ksuid";
import { nowInstant } from "@langwatch/time";

import {
  SeatEventSubscriptionRepository,
  type SeatSubscriptionRow,
} from "../seat-event-subscription.repository.ts";
import type { MemoryBillingStore } from "./memory.billing.store.ts";

export class MemorySeatEventSubscriptionRepository extends SeatEventSubscriptionRepository {
  private constructor(private readonly store: MemoryBillingStore) {
    super();
  }

  static create(store: MemoryBillingStore): MemorySeatEventSubscriptionRepository {
    return new MemorySeatEventSubscriptionRepository(store);
  }

  async findSeatCandidates({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<SeatSubscriptionRow[]> {
    return this.store.subscriptions
      .filter(
        (subscription) =>
          subscription.organizationId === organizationId &&
          (subscription.status === "ACTIVE" || subscription.status === "CANCELLED"),
      )
      .toSorted((a, b) => b.createdAt.epochMilliseconds - a.createdAt.epochMilliseconds)
      .map(({ id, status, stripeSubscriptionId }) => ({ id, status, stripeSubscriptionId }));
  }

  async cancelPendingSeatCheckouts({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<string[]> {
    const cancelled: string[] = [];
    this.store.subscriptions.forEach((subscription, index) => {
      if (
        subscription.organizationId !== organizationId ||
        subscription.status !== "PENDING" ||
        !isGrowthSeatEventPlan(subscription.plan)
      ) {
        return;
      }
      this.store.subscriptions[index] = {
        ...subscription,
        status: "CANCELLED",
        endDate: nowInstant(),
      };
      cancelled.push(subscription.id);
    });
    return cancelled;
  }

  async createPendingSeatCheckout(input: {
    organizationId: string;
    plan: GrowthSeatPlanType;
    maxMembers: number;
  }): Promise<{ id: string }> {
    const id = generate("sub").toString();
    this.store.subscriptions.push({
      id,
      organizationId: input.organizationId,
      status: "PENDING",
      plan: input.plan,
      stripeSubscriptionId: null,
      createdAt: nowInstant(),
      startDate: null,
      endDate: null,
      maxMembers: input.maxMembers,
      maxMembersLite: null,
      maxMessagesPerMonth: null,
      lastPaymentFailedDate: null,
    });
    return { id };
  }

  async reactivateWithSeats({ id, maxMembers }: { id: string; maxMembers: number }): Promise<void> {
    const index = this.store.subscriptions.findIndex((subscription) => subscription.id === id);
    const current = this.store.subscriptions[index];
    if (!current) throw new Error(`No subscription "${id}" exists.`);
    this.store.subscriptions[index] = { ...current, status: "ACTIVE", maxMembers, endDate: null };
  }
}
