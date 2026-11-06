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

/** A seat line Stripe should be put back to, recorded when putting it back was refused. */
export type SeatRepairRow = {
  id: string;
  organizationId: string;
  stripeSubscriptionId: string;
  quantity: number;
  attempts: number;
  flaggedAt: Instant | null;
};

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
  /** Back to ACTIVE at the new seat count with the seats it keeps, any scheduled end cleared. */
  abstract reactivateWithSeats(input: {
    id: string;
    maxMembers: number;
    kept: KeptSeats | null;
  }): Promise<void>;
  /** Records the quantity Stripe should bill, replacing an earlier repair and its count. */
  abstract recordSeatRepair(input: { id: string; quantity: number }): Promise<void>;
  /** Every subscription with a seat line repair pending, oldest first. */
  abstract findSeatRepairs(): Promise<SeatRepairRow[]>;
  /** Clears the repair, only while it still asks for `quantity`: a newer one stays. */
  abstract clearSeatRepair(input: { id: string; quantity: number }): Promise<void>;
  /** Counts a failed repair, with the instant it was flagged to Ops once it was. */
  abstract recordSeatRepairFailure(input: {
    id: string;
    quantity: number;
    attempts: number;
    flaggedAt: Instant | null;
  }): Promise<void>;
}
