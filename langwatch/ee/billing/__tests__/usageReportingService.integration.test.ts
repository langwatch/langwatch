import Stripe from "stripe";
import { afterAll, describe, expect, it } from "vitest";
import { StripeUsageReportingService } from "../services/usageReportingService";
import { meters } from "../stripe/stripePriceCatalog";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

if (!STRIPE_SECRET_KEY) {
  console.warn(
    "Skipping usage reporting integration tests because STRIPE_SECRET_KEY is not set"
  );
}

if (STRIPE_SECRET_KEY && !STRIPE_SECRET_KEY.startsWith("sk_test_")) {
  throw new Error(
    "SAFETY: Stripe integration tests require a TEST key (sk_test_*). " +
      "A live key was detected — aborting to prevent charges on a real account."
  );
}

const describeIfStripeKey = STRIPE_SECRET_KEY ? describe : describe.skip;

describeIfStripeKey("Usage reporting integration", () => {
  const stripe = new Stripe(STRIPE_SECRET_KEY!, { apiVersion: "2024-04-10" });
  const service = new StripeUsageReportingService({
    stripe,
    meterId: meters.BILLABLE_EVENTS,
  });

  const createdCustomerIds: string[] = [];

  afterAll(async () => {
    for (const custId of createdCustomerIds) {
      try {
        await stripe.customers.del(custId);
      } catch {
        // already deleted or cleaned up
      }
    }
  });

  const createTrackedCustomer = async (suffix: string) => {
    const customer = await stripe.customers.create({
      email: `integration-test-usage-${suffix}@langwatch.test`,
      name: `Integration Test Usage ${suffix}`,
    });
    createdCustomerIds.push(customer.id);
    return customer;
  };

  const uniqueId = () =>
    `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  describe("reportUsageDelta()", () => {
    it("sends a meter event to Stripe and returns reported: true", async () => {
      const customer = await createTrackedCustomer("delta-basic");
      const identifier = uniqueId();
      const timestamp = Math.floor(Date.now() / 1000);

      const results = await service.reportUsageDelta({
        stripeCustomerId: customer.id,
        organizationId: "org_integ_test",
        events: [
          {
            eventName: "langwatch_billable_events",
            value: 42,
            timestamp,
            identifier,
          },
        ],
      });

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        identifier,
        reported: true,
        valueSent: 42,
      });
    });

    it("handles duplicate identifier gracefully (does not throw)", async () => {
      const customer = await createTrackedCustomer("delta-dup");
      const identifier = uniqueId();
      const timestamp = Math.floor(Date.now() / 1000);

      const input = {
        stripeCustomerId: customer.id,
        organizationId: "org_integ_test",
        events: [
          {
            eventName: "langwatch_billable_events",
            value: 10,
            timestamp,
            identifier,
          },
        ],
      };

      // First call succeeds
      const first = await service.reportUsageDelta(input);
      expect(first[0]!.reported).toBe(true);

      // Second call with same identifier — Stripe may return
      // resource_already_exists (treated as success) or another
      // InvalidRequestError code. Either way, handled without throwing.
      const second = await service.reportUsageDelta(input);
      expect(second).toHaveLength(1);
    });

    it("skips zero-value events without calling Stripe", async () => {
      const customer = await createTrackedCustomer("delta-zero");
      const identifier = uniqueId();
      const timestamp = Math.floor(Date.now() / 1000);

      const results = await service.reportUsageDelta({
        stripeCustomerId: customer.id,
        organizationId: "org_integ_test",
        events: [
          {
            eventName: "langwatch_billable_events",
            value: 0,
            timestamp,
            identifier,
          },
        ],
      });

      expect(results).toEqual([
        { identifier, reported: false, valueSent: 0 },
      ]);
    });

    it("processes a batch of multiple events sequentially", async () => {
      const customer = await createTrackedCustomer("delta-batch");
      const timestamp = Math.floor(Date.now() / 1000);

      const results = await service.reportUsageDelta({
        stripeCustomerId: customer.id,
        organizationId: "org_integ_test",
        events: [
          {
            eventName: "langwatch_billable_events",
            value: 5,
            timestamp,
            identifier: uniqueId(),
          },
          {
            eventName: "langwatch_billable_events",
            value: 15,
            timestamp,
            identifier: uniqueId(),
          },
          {
            eventName: "langwatch_billable_events",
            value: 25,
            timestamp,
            identifier: uniqueId(),
          },
        ],
      });

      expect(results).toHaveLength(3);
      expect(results[0]!.reported).toBe(true);
      expect(results[0]!.valueSent).toBe(5);
      expect(results[1]!.reported).toBe(true);
      expect(results[1]!.valueSent).toBe(15);
      expect(results[2]!.reported).toBe(true);
      expect(results[2]!.valueSent).toBe(25);
    });
  });

  describe("reportUsageSet()", () => {
    it("sends the delta between value and previouslyReportedValue", async () => {
      const customer = await createTrackedCustomer("set-basic");
      const identifier = uniqueId();
      const timestamp = Math.floor(Date.now() / 1000);

      const results = await service.reportUsageSet({
        stripeCustomerId: customer.id,
        organizationId: "org_integ_test",
        events: [
          {
            eventName: "langwatch_billable_events",
            value: 200,
            previouslyReportedValue: 150,
            timestamp,
            identifier,
          },
        ],
      });

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        identifier,
        reported: true,
        valueSent: 50,
      });
    });

    it("skips when delta is zero (no change)", async () => {
      const customer = await createTrackedCustomer("set-zero");
      const identifier = uniqueId();
      const timestamp = Math.floor(Date.now() / 1000);

      const results = await service.reportUsageSet({
        stripeCustomerId: customer.id,
        organizationId: "org_integ_test",
        events: [
          {
            eventName: "langwatch_billable_events",
            value: 100,
            previouslyReportedValue: 100,
            timestamp,
            identifier,
          },
        ],
      });

      expect(results).toEqual([
        { identifier, reported: false, valueSent: 0 },
      ]);
    });

    it("skips when delta is negative (count decreased)", async () => {
      const customer = await createTrackedCustomer("set-neg");
      const identifier = uniqueId();
      const timestamp = Math.floor(Date.now() / 1000);

      const results = await service.reportUsageSet({
        stripeCustomerId: customer.id,
        organizationId: "org_integ_test",
        events: [
          {
            eventName: "langwatch_billable_events",
            value: 50,
            previouslyReportedValue: 100,
            timestamp,
            identifier,
          },
        ],
      });

      expect(results).toEqual([
        { identifier, reported: false, valueSent: 0 },
      ]);
    });

    it("sends full value when previouslyReportedValue is zero", async () => {
      const customer = await createTrackedCustomer("set-first");
      const identifier = uniqueId();
      const timestamp = Math.floor(Date.now() / 1000);

      const results = await service.reportUsageSet({
        stripeCustomerId: customer.id,
        organizationId: "org_integ_test",
        events: [
          {
            eventName: "langwatch_billable_events",
            value: 300,
            previouslyReportedValue: 0,
            timestamp,
            identifier,
          },
        ],
      });

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        identifier,
        reported: true,
        valueSent: 300,
      });
    });

    it("handles batch with mixed deltas — only positive deltas hit Stripe", async () => {
      const customer = await createTrackedCustomer("set-mixed");
      const timestamp = Math.floor(Date.now() / 1000);

      const results = await service.reportUsageSet({
        stripeCustomerId: customer.id,
        organizationId: "org_integ_test",
        events: [
          {
            eventName: "langwatch_billable_events",
            value: 200,
            previouslyReportedValue: 100,
            timestamp,
            identifier: uniqueId(),
          },
          {
            eventName: "langwatch_billable_events",
            value: 50,
            previouslyReportedValue: 50,
            timestamp,
            identifier: uniqueId(),
          },
          {
            eventName: "langwatch_billable_events",
            value: 500,
            previouslyReportedValue: 0,
            timestamp,
            identifier: uniqueId(),
          },
        ],
      });

      expect(results).toHaveLength(3);
      expect(results[0]!.reported).toBe(true);
      expect(results[0]!.valueSent).toBe(100);
      expect(results[1]!.reported).toBe(false);
      expect(results[1]!.valueSent).toBe(0);
      expect(results[2]!.reported).toBe(true);
      expect(results[2]!.valueSent).toBe(500);
    });
  });

  describe("getUsageSummary()", () => {
    /**
     * Prerequisite: This test uses a persistent Stripe test customer that
     * accumulates meter events across runs. Stripe's Billing Meter Event
     * Summaries API has aggregation lag — events reported in the current
     * run may not appear in summaries until minutes later.
     *
     * On the FIRST run against a fresh Stripe test account, the
     * "returns aggregated usage" test WILL FAIL because no previously
     * aggregated data exists yet. Run the suite a second time and it
     * will pass once Stripe has processed the events from the first run.
     *
     * The persistent customer is identified by email and is intentionally
     * NOT cleaned up in afterAll so it retains history across runs.
     */
    const findOrCreatePersistentCustomer = async () => {
      const email = "integration-test-usage-summary-persistent@langwatch.test";
      const existing = await stripe.customers.list({ email, limit: 1 });
      if (existing.data[0]) return existing.data[0];

      const customer = await stripe.customers.create({
        email,
        name: "Integration Test Usage Summary (persistent)",
      });
      // Do NOT track for cleanup — this customer persists across runs
      return customer;
    };

    it("returns aggregated usage for a customer with historical events", async () => {
      const customer = await findOrCreatePersistentCustomer();
      const now = Math.floor(Date.now() / 1000);

      // Report an event so future runs will have aggregated data
      await service.reportUsageDelta({
        stripeCustomerId: customer.id,
        organizationId: "org_integ_test",
        events: [
          {
            eventName: "langwatch_billable_events",
            value: 10,
            timestamp: now,
            identifier: uniqueId(),
          },
        ],
      });

      // Query broad range — events from previous runs should be aggregated
      const result = await service.getUsageSummary({
        stripeCustomerId: customer.id,
        startTime: now - 86400 * 30,
        endTime: now + 86400,
      });

      expect(result).toEqual({
        aggregatedValue: expect.any(Number),
        startTime: now - 86400 * 30,
        endTime: now + 86400,
      });
      // Will be 0 on first-ever run due to aggregation lag, >0 on subsequent runs
      expect(result.aggregatedValue).toBeGreaterThan(0);
    });

    it("returns zero for a future time range with no events", async () => {
      const customer = await createTrackedCustomer("summary-empty");
      const futureStart = Math.floor(Date.now() / 1000) + 86400 * 365;
      const futureEnd = futureStart + 3600;

      const result = await service.getUsageSummary({
        stripeCustomerId: customer.id,
        startTime: futureStart,
        endTime: futureEnd,
      });

      expect(result).toEqual({
        aggregatedValue: 0,
        startTime: futureStart,
        endTime: futureEnd,
      });
    });
  });

  describe("error handling with real Stripe API", () => {
    it("returns reported: false for invalid customer ID", async () => {
      const identifier = uniqueId();
      const timestamp = Math.floor(Date.now() / 1000);

      const results = await service.reportUsageDelta({
        stripeCustomerId: "cus_nonexistent000000",
        organizationId: "org_integ_test",
        events: [
          {
            eventName: "langwatch_billable_events",
            value: 10,
            timestamp,
            identifier,
          },
        ],
      });

      expect(results).toHaveLength(1);
      expect(results[0]!.reported).toBe(false);
      expect(results[0]!.error).toBeDefined();
    });
  });
});
