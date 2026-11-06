import type { GrowthSeatPlanType } from "@langwatch/enterprise-billing-contract";
import type { Instant } from "@langwatch/time";

import type { KeptSeats } from "../rules/seat-kept.rules.ts";

/** The subscription fields a seat change reads. */
export type SeatSubscriptionRow = {
  id: string;
  status: string;
  stripeSubscriptionId: string | null;
  maxMembers: number | null;
  seatsKept: number | null;
  seatsKeptUntil: Instant | null;
};

/**
 * A pending seat line repair; `since` tells one record from the next. A lift record (both counts
 * set) moves the line to `quantity` only while Stripe still bills `liftedQuantity`. A reconcile
 * record (both null) moves the line to the seat quantity the last finished seat change set.
 */
export type SeatRepairRecord = {
  quantity: number | null;
  liftedQuantity: number | null;
  since: Instant;
};

/** The way back a seat change records before it lifts the line. */
export type SeatLiftRecord = SeatRepairRecord & { quantity: number; liftedQuantity: number };

/** A pending seat line repair with its subscription, as the repair pass reads it. */
export type SeatRepairRow = SeatRepairRecord & {
  id: string;
  organizationId: string;
  stripeSubscriptionId: string;
  attempts: number;
  flaggedAt: Instant | null;
};

/** What claiming a subscription's seat line found: the lease's fencing token, or another holder. */
export type SeatLineClaim = { claimed: true; token: string } | { claimed: false };

/** The subscription rows a growth-seat checkout and a seat change write. */
export abstract class SeatEventSubscriptionRepository {
  /** The organization's ACTIVE and CANCELLED subscriptions, newest first. */
  abstract findSeatCandidates(input: { organizationId: string }): Promise<SeatSubscriptionRow[]>;
  /** Cancels the PENDING growth-seat checkouts left behind, returning their ids. */
  abstract cancelPendingSeatCheckouts(input: { organizationId: string }): Promise<string[]>;
  abstract createPendingSeatCheckout(input: {
    organizationId: string;
    plan: GrowthSeatPlanType;
    maxMembers: number;
  }): Promise<{ id: string }>;
  /** Records the seats a decrease keeps before the provider lowers the line; the count stays. */
  abstract keepSeats(input: { id: string; kept: KeptSeats }): Promise<void>;
  /**
   * Back to ACTIVE at the new seat count, which becomes the seat line's target, with the seats it
   * keeps, any scheduled end cleared, and every repair recorded at or before `repairsUpTo` cleared.
   */
  abstract reactivateWithSeats(input: {
    id: string;
    maxMembers: number;
    kept: KeptSeats | null;
    repairsUpTo: Instant;
  }): Promise<void>;
  /** Records the way back before a lift, replacing an earlier repair and its count. */
  abstract recordSeatRepair(input: {
    id: string;
    quantity: number;
    liftedQuantity: number;
  }): Promise<SeatLiftRecord>;
  /** Records that the line goes back to the last seat change's quantity, replacing any repair. */
  abstract recordSeatLineReconcile(input: { id: string }): Promise<SeatRepairRecord>;
  /** The seat quantity the last finished seat change set the line to, else the plan's seats. */
  abstract findSeatLineTarget(input: { id: string }): Promise<number | null>;
  /** Every subscription with a seat line repair recorded before `recordedBefore`, oldest first. */
  abstract findSeatRepairs(input: { recordedBefore: Instant }): Promise<SeatRepairRow[]>;
  /** Whether `record` is still the subscription's pending repair. */
  abstract isSeatRepairPending(input: { id: string; record: SeatRepairRecord }): Promise<boolean>;
  /** Clears the repair, only while it is still `record`: a newer one stays. */
  abstract clearSeatRepair(input: { id: string; record: SeatRepairRecord }): Promise<void>;
  /** Counts a failed repair of `record`, with the instant it was flagged to Ops once it was. */
  abstract recordSeatRepairFailure(input: {
    id: string;
    record: SeatRepairRecord;
    attempts: number;
    flaggedAt: Instant | null;
  }): Promise<void>;
  /** Takes the seat line lease unless another holder's has not run out; it lasts `leaseMs`. */
  abstract claimSeatLine(input: { id: string; leaseMs: number }): Promise<SeatLineClaim>;
  /** Extends the lease by `leaseMs` only while `token` holds it and it has not run out. */
  abstract renewSeatLine(input: { id: string; token: string; leaseMs: number }): Promise<boolean>;
  /** Gives the lease back, only while `token` still holds it. */
  abstract releaseSeatLine(input: { id: string; token: string }): Promise<void>;
}
