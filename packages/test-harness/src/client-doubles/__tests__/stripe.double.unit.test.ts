import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

import { stripeDouble } from "../stripe.double.ts";

const subscription = { id: "sub_1", items: { data: [] } };

describe("given a Stripe double", () => {
  describe("when the code calls a scripted resource method", () => {
    /** @scenario "A scripted member answers what the test scripted" */
    it("answers the scripted object and records the call", async () => {
      const retrieve = vi.fn().mockResolvedValue(subscription);
      const stripe = stripeDouble({ subscriptions: { retrieve } });

      await expect(stripe.subscriptions.retrieve("sub_1")).resolves.toBe(subscription);
      expect(retrieve).toHaveBeenCalledWith("sub_1");
    });
  });

  describe("when the code calls a resource method nobody scripted", () => {
    /** @scenario "An unscripted method throws naming its path" */
    it("throws naming the resource method", () => {
      const stripe = stripeDouble({ subscriptions: { retrieve: async () => subscription } });

      expect(() => stripe.subscriptions.update("sub_1", {})).toThrow(
        "stripe.subscriptions.update is not scripted",
      );
    });
  });

  describe("when the code calls into a resource group nobody scripted", () => {
    /** @scenario "An unscripted namespace throws at the member the code calls" */
    it("throws naming the full path", () => {
      const stripe = stripeDouble();

      expect(() => stripe.checkout.sessions.create({})).toThrow(
        "stripe.checkout.sessions.create is not scripted",
      );
    });
  });

  describe("when it is handed to code that wants the SDK client", () => {
    /** @scenario "A client double typechecks as the real client" */
    it("is a Stripe client without a cast", () => {
      const stripe: Stripe = stripeDouble();

      expect(stripe).toBeInstanceOf(Stripe);
    });
  });
});
