/**
 * The billing ops functions through the function service: an approved session's call, its
 * schema checks and trail row, over billing's API as a stand-in.
 * @see modules/staff-access/specs/staff-access-functions-billing.feature
 */
import { describe, expect, it } from "vitest";

import {
  ACME,
  caller,
  cloudBilling,
  ms,
  NOW,
  selfHostedBilling,
} from "./support/staff-access-billing-world.ts";
import { codeOf } from "./support/staff-access-world.ts";

describe("the billing ops functions", () => {
  describe("given a metadata session on ACME approved for org.billing", () => {
    /** @scenario "org.billing answers the organization's subscription state" */
    /** @scenario "org.billing reads only the approved organization" */
    it("answers ACME's subscription facts and asks billing for ACME only", async () => {
      const asked = { organizations: [] as string[], ranges: [] as [number, number][] };
      const { call } = await caller({
        billing: cloudBilling(asked),
        scopes: ["org:metadata"],
        functions: ["org.billing"],
      });

      const answered = await call("org.billing");

      expect(asked.organizations).toEqual([ACME]);
      expect(answered).toEqual({
        name: "org.billing",
        rows: 1,
        output: {
          organizationId: ACME,
          pricingModel: "seat_event",
          subscriptionId: "sub_new",
          plan: "GROWTH_SEAT_EUR_MONTHLY",
          state: "active",
          createdAt: "2026-11-01T00:00:00.000Z",
          startedAt: "2026-11-01T00:05:00.000Z",
          endedAt: null,
          lastPaymentFailedAt: "2026-11-18T00:00:00.000Z",
          pastDue: true,
          paymentRecoveryStartedAt: "2026-11-18T00:00:00.000Z",
          paymentRecoveryNoticeDay: 1,
          linkedToStripe: true,
          fullSeats: 5,
          liteSeats: null,
          developerSeats: 2,
          eventsCap: null,
          retentionDays: 90,
          seatsKept: null,
          seatsKeptUntil: null,
          subscriptionsByState: { active: 1, cancelled: 1 },
          lastCancelledAt: "2026-10-31T23:00:00.000Z",
          overPlanSince: null,
        },
      });
      await expect(codeOf(call("org.billing", { organizationId: "org_globex" }))).resolves.toBe(
        "staff_function_bad_input",
      );
    });

    /** @scenario "org.billing answers an organization that never subscribed" */
    it("answers state none for an organization that never subscribed", async () => {
      const asked = { organizations: [] as string[], ranges: [] as [number, number][] };
      const { call } = await caller({
        billing: cloudBilling(asked),
        scopes: ["org:metadata"],
        functions: ["org.billing"],
        organization: "globex",
      });

      const { output } = await call("org.billing");

      expect(output).toMatchObject({
        organizationId: "org_globex",
        subscriptionId: null,
        plan: "none",
        state: "none",
        pastDue: false,
        subscriptionsByState: {},
      });
    });
  });

  describe("given an ops:read session", () => {
    /** @scenario "billing.subscriptions counts subscriptions created in a range by plan and state" */
    it("pages subscription counts over the range it asked billing for", async () => {
      const asked = { organizations: [] as string[], ranges: [] as [number, number][] };
      const { call } = await caller({
        billing: cloudBilling(asked),
        scopes: ["ops:read"],
        functions: ["billing.subscriptions"],
      });

      const { output } = await call("billing.subscriptions", { since: "2026-11-01T00:00:00Z" });

      expect(asked.ranges).toEqual([[ms("2026-11-01T00:00:00Z"), NOW.epochMilliseconds]]);
      expect(output).toEqual({
        items: [
          {
            plan: "GROWTH_SEAT_EUR_MONTHLY",
            state: "active",
            subscriptions: 1,
            activated: 1,
            organizations: 1,
          },
          {
            plan: "GROWTH_SEAT_EUR_MONTHLY",
            state: "pending",
            subscriptions: 2,
            activated: 0,
            organizations: 2,
          },
        ],
        total: 2,
        truncated: false,
        nextCursor: null,
      });
    });

    /** @scenario "billing.subscriptions takes at most 31 days" */
    it("refuses a range over 31 days before asking billing", async () => {
      const asked = { organizations: [] as string[], ranges: [] as [number, number][] };
      const { call } = await caller({
        billing: cloudBilling(asked),
        scopes: ["ops:read"],
        functions: ["billing.subscriptions"],
      });

      await expect(
        codeOf(call("billing.subscriptions", { since: "2026-10-10T00:00:00Z" })),
      ).resolves.toBe("staff_function_bad_input");
      expect(asked.ranges).toEqual([]);
    });

    /** @scenario "billing.stripe_prices answers the catalogue with its tax behaviour" */
    it("pages the price catalogue by price id with its tax behaviour", async () => {
      const asked = { organizations: [] as string[], ranges: [] as [number, number][] };
      const { call } = await caller({
        billing: cloudBilling(asked),
        scopes: ["ops:read"],
        functions: ["billing.stripe_prices"],
      });

      const first = await call("billing.stripe_prices", { limit: 1 });
      const firstPage = first.output as { items: { priceId: string }[]; nextCursor: string };
      const second = await call("billing.stripe_prices", {
        limit: 1,
        cursor: firstPage.nextCursor,
      });

      expect(first.output).toMatchObject({
        items: [{ priceId: "price_old", catalogueName: "other", taxBehavior: null, active: false }],
        total: 2,
        truncated: true,
      });
      expect(second.output).toMatchObject({
        items: [{ priceId: "price_seat", taxBehavior: "exclusive", currency: "eur" }],
        truncated: false,
        nextCursor: null,
      });
    });
  });

  describe("given a deployment that is not LangWatch Cloud", () => {
    /** @scenario "A billing function refuses by name off LangWatch Cloud" */
    it("refuses each billing function by name and trails the code", async () => {
      const platform = await caller({
        billing: selfHostedBilling(),
        scopes: ["ops:read"],
        functions: ["billing.stripe_prices", "billing.subscriptions"],
      });
      const org = await caller({
        billing: selfHostedBilling(),
        scopes: ["org:metadata"],
        functions: ["org.billing"],
      });

      await expect(codeOf(org.call("org.billing"))).resolves.toBe("billing_facts_unavailable");
      await expect(
        codeOf(platform.call("billing.subscriptions", { since: "2026-11-01T00:00:00Z" })),
      ).resolves.toBe("billing_facts_unavailable");
      await expect(codeOf(platform.call("billing.stripe_prices"))).resolves.toBe(
        "billing_facts_unavailable",
      );
      const trail = await org.repositories.events.findByRequest({
        requestId: org.session.requestId,
      });
      expect(trail).toEqual([
        expect.objectContaining({
          functionName: "org.billing",
          status: 403,
          errorCode: "billing_facts_unavailable",
        }),
      ]);
    });
  });
});
