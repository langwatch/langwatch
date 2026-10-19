// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** @see enterprise/modules/billing/specs/billing.feature */
import { stripeDouble } from "@langwatch/test-harness/client-doubles/stripe";
import Stripe from "stripe";
import { describe, expect, it } from "vitest";

import { HttpStripeMetersChannel } from "../http/http.stripe-meters.channel.ts";
import { MemoryStripeMetersChannel } from "../memory/memory.stripe-meters.channel.ts";
import type {
  StripeMeter,
  StripeMeterEvent,
  StripeMetersChannel,
} from "../stripe-meters.channel.ts";

const METERS: StripeMeter[] = [
  { id: "mtr_a", eventName: "langwatch_billable_events", status: "active" },
  { id: "mtr_b", eventName: "langwatch_instant_eval_usd", status: "inactive" },
];

const SUMMARIES = [
  { meterId: "mtr_a", customerId: "cus_1", startTime: 1_700_000_000, aggregatedValue: 40 },
  { meterId: "mtr_a", customerId: "cus_1", startTime: 1_700_086_400, aggregatedValue: 2 },
];

const WINDOW = { startTime: 1_700_000_000, endTime: 1_700_172_800 };

const EVENT: StripeMeterEvent = {
  eventName: "langwatch_billable_events",
  customerId: "cus_1",
  value: "1.2345",
  identifier: "org_1:langwatch_billable_events:2026-02-19:d100",
  timestamp: 1_708_300_800,
};

const rateLimited = () =>
  new Stripe.errors.StripeRateLimitError({ type: "rate_limit_error", message: "slow down" });

type Composed = { meters: StripeMetersChannel; recorded: () => StripeMeterEvent[] };

/** The provider's meter endpoints as the SDK answers them, recording what it was sent. */
function overTheProvider({ refused }: { refused?: Error } = {}): Composed {
  const sent: Stripe.Billing.MeterEventCreateParams[] = [];
  const stripe = stripeDouble({
    billing: {
      meterEvents: {
        create: async (params: Stripe.Billing.MeterEventCreateParams) => {
          if (refused) throw refused;
          if (sent.some((held) => held.identifier === params.identifier)) {
            throw new Stripe.errors.StripeInvalidRequestError({
              type: "invalid_request_error",
              code: "resource_already_exists",
              message: "duplicate",
            });
          }
          sent.push(params);
          return { object: "billing.meter_event", ...params } as Stripe.Billing.MeterEvent;
        },
      },
      meters: {
        list: async (params?: Stripe.Billing.MeterListParams | Stripe.RequestOptions) => {
          const asked: Stripe.Billing.MeterListParams = params && "limit" in params ? params : {};
          const after = METERS.findIndex((meter) => meter.id === asked.starting_after);
          const page = METERS.slice(after + 1, after + 1 + (asked.limit ?? 10));
          const data = page.map(
            ({ id, eventName, status }) =>
              ({
                id,
                object: "billing.meter",
                event_name: eventName,
                status,
              }) as Stripe.Billing.Meter,
          );
          const hasMore = after + 1 + page.length < METERS.length;
          return { object: "list", data, has_more: hasMore, url: "/v1/billing/meters" };
        },
        listEventSummaries: async (
          meterId: string,
          params: Stripe.Billing.MeterListEventSummariesParams,
        ) => {
          const data = SUMMARIES.filter(
            (held) =>
              held.meterId === meterId &&
              held.customerId === params.customer &&
              held.startTime >= params.start_time &&
              held.startTime < params.end_time,
          ).map(
            (held) =>
              ({
                object: "billing.meter_event_summary",
                meter: held.meterId,
                start_time: held.startTime,
                aggregated_value: held.aggregatedValue,
              }) as Stripe.Billing.MeterEventSummary,
          );
          return { object: "list", data, has_more: false, url: "/v1/billing/meters/summaries" };
        },
      },
    },
  });
  return {
    meters: HttpStripeMetersChannel.create({ stripe }),
    recorded: () =>
      sent.map((params) => ({
        eventName: params.event_name,
        customerId: params.payload.stripe_customer_id ?? "",
        value: params.payload.value ?? "",
        identifier: params.identifier ?? "",
        timestamp: params.timestamp ?? 0,
      })),
  };
}

function overTheTwin({ refused }: { refused?: Error } = {}): Composed {
  const meters = MemoryStripeMetersChannel.create();
  for (const meter of METERS) meters.seedMeter({ meter });
  for (const summary of SUMMARIES) meters.seedSummary({ summary });
  if (refused) meters.refuse({ operation: "createMeterEvent", error: refused });
  return { meters, recorded: () => meters.events };
}

const tiers = [
  { tier: "the provider", compose: overTheProvider },
  { tier: "the memory twin", compose: overTheTwin },
];

describe.each(tiers)("Stripe meters over $tier", ({ compose }) => {
  describe("given two meters and one meter's summaries for a customer", () => {
    /** @scenario "Stripe usage meters record and summarise alike over the provider and its memory twin" */
    it("records a meter event with its name, customer, value, identifier and timestamp", async () => {
      const { meters, recorded } = compose();

      await meters.createMeterEvent(EVENT);

      expect(recorded()).toEqual([EVENT]);
    });

    it("refuses a second event with the same identifier with resource_already_exists", async () => {
      const { meters } = compose();
      await meters.createMeterEvent(EVENT);

      await expect(meters.createMeterEvent(EVENT)).rejects.toMatchObject({
        code: "resource_already_exists",
      });
    });

    it("answers each meter with its event name and status, one to a page", async () => {
      const { meters } = compose();

      const first = await meters.listMeters({ limit: 1 });
      const second = await meters.listMeters({ limit: 1, startingAfter: "mtr_a" });

      expect(first).toEqual({ meters: [METERS[0]], hasMore: true });
      expect(second).toEqual({ meters: [METERS[1]], hasMore: false });
    });

    it("answers the customer's summarised values for the window and none for another", async () => {
      const { meters } = compose();

      const summaries = await meters.listEventSummaries({
        meterId: "mtr_a",
        customerId: "cus_1",
        ...WINDOW,
      });
      const none = await meters.listEventSummaries({
        meterId: "mtr_a",
        customerId: "cus_2",
        ...WINDOW,
      });

      expect(summaries).toEqual([{ aggregatedValue: 40 }, { aggregatedValue: 2 }]);
      expect(none).toEqual([]);
    });
  });

  describe("when the provider refuses the meter event", () => {
    it("passes the provider's own error through", async () => {
      const { meters } = compose({ refused: rateLimited() });

      await expect(meters.createMeterEvent(EVENT)).rejects.toMatchObject({
        type: "StripeRateLimitError",
      });
    });
  });
});
