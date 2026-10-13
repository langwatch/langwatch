import type { GrowthSeatPlanType } from "@langwatch/enterprise-billing-contract";

/** The subscription fields a seat change reads. */
export type SeatSubscriptionRow = {
  id: string;
  status: string;
  stripeSubscriptionId: string | null;
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
  /** Back to ACTIVE at the new seat count, any scheduled end cleared. */
  abstract reactivateWithSeats(input: { id: string; maxMembers: number }): Promise<void>;
}
