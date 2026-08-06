import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../stripe/stripePriceCatalog", () => ({
  prices: {
    GROWTH_SEAT_EUR_MONTHLY: "price_seat_eur_monthly",
    GROWTH_SEAT_EUR_ANNUAL: "price_seat_eur_annual",
    GROWTH_SEAT_USD_MONTHLY: "price_seat_usd_monthly",
    GROWTH_SEAT_USD_ANNUAL: "price_seat_usd_annual",
    GROWTH_EVENTS_EUR_MONTHLY: "price_events_eur_monthly",
    GROWTH_EVENTS_EUR_ANNUAL: "price_events_eur_annual",
    GROWTH_EVENTS_USD_MONTHLY: "price_events_usd_monthly",
    GROWTH_EVENTS_USD_ANNUAL: "price_events_usd_annual",
    GROWTH_EVENTS_EUR_MONTHLY_UNTIL_MAR_2026:
      "price_events_eur_monthly_until_mar_2026",
    GROWTH_EVENTS_EUR_ANNUAL_UNTIL_MAR_2026:
      "price_events_eur_annual_until_mar_2026",
    GROWTH_EVENTS_USD_MONTHLY_UNTIL_MAR_2026:
      "price_events_usd_monthly_until_mar_2026",
    GROWTH_EVENTS_USD_ANNUAL_UNTIL_MAR_2026:
      "price_events_usd_annual_until_mar_2026",
  },
}));

import type { PrismaClient } from "@prisma/client";
import type Stripe from "stripe";
import { runAnnualEventsThresholdBackfill } from "../stripe/annualEventsThresholdBackfill";

const makeCandidate = ({
  id,
  stripeSubscriptionId,
}: {
  id: string;
  stripeSubscriptionId: string;
}) => ({
  id,
  plan: "GROWTH_SEAT_USD_ANNUAL",
  stripeSubscriptionId,
});

const makeStripeSubscription = (priceIds: string[]) => ({
  billing_thresholds: null,
  items: { data: priceIds.map((id) => ({ price: { id } })) },
});

const makePrisma = (candidates: unknown[]) =>
  ({
    subscription: { findMany: vi.fn().mockResolvedValue(candidates) },
  }) as unknown as PrismaClient & {
    subscription: { findMany: ReturnType<typeof vi.fn> };
  };

describe("runAnnualEventsThresholdBackfill", () => {
  const log = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given candidates mixing annual, monthly, and legacy item shapes", () => {
    /** @scenario The backfill applies the threshold only to annual event subscriptions */
    it("updates only subscriptions carrying an annual events price", async () => {
      const subscriptionsInStripe: Record<string, unknown> = {
        sub_annual: makeStripeSubscription([
          "price_seat_usd_annual",
          "price_events_usd_annual",
        ]),
        sub_stale_plan: makeStripeSubscription([
          "price_seat_usd_monthly",
          "price_events_usd_monthly",
        ]),
        sub_grandfathered: makeStripeSubscription([
          "price_seat_eur_annual",
          "price_events_eur_annual_until_mar_2026",
        ]),
      };
      const stripe = {
        subscriptions: {
          retrieve: vi
            .fn()
            .mockImplementation((id: string) =>
              Promise.resolve(subscriptionsInStripe[id]),
            ),
          update: vi.fn().mockResolvedValue({}),
        },
      } as unknown as Stripe & {
        subscriptions: { update: ReturnType<typeof vi.fn> };
      };
      const prisma = makePrisma([
        makeCandidate({ id: "db_1", stripeSubscriptionId: "sub_annual" }),
        makeCandidate({ id: "db_2", stripeSubscriptionId: "sub_stale_plan" }),
        makeCandidate({
          id: "db_3",
          stripeSubscriptionId: "sub_grandfathered",
        }),
      ]);

      const tally = await runAnnualEventsThresholdBackfill({
        prisma,
        stripe,
        isDryRun: false,
        log,
      });

      expect(tally).toMatchObject({
        applied: 2,
        not_annual_events: 1,
        failed: 0,
      });
      expect(stripe.subscriptions.update).toHaveBeenCalledTimes(2);
      const updatedIds = stripe.subscriptions.update.mock.calls.map(
        (call) => call[0],
      );
      expect(updatedIds).toEqual(["sub_annual", "sub_grandfathered"]);
    });
  });

  describe("given one subscription that fails in Stripe", () => {
    /** @scenario A failure on one subscription does not stop the backfill */
    it("processes the remaining candidates and counts the failure", async () => {
      const stripe = {
        subscriptions: {
          retrieve: vi
            .fn()
            .mockImplementationOnce(() =>
              Promise.reject(new Error("stripe down")),
            )
            .mockResolvedValue(
              makeStripeSubscription([
                "price_seat_usd_annual",
                "price_events_usd_annual",
              ]),
            ),
          update: vi.fn().mockResolvedValue({}),
        },
      } as unknown as Stripe & {
        subscriptions: { update: ReturnType<typeof vi.fn> };
      };
      const prisma = makePrisma([
        makeCandidate({ id: "db_1", stripeSubscriptionId: "sub_failing" }),
        makeCandidate({ id: "db_2", stripeSubscriptionId: "sub_healthy" }),
      ]);

      const tally = await runAnnualEventsThresholdBackfill({
        prisma,
        stripe,
        isDryRun: false,
        log,
      });

      expect(tally).toMatchObject({ applied: 1, failed: 1 });
      expect(stripe.subscriptions.update).toHaveBeenCalledWith("sub_healthy", {
        billing_thresholds: expect.objectContaining({
          reset_billing_cycle_anchor: false,
        }),
      });
    });
  });

  describe("given dry-run mode", () => {
    it("reports what would change without calling Stripe update", async () => {
      const stripe = {
        subscriptions: {
          retrieve: vi
            .fn()
            .mockResolvedValue(
              makeStripeSubscription([
                "price_seat_usd_annual",
                "price_events_usd_annual",
              ]),
            ),
          update: vi.fn().mockResolvedValue({}),
        },
      } as unknown as Stripe & {
        subscriptions: { update: ReturnType<typeof vi.fn> };
      };
      const prisma = makePrisma([
        makeCandidate({ id: "db_1", stripeSubscriptionId: "sub_annual" }),
      ]);

      const tally = await runAnnualEventsThresholdBackfill({
        prisma,
        stripe,
        isDryRun: true,
        log,
      });

      expect(tally.applied).toBe(1);
      expect(stripe.subscriptions.update).not.toHaveBeenCalled();
      expect(
        log.mock.calls.some((call) =>
          String(call[0]).includes("would be applied"),
        ),
      ).toBe(true);
    });
  });

  describe("given the candidate query", () => {
    it("filters to active Stripe-linked annual Growth plans", async () => {
      const stripe = {
        subscriptions: { retrieve: vi.fn(), update: vi.fn() },
      } as unknown as Stripe;
      const prisma = makePrisma([]);

      await runAnnualEventsThresholdBackfill({
        prisma,
        stripe,
        isDryRun: false,
        log,
      });

      expect(prisma.subscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: "ACTIVE",
            stripeSubscriptionId: { not: null },
            plan: { in: ["GROWTH_SEAT_EUR_ANNUAL", "GROWTH_SEAT_USD_ANNUAL"] },
          },
        }),
      );
    });
  });
});
