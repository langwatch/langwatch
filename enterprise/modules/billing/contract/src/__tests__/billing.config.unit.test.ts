import { describe, expect, it } from "vitest";
import { assertBillingServerConfig } from "../billing.config.ts";

describe("billing server configuration", () => {
  describe("given a deployment bills through nobody", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("accepts both credentials absent", () => {
      expect(() => assertBillingServerConfig({})).not.toThrow();
    });
  });

  describe("given only the payment key is configured", () => {
    /** @scenario "A cross-field rule refuses a half-configured feature at boot" */
    it("refuses rather than mounting a webhook that cannot verify a delivery", () => {
      expect(() => assertBillingServerConfig({ stripeSecretKey: "sk-test" })).toThrow(
        /STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET/,
      );
    });
  });
});
