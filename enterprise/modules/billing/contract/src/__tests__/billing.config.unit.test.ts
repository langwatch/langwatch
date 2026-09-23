import { parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { assertBillingServerConfig, billingConfig } from "../billing.config.ts";

describe("billing server configuration", () => {
  describe("given a deployment names where a licence is bought", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("carries the payment link id and the Slack channels as ordinary config", () => {
      const config = parseProcessConfig({
        owners: [{ name: "billing", config: billingConfig }],
        environment: {
          STRIPE_LICENSE_PAYMENT_LINK_ID: "plink_123",
          SLACK_CHANNEL_SUBSCRIPTIONS: "#subscriptions",
          SLACK_CHANNEL_SIGNUPS: "#signups",
          SLACK_CHANNEL_SELF_HOSTED: "#self-hosted",
        },
      });

      expect(config.billing.licensePaymentLinkId).toBe("plink_123");
      expect(config.billing.slackSubscriptionsChannel).toBe("#subscriptions");
      expect(config.billing.slackSignupsChannel).toBe("#signups");
      expect(config.billing.slackSelfHostedChannel).toBe("#self-hosted");
    });
  });

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
