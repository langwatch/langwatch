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
 * A seat line's way back, written before a seat change lifts it: Stripe should bill `quantity`,
 * and only while it still bills `liftedQuantity` is the line known to be this change's lift.
 * `since` tells one record from the next.
 */
export type SeatRepairRecord = {
  quantity: number;
  liftedQuantity: number;
  since: Instant;
};

/** A pending seat line repair with its subscription, as the repair pass reads it. */
export type SeatRepairRow = SeatRepairRecord & {
  id: string;
  organizationId: string;
  stripeSubscriptionId: string;
  attempts: number;
  flaggedAt: Instant | null;
};

/**
 * Stripe seat line writes recorded before they were sent and not yet known to have finished:
 * every quantity written meanwhile, `since` the first pending one, `at` the latest one.
 */
export type SeatLineWrite = { quantities: number[]; since: Instant; at: Instant };

/** A pending seat line write with its subscription, as the repair pass reads it. */
export type SeatLineWriteRow = SeatLineWrite & {
  id: string;
  organizationId: string;
  stripeSubscriptionId: string;
  attempts: number;
  flaggedAt: Instant | null;
};

/** The seat quantity the last finished seat change set, and when; the plan's seats before any. */
export type SeatLineTarget = { quantity: number | null; at: Instant | null };

/** Recording a write ahead: the lease was lost, or held, with `since` when this write opened it. */
export type SeatLineWriteStart = { held: false } | { held: true; opened: Instant | null };

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
   * Back to ACTIVE at the new seat count, which becomes the seat line's quantity, with the seats it
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
  }): Promise<SeatRepairRecord>;
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
  /**
   * Renews the lease and records the write about to be sent, in one step and only while `token`
   * holds the lease. A write already pending keeps its `since`; only a new one is `opened`.
   */
  abstract beginSeatLineWrite(input: {
    id: string;
    token: string;
    leaseMs: number;
    quantity: number;
  }): Promise<SeatLineWriteStart>;
  /** Clears the write this holder `opened`, only while `token` still holds the lease. */
  abstract finishSeatLineWrite(input: {
    id: string;
    token: string;
    opened: Instant;
  }): Promise<boolean>;
  /** Every pending seat line write whose latest send was before `sentBefore`, oldest first. */
  abstract findSeatLineWrites(input: { sentBefore: Instant }): Promise<SeatLineWriteRow[]>;
  /** The subscription's pending seat line write, if any. */
  abstract findSeatLineWrite(input: { id: string }): Promise<SeatLineWrite | null>;
  /** The seat quantity the seat line should bill, from the last finished seat change. */
  abstract findSeatLineTarget(input: { id: string }): Promise<SeatLineTarget>;
  /**
   * Clears the pending writes opened at `since`; with `accepted`, Stripe's count is kept as the
   * seat line's quantity, as when a write landed and its holder stopped before finishing.
   */
  abstract settleSeatLineWrite(input: {
    id: string;
    since: Instant;
    accepted: number | null;
  }): Promise<void>;
  /** Counts a failed settle of the write opened at `since`, flagged to Ops once it was. */
  abstract recordSeatLineWriteFailure(input: {
    id: string;
    since: Instant;
    attempts: number;
    flaggedAt: Instant | null;
  }): Promise<void>;
  /** Extends the lease by `leaseMs` only while `token` holds it and it has not run out. */
  abstract renewSeatLine(input: { id: string; token: string; leaseMs: number }): Promise<boolean>;
  /** Gives the lease back, only while `token` still holds it. */
  abstract releaseSeatLine(input: { id: string; token: string }): Promise<void>;
}
