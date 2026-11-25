// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** @see enterprise/modules/billing/specs/billing.feature */
import { stripeDouble } from "@langwatch/test-harness/client-doubles/stripe";
import Stripe from "stripe";
import { describe, expect, it } from "vitest";

import { HttpStripeCustomersChannel } from "../http/http.stripe-customers.channel.ts";
import { MemoryStripeCustomersChannel } from "../memory/memory.stripe-customers.channel.ts";
import type { StripeCustomersChannel } from "../stripe-customers.channel.ts";

type Seed = (input: { id: string; currency: string }) => void;

const missing = (id: string) =>
  new Stripe.errors.StripeInvalidRequestError({
    type: "invalid_request_error",
    code: "resource_missing",
    message: `No such customer: '${id}'`,
  });

/** The provider's customers endpoints as the SDK answers them, held in a map. */
function overTheProvider(): { customers: StripeCustomersChannel; seed: Seed } {
  const held = new Map<string, object>();
  const seed: Seed = ({ id, currency }) => {
    held.set(id, { id, object: "customer", currency });
  };
  const stripe = stripeDouble({
    customers: {
      create: async () => {
        const id = `cus_provider_${held.size + 1}`;
        held.set(id, { id, object: "customer", currency: null });
        return { id, object: "customer" };
      },
      del: async (id: string) => {
        held.set(id, { id, object: "customer", deleted: true });
        return { id, object: "customer", deleted: true };
      },
      retrieve: async (id: string) => {
        const customer = held.get(id);
        if (!customer) throw missing(id);
        return customer;
      },
    },
  });
  return { customers: HttpStripeCustomersChannel.create({ stripe }), seed };
}

function overTheTwin(): { customers: StripeCustomersChannel; seed: Seed } {
  const customers = MemoryStripeCustomersChannel.create();
  return { customers, seed: (input) => customers.seed(input) };
}

const tiers = [
  { tier: "the provider", compose: overTheProvider },
  { tier: "the memory twin", compose: overTheTwin },
];

describe.each(tiers)("Stripe customers over $tier", ({ compose }) => {
  describe("when a customer is created", () => {
    /** @scenario "A Stripe customer reads alike over the provider and its memory twin" */
    it("reads it back with no fixed currency, then deleted once deleted", async () => {
      const { customers } = compose();

      const { id } = await customers.createCustomer({ email: "a@example.com", name: "Acme" });

      expect(id).toMatch(/^cus_/);
      await expect(customers.getCustomer({ customerId: id })).resolves.toEqual({
        id,
        deleted: false,
        currency: null,
      });

      await customers.deleteCustomer({ customerId: id });

      await expect(customers.getCustomer({ customerId: id })).resolves.toEqual({
        id,
        deleted: true,
      });
    });
  });

  describe("when the provider has fixed a customer's currency", () => {
    it("answers that currency", async () => {
      const { customers, seed } = compose();
      seed({ id: "cus_fixed", currency: "eur" });

      await expect(customers.getCustomer({ customerId: "cus_fixed" })).resolves.toEqual({
        id: "cus_fixed",
        deleted: false,
        currency: "eur",
      });
    });
  });

  describe("when the customer was never held", () => {
    it("refuses the read with resource_missing", async () => {
      const { customers } = compose();

      await expect(customers.getCustomer({ customerId: "cus_unknown" })).rejects.toMatchObject({
        code: "resource_missing",
      });
    });
  });
});
