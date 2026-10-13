// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The meters subject of billing's Stripe channels (Q69-4, a sixth subject):
 * usage recorded against a meter, the summaries Stripe sums from it, and the
 * account's meters, in billing's own shapes.
 */

/** A meter as the catalogue sync reads it. */
export type StripeMeter = Readonly<{
  id: string;
  eventName: string;
  status: "active" | "inactive";
}>;

/** One page of meters, and whether Stripe holds more after it. */
export type StripeMeterPage = Readonly<{ meters: StripeMeter[]; hasMore: boolean }>;

/** One summarised window of a customer's usage on a meter. */
export type StripeMeterEventSummary = Readonly<{ aggregatedValue: number }>;

export type StripeMeterEvent = Readonly<{
  eventName: string;
  customerId: string;
  /** The value as sent: an integer as itself, a fraction to fixed places. */
  value: string;
  identifier: string;
  timestamp: number;
}>;

export abstract class StripeMetersChannel {
  abstract createMeterEvent(input: StripeMeterEvent): Promise<void>;

  /** The first page of the customer's summaries on the meter within the window. */
  abstract listEventSummaries(input: {
    meterId: string;
    customerId: string;
    startTime: number;
    endTime: number;
  }): Promise<StripeMeterEventSummary[]>;

  /** At most `limit` meters, after the meter `startingAfter` names when it is given. */
  abstract listMeters(input: { limit: number; startingAfter?: string }): Promise<StripeMeterPage>;
}
