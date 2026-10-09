// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import Stripe from "stripe";

import {
  type StripeMeter,
  type StripeMeterEvent,
  type StripeMeterEventSummary,
  type StripeMeterPage,
  StripeMetersChannel,
} from "../stripe-meters.channel.ts";

type Operation = keyof StripeMetersChannel;

type HeldSummary = Readonly<{
  meterId: string;
  customerId: string;
  /** The start of the summarised window, in Unix seconds. */
  startTime: number;
  aggregatedValue: number;
}>;

/**
 * Stripe's meters where no provider is composed: keeps every event recorded and
 * refuses a repeated identifier with `resource_already_exists`, as Stripe does;
 * answers seeded meters a page at a time and seeded summaries by window.
 */
export class MemoryStripeMetersChannel extends StripeMetersChannel {
  readonly events: StripeMeterEvent[] = [];
  private readonly meters: StripeMeter[] = [];
  private readonly summaries: HeldSummary[] = [];
  private readonly refusals = new Map<Operation, Error>();

  private constructor() {
    super();
  }

  static create(): MemoryStripeMetersChannel {
    return new MemoryStripeMetersChannel();
  }

  /** Puts a meter in the account. */
  seedMeter({ meter }: { meter: StripeMeter }): void {
    this.meters.push(meter);
  }

  /** Puts a summarised window of a customer's usage on a meter. */
  seedSummary({ summary }: { summary: HeldSummary }): void {
    this.summaries.push(summary);
  }

  /** Makes `operation` throw `error` from now on, as a failing provider would. */
  refuse({ operation, error }: { operation: Operation; error: Error }): void {
    this.refusals.set(operation, error);
  }

  async createMeterEvent(event: StripeMeterEvent): Promise<void> {
    this.throwIfRefused("createMeterEvent");
    if (this.events.some((held) => held.identifier === event.identifier)) {
      throw new Stripe.errors.StripeInvalidRequestError({
        type: "invalid_request_error",
        code: "resource_already_exists",
        message: `An event already exists with identifier ${event.identifier}.`,
      });
    }
    this.events.push(event);
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
    this.throwIfRefused("listEventSummaries");
    return this.summaries
      .filter(
        (held) =>
          held.meterId === meterId &&
          held.customerId === customerId &&
          held.startTime >= startTime &&
          held.startTime < endTime,
      )
      .map(({ aggregatedValue }) => ({ aggregatedValue }));
  }

  async listMeters({
    limit,
    startingAfter,
  }: {
    limit: number;
    startingAfter?: string;
  }): Promise<StripeMeterPage> {
    this.throwIfRefused("listMeters");
    const start = startingAfter === undefined ? 0 : this.indexOf(startingAfter) + 1;
    return {
      meters: this.meters.slice(start, start + limit),
      hasMore: start + limit < this.meters.length,
    };
  }

  private throwIfRefused(operation: Operation): void {
    const refusal = this.refusals.get(operation);
    if (refusal) throw refusal;
  }

  private indexOf(meterId: string): number {
    const index = this.meters.findIndex((meter) => meter.id === meterId);
    if (index >= 0) return index;
    throw new Stripe.errors.StripeInvalidRequestError({
      type: "invalid_request_error",
      code: "resource_missing",
      message: `No such meter: '${meterId}'`,
    });
  }
}
