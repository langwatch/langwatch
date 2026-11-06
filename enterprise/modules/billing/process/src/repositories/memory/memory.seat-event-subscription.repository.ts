import {
  isGrowthSeatEventPlan,
  type GrowthSeatPlanType,
} from "@langwatch/enterprise-billing-contract";
import { generate } from "@langwatch/ksuid";
import { type Instant, nowInstant, Temporal } from "@langwatch/time";

import type { KeptSeats } from "../../rules/seat-kept.rules.ts";
import {
  SeatEventSubscriptionRepository,
  type SeatRepairRecord,
  type SeatRepairRow,
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
      .map(({ id, status, stripeSubscriptionId, maxMembers, seatsKept, seatsKeptUntil }) => ({
        id,
        status,
        stripeSubscriptionId,
        maxMembers,
        seatsKept,
        seatsKeptUntil,
      }));
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
      seatsKept: null,
      seatsKeptUntil: null,
    });
    return { id };
  }

  async keepSeats({ id, kept }: { id: string; kept: KeptSeats }): Promise<void> {
    const index = this.store.subscriptions.findIndex((subscription) => subscription.id === id);
    const current = this.store.subscriptions[index];
    if (!current) throw new Error(`No subscription "${id}" exists.`);
    this.store.subscriptions[index] = {
      ...current,
      seatsKept: kept.seats,
      seatsKeptUntil: kept.until,
    };
  }

  async reactivateWithSeats({
    id,
    maxMembers,
    kept,
    repairsUpTo,
  }: {
    id: string;
    maxMembers: number;
    kept: KeptSeats | null;
    repairsUpTo: Instant;
  }): Promise<void> {
    const index = this.store.subscriptions.findIndex((subscription) => subscription.id === id);
    const current = this.store.subscriptions[index];
    if (!current) throw new Error(`No subscription "${id}" exists.`);
    this.store.subscriptions[index] = {
      ...current,
      status: "ACTIVE",
      maxMembers,
      endDate: null,
      seatsKept: kept?.seats ?? null,
      seatsKeptUntil: kept?.until ?? null,
    };
    const pending = this.store.seatRepairs.get(id);
    if (pending && Temporal.Instant.compare(pending.since, repairsUpTo) <= 0) {
      this.store.seatRepairs.delete(id);
    }
  }

  async recordSeatRepair({
    id,
    quantity,
    liftedQuantity,
  }: {
    id: string;
    quantity: number;
    liftedQuantity: number;
  }): Promise<SeatRepairRecord> {
    const since = Temporal.Instant.fromEpochMilliseconds(nowInstant().epochMilliseconds);
    this.store.seatRepairs.set(id, {
      quantity,
      liftedQuantity,
      since,
      attempts: 0,
      flaggedAt: null,
    });
    return { quantity, liftedQuantity, since };
  }

  async findSeatRepairs({ recordedBefore }: { recordedBefore: Instant }): Promise<SeatRepairRow[]> {
    const rows: SeatRepairRow[] = [];
    for (const [id, repair] of this.store.seatRepairs) {
      const subscription = this.store.subscriptions.find((row) => row.id === id);
      if (!subscription?.stripeSubscriptionId) continue;
      if (Temporal.Instant.compare(repair.since, recordedBefore) >= 0) continue;
      rows.push({
        id,
        organizationId: subscription.organizationId,
        stripeSubscriptionId: subscription.stripeSubscriptionId,
        quantity: repair.quantity,
        liftedQuantity: repair.liftedQuantity,
        since: repair.since,
        attempts: repair.attempts,
        flaggedAt: repair.flaggedAt,
      });
    }
    return rows.toSorted((a, b) => a.since.epochMilliseconds - b.since.epochMilliseconds);
  }

  async isSeatRepairPending({
    id,
    record,
  }: {
    id: string;
    record: SeatRepairRecord;
  }): Promise<boolean> {
    return this.sameRepair({ id, record });
  }

  async clearSeatRepair({ id, record }: { id: string; record: SeatRepairRecord }): Promise<void> {
    if (this.sameRepair({ id, record })) this.store.seatRepairs.delete(id);
  }

  async recordSeatRepairFailure({
    id,
    record,
    attempts,
    flaggedAt,
  }: {
    id: string;
    record: SeatRepairRecord;
    attempts: number;
    flaggedAt: Instant | null;
  }): Promise<void> {
    const current = this.store.seatRepairs.get(id);
    if (!current || !this.sameRepair({ id, record })) return;
    this.store.seatRepairs.set(id, { ...current, attempts, flaggedAt });
  }

  /** Whether `record` is still the subscription's pending repair. */
  private sameRepair({ id, record }: { id: string; record: SeatRepairRecord }): boolean {
    const current = this.store.seatRepairs.get(id);
    return (
      current !== undefined &&
      current.quantity === record.quantity &&
      current.liftedQuantity === record.liftedQuantity &&
      current.since.equals(record.since)
    );
  }
}
