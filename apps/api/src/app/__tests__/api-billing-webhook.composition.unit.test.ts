/**
 * `POST /api/webhooks/stripe`: the door exists everywhere, the dispatcher only
 * where Stripe is. @see enterprise/modules/billing/specs/stripe-webhook.feature
 */
// @vitest-environment node
import type { OrganizationService } from "@langwatch/organization-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { openTestRestDoors } from "../../app-rest/__tests__/support/rest-doors.harness.ts";
import { composeApiBillingWebhook } from "../api-billing-webhook.composition.ts";
import type { ApiBillingConfig } from "../../platform/config/api.config.ts";

const STRIPE_CONFIG: ApiBillingConfig = {
  stripeSecretKey: "sk_test_composition",
  stripeWebhookSecret: "whsec_composition",
  licensePaymentLinkId: "plink_licence",
  licensePrivateKey: undefined,
  slackSubscriptionsChannel: undefined,
};

/**
 * The two organization reads billing does. Nothing in this file reaches them:
 * what is under test is which services get built, not what they read.
 */
const organizations = {
  getBillingProfile: () =>
    Promise.resolve({ id: "organization-1", name: "Acme", billingCustomerId: null }),
  claimBillingCustomerId: () => Promise.resolve(true),
} as unknown as Pick<OrganizationService, "getBillingProfile" | "claimBillingCustomerId">;

const prisma = {} as PrismaClient;

function compose(billing: ApiBillingConfig | undefined) {
  return composeApiBillingWebhook({ billing, prisma, organizations });
}

/** The family as the process serves it: through the door registry, and no other way. */
function mount(composition: ReturnType<typeof compose>) {
  const hono = new Hono();
  for (const door of openTestRestDoors({
    services: { billingWebhook: () => composition.webhook },
  })) {
    hono.route("/", door);
  }

  return hono;
}

function declaredRoutes(app: Hono) {
  return app.routes.map((route) => `${route.method.toUpperCase()} ${route.path}`);
}

describe("given a deployment that bills through Stripe", () => {
  describe("when the billing webhook is composed", () => {
    /** @scenario "The Stripe webhook route is declared on a deployment that bills" */
    it("declares the callback route", () => {
      expect(declaredRoutes(mount(compose(STRIPE_CONFIG)))).toContain("POST /api/webhooks/stripe");
    });

    /** @scenario "A deployment that bills composes the real subscription services" */
    it("supplies the application slices the two billing surfaces read", () => {
      const composition = compose(STRIPE_CONFIG);

      expect(composition.application.billingSubscription).toBeDefined();
      expect(composition.application.billingCurrency).toBeDefined();
      expect(composition.seatSync).toBeDefined();
      expect(composition.webhook.dispatchesEvents()).toBe(true);
    });

    /** @scenario "A delivery with no signature is refused before anything is parsed" */
    it("refuses an unsigned delivery in plain text", async () => {
      const response = await mount(compose(STRIPE_CONFIG)).request("/api/webhooks/stripe", {
        method: "POST",
        body: "{}",
      });

      expect(response.status).toBe(400);
      expect(await response.text()).toBe("Webhook Error: Missing signature or secret");
    });
  });
});

describe("given a deployment that bills through nobody", () => {
  describe("when the billing webhook is composed", () => {
    /** @scenario "The Stripe webhook route is declared on a deployment that bills" */
    it("declares the same route", () => {
      expect(declaredRoutes(mount(compose(undefined)))).toContain("POST /api/webhooks/stripe");
    });

    /** @scenario "A deployment with no Stripe composed answers the callback with 404" */
    it("answers the callback with 404 and composes no billing services", async () => {
      const composition = compose(undefined);

      const response = await mount(composition).request("/api/webhooks/stripe", {
        method: "POST",
        body: "{}",
      });

      expect(response.status).toBe(404);
      expect(composition.application.billingSubscription).toBeUndefined();
      expect(composition.seatSync).toBeUndefined();
    });
  });
});
