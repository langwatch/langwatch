// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type Stripe from "stripe";

import {
  type StripeMeterEvent,
  type StripeMeterEventSummary,
  type StripeMeterPage,
  StripeMetersChannel,
} from "../stripe-meters.channel.ts";

/** Stripe's billing meters over billing's one client. */
export class HttpStripeMetersChannel extends StripeMetersChannel {
  private constructor(private readonly stripe: Stripe) {
    super();
  }

  static create(input: { stripe: Stripe }): HttpStripeMetersChannel {
    return new HttpStripeMetersChannel(input.stripe);
  }

  async createMeterEvent({
    eventName,
    customerId,
    value,
    identifier,
    timestamp,
  }: StripeMeterEvent): Promise<void> {
    await this.stripe.billing.meterEvents.create({
      event_name: eventName,
      payload: { stripe_customer_id: customerId, value },
      identifier,
      timestamp,
    });
  }

  async listEventSummaries({
    meterId,
    customerId,
    startTime,
    endTime,
  }: {
    meterId: string;
    customerId: string;
    startTime: number;
    endTime: number;
  }): Promise<StripeMeterEventSummary[]> {
    const page = await this.stripe.billing.meters.listEventSummaries(meterId, {
      customer: customerId,
      start_time: startTime,
      end_time: endTime,
    });
    return page.data.map((summary) => ({ aggregatedValue: summary.aggregated_value }));
  }

  async listMeters({
    limit,
    startingAfter,
  }: {
    limit: number;
    startingAfter?: string;
  }): Promise<StripeMeterPage> {
    const page = await this.stripe.billing.meters.list({ limit, starting_after: startingAfter });
    return {
      meters: page.data.map((meter) => ({
        id: meter.id,
        eventName: meter.event_name,
        status: meter.status,
      })),
      hasMore: page.has_more,
    };
  }
}
