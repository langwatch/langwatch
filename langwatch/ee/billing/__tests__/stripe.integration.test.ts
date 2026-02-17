import Stripe from "stripe";
import { afterAll, describe, expect, it } from "vitest";
import { STRIPE_PRICE_NAMES } from "../stripePrices.types";
import { getItemsToUpdate, prices } from "../stripeHelpers";
import { PlanTypes } from "../planTypes";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

if (!STRIPE_SECRET_KEY) {
  console.warn(
    "Skipping Stripe billing integration tests because STRIPE_SECRET_KEY is not set",
  );
}

if (STRIPE_SECRET_KEY && !STRIPE_SECRET_KEY.startsWith("sk_test_")) {
  throw new Error(
    "SAFETY: Stripe integration tests require a TEST key (sk_test_*). " +
      "A live key was detected — aborting to prevent charges on a real account.",
  );
}

const describeIfStripeKey = STRIPE_SECRET_KEY ? describe : describe.skip;

describeIfStripeKey("Stripe billing integration", () => {
  const stripe = new Stripe(STRIPE_SECRET_KEY!, { apiVersion: "2024-04-10" });

  const createdCustomerIds: string[] = [];
  const createdSubscriptionIds: string[] = [];

  afterAll(async () => {
    for (const subId of createdSubscriptionIds) {
      try {
        await stripe.subscriptions.cancel(subId);
      } catch {
        // already cancelled or cleaned up
      }
    }
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
      email: `integration-test-${suffix}@langwatch.test`,
      name: `Integration Test ${suffix}`,
    });
    createdCustomerIds.push(customer.id);
    return customer;
  };

  const attachTestPaymentMethod = async (customerId: string) => {
    const paymentMethod = await stripe.paymentMethods.create({
      type: "card",
      card: { token: "tok_visa" },
    });
    await stripe.paymentMethods.attach(paymentMethod.id, {
      customer: customerId,
    });
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethod.id },
    });
    return paymentMethod;
  };

  describe("customer CRUD", () => {
    it("creates a customer with email and name", async () => {
      const customer = await createTrackedCustomer("crud");

      expect(customer.id).toMatch(/^cus_/);
      expect(customer.email).toBe(
        "integration-test-crud@langwatch.test",
      );
      expect(customer.name).toBe("Integration Test crud");
    });

    it("deletes a customer", async () => {
      const customer = await createTrackedCustomer("delete");

      const deleted = await stripe.customers.del(customer.id);

      expect(deleted.deleted).toBe(true);
      // Remove from cleanup list since it's already deleted
      const idx = createdCustomerIds.indexOf(customer.id);
      if (idx !== -1) createdCustomerIds.splice(idx, 1);
    });
  });

  describe("price catalog verification", () => {
    it("confirms all mapped price IDs are active in Stripe", async () => {
      for (const priceName of STRIPE_PRICE_NAMES) {
        const priceId = prices[priceName];
        expect(priceId).toBeDefined();

        const stripePrice = await stripe.prices.retrieve(priceId);

        expect(stripePrice.active).toBe(true);
      }
    }, 120_000);

    it("confirms base plan prices are recurring", async () => {
      const basePriceNames = [
        "LAUNCH",
        "LAUNCH_ANNUAL",
        "ACCELERATE",
        "ACCELERATE_ANNUAL",
        "PRO",
        "GROWTH",
      ] as const;

      for (const name of basePriceNames) {
        const priceId = prices[name];
        const stripePrice = await stripe.prices.retrieve(priceId);

        expect(stripePrice.type).toBe("recurring");
        expect(stripePrice.recurring).not.toBeNull();
      }
    }, 120_000);
  });

  describe("subscription lifecycle", () => {
    let customerId: string;
    let subscriptionId: string;

    it("sets up customer with payment method", async () => {
      const customer = await createTrackedCustomer("lifecycle");
      customerId = customer.id;
      await attachTestPaymentMethod(customerId);
    });

    it("creates a subscription with LAUNCH base price", async () => {
      const subscription = await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: prices.LAUNCH, quantity: 1 }],
      });
      subscriptionId = subscription.id;
      createdSubscriptionIds.push(subscriptionId);

      expect(subscription.status).toBe("active");
      expect(subscription.items.data).toHaveLength(1);
      expect(subscription.items.data[0]!.price.id).toBe(prices.LAUNCH);
    });

    it("retrieves the subscription and verifies data", async () => {
      const subscription =
        await stripe.subscriptions.retrieve(subscriptionId);

      expect(subscription.id).toBe(subscriptionId);
      expect(subscription.customer).toBe(customerId);
      expect(subscription.status).toBe("active");
    });

    it("adds user and traces add-on items", async () => {
      const updated = await stripe.subscriptions.update(subscriptionId, {
        items: [
          { price: prices.LAUNCH_USERS, quantity: 2 },
          { price: prices.LAUNCH_TRACES_10K, quantity: 3 },
        ],
      });

      const priceIds = updated.items.data.map((item) => item.price.id);
      expect(priceIds).toContain(prices.LAUNCH);
      expect(priceIds).toContain(prices.LAUNCH_USERS);
      expect(priceIds).toContain(prices.LAUNCH_TRACES_10K);

      const usersItem = updated.items.data.find(
        (item) => item.price.id === prices.LAUNCH_USERS,
      );
      const tracesItem = updated.items.data.find(
        (item) => item.price.id === prices.LAUNCH_TRACES_10K,
      );
      expect(usersItem!.quantity).toBe(2);
      expect(tracesItem!.quantity).toBe(3);
    });

    it("switches from LAUNCH to ACCELERATE plan", async () => {
      const current =
        await stripe.subscriptions.retrieve(subscriptionId);
      const currentItems = current.items.data;

      // Delete all current items and add ACCELERATE base
      const itemUpdates: Stripe.SubscriptionUpdateParams.Item[] =
        currentItems.map((item) => ({ id: item.id, deleted: true }));
      itemUpdates.push({ price: prices.ACCELERATE, quantity: 1 });

      const updated = await stripe.subscriptions.update(subscriptionId, {
        items: itemUpdates,
      });

      const priceIds = updated.items.data.map((item) => item.price.id);
      expect(priceIds).toContain(prices.ACCELERATE);
      expect(priceIds).not.toContain(prices.LAUNCH);
      expect(priceIds).not.toContain(prices.LAUNCH_USERS);
      expect(priceIds).not.toContain(prices.LAUNCH_TRACES_10K);
    });

    it("cancels the subscription", async () => {
      const cancelled =
        await stripe.subscriptions.cancel(subscriptionId);

      expect(cancelled.status).toBe("canceled");
      // Remove from cleanup since already cancelled
      const idx = createdSubscriptionIds.indexOf(subscriptionId);
      if (idx !== -1) createdSubscriptionIds.splice(idx, 1);
    });
  });

  describe("checkout session creation", () => {
    it("creates a checkout session matching subscriptionRouter.create payload", async () => {
      const customer = await createTrackedCustomer("checkout");

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customer.id,
        customer_update: {
          address: "auto",
          name: "auto",
        },
        automatic_tax: { enabled: true },
        billing_address_collection: "required",
        tax_id_collection: { enabled: true },
        line_items: [{ price: prices.LAUNCH, quantity: 1 }],
        success_url: "https://app.langwatch.test/settings/subscription?success",
        cancel_url: "https://app.langwatch.test/settings/subscription",
        client_reference_id: "subscription_setup_test-sub-id",
        allow_promotion_codes: true,
      });

      expect(session.id).toMatch(/^cs_test_/);
      expect(session.url).toContain("checkout.stripe.com");
      expect(session.client_reference_id).toBe(
        "subscription_setup_test-sub-id",
      );
    });
  });

  describe("billing portal session", () => {
    it("creates a portal session for a customer", async () => {
      const customer = await createTrackedCustomer("portal");

      const session = await stripe.billingPortal.sessions.create({
        customer: customer.id,
        return_url: "https://app.langwatch.test/settings/subscription",
      });

      expect(session.url).toContain("billing.stripe.com");
      expect(session.customer).toBe(customer.id);
    });
  });

  describe("getItemsToUpdate with real Stripe data", () => {
    it("produces output that Stripe accepts for a subscription update", async () => {
      const customer = await createTrackedCustomer("bridge");
      await attachTestPaymentMethod(customer.id);

      // Create a LAUNCH subscription with add-ons
      const subscription = await stripe.subscriptions.create({
        customer: customer.id,
        items: [
          { price: prices.LAUNCH, quantity: 1 },
          { price: prices.LAUNCH_USERS, quantity: 2 },
          { price: prices.LAUNCH_TRACES_10K, quantity: 1 },
        ],
      });
      createdSubscriptionIds.push(subscription.id);

      // Feed real subscription items into getItemsToUpdate
      const itemsToUpdate = getItemsToUpdate({
        currentItems: subscription.items.data,
        plan: PlanTypes.LAUNCH,
        tracesToAdd: 50_000,
        membersToAdd: 8,
      });

      // Apply to Stripe — the real proof it works
      const updated = await stripe.subscriptions.update(subscription.id, {
        items: itemsToUpdate,
      });

      expect(updated.status).toBe("active");

      const tracesItem = updated.items.data.find(
        (item) => item.price.id === prices.LAUNCH_TRACES_10K,
      );
      const usersItem = updated.items.data.find(
        (item) => item.price.id === prices.LAUNCH_USERS,
      );
      // 50_000 total - 20_000 included = 30_000 extra / 10_000 = 3
      expect(tracesItem!.quantity).toBe(3);
      // 8 total - 3 included = 5
      expect(usersItem!.quantity).toBe(5);
    });

    it("handles plan switch from LAUNCH to ACCELERATE via getItemsToUpdate", async () => {
      const customer = await createTrackedCustomer("bridge-switch");
      await attachTestPaymentMethod(customer.id);

      const subscription = await stripe.subscriptions.create({
        customer: customer.id,
        items: [
          { price: prices.LAUNCH, quantity: 1 },
          { price: prices.LAUNCH_USERS, quantity: 2 },
          { price: prices.LAUNCH_TRACES_10K, quantity: 3 },
        ],
      });
      createdSubscriptionIds.push(subscription.id);

      const itemsToUpdate = getItemsToUpdate({
        currentItems: subscription.items.data,
        plan: PlanTypes.ACCELERATE,
        tracesToAdd: 250_000,
        membersToAdd: 9,
      });

      const updated = await stripe.subscriptions.update(subscription.id, {
        items: itemsToUpdate,
      });

      expect(updated.status).toBe("active");

      const priceIds = updated.items.data.map((item) => item.price.id);
      expect(priceIds).toContain(prices.ACCELERATE);
      expect(priceIds).not.toContain(prices.LAUNCH);
      expect(priceIds).not.toContain(prices.LAUNCH_USERS);
      expect(priceIds).not.toContain(prices.LAUNCH_TRACES_10K);

      // 250_000 - 20_000 included = 230_000 / 100_000 = 2
      const tracesItem = updated.items.data.find(
        (item) => item.price.id === prices.ACCELERATE_TRACES_100K,
      );
      expect(tracesItem!.quantity).toBe(2);

      // 9 - 5 included = 4
      const usersItem = updated.items.data.find(
        (item) => item.price.id === prices.ACCELERATE_USERS,
      );
      expect(usersItem!.quantity).toBe(4);
    });
  });
});
