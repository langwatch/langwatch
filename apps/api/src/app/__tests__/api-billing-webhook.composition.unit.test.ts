/**
 * `POST /api/webhooks/stripe` and the billing write path behind it, as this
 * process composes them.
 *
 * What is pinned here is the shape the retired platform application had: the
 * door exists on every deployment, the dispatcher behind it exists only where
 * Stripe is configured, and `subscription.*` gets its two `ctx.app` slices from
 * the same composition rather than from nobody.
 *
 * @see packages/enterprise/features/billing/specs/stripe-webhook.feature
 */
// @vitest-environment node
import type { ApiKeyService } from "@langwatch/api-key-contract";
import type { AuthzService } from "@langwatch/authz-contract";
import {
  BillingSubscriptionService,
  CustomerService,
  SeatSyncService,
} from "@langwatch/enterprise-billing-server";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { describe, expect, it } from "vitest";

import { composeApiBillingWebhook } from "../api-billing-webhook.composition.ts";
import { ApiRestSecurity } from "../../api-rest.security.ts";
import { ApiRestObservabilityComposition } from "../api-rest-observability.composition.ts";
import type { ApiBillingConfig } from "../../platform/config/api.config.ts";

const STRIPE_CONFIG: ApiBillingConfig = {
  stripeSecretKey: "sk_test_composition",
  stripeWebhookSecret: "whsec_composition",
  licensePaymentLinkId: "plink_licence",
  licensePrivateKey: undefined,
  slackSubscriptionsChannel: undefined,
};

function security() {
  return ApiRestSecurity.create({
    apiKeys: {} as ApiKeyService,
    authz: {} as AuthzService,
    organizations: {} as OrganizationService,
    observability: ApiRestObservabilityComposition.create(),
  });
}

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

function declaredRoutes(app: { routes: readonly { method: string; path: string }[] }) {
  return app.routes.map((route) => `${route.method.toUpperCase()} ${route.path}`);
}

describe("given a deployment that bills through Stripe", () => {
  describe("when the billing webhook is composed", () => {
    /** @scenario "The Stripe webhook route is declared on a deployment that bills" */
    it("declares the callback route", () => {
      const composition = compose(STRIPE_CONFIG);

      expect(declaredRoutes(composition.rest(security()))).toContain("POST /api/webhooks/stripe");
    });

    /** @scenario "A deployment that bills composes the real subscription services" */
    it("supplies the two application slices the subscription surface reads", () => {
      const composition = compose(STRIPE_CONFIG);

      expect(composition.application.subscription).toBeInstanceOf(BillingSubscriptionService);
      expect(composition.application.billingCustomer).toBeInstanceOf(CustomerService);
      expect(composition.seatSync).toBeInstanceOf(SeatSyncService);
    });

    /** @scenario "A delivery with no signature is refused before anything is parsed" */
    it("refuses an unsigned delivery in plain text", async () => {
      const composition = compose(STRIPE_CONFIG);

      const response = await composition.rest(security()).request("/api/webhooks/stripe", {
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
      const composition = compose(undefined);

      expect(declaredRoutes(composition.rest(security()))).toContain("POST /api/webhooks/stripe");
    });

    /** @scenario "A deployment with no Stripe composed answers the callback with 404" */
    it("answers the callback with 404 and composes no billing services", async () => {
      const composition = compose(undefined);

      const response = await composition.rest(security()).request("/api/webhooks/stripe", {
        method: "POST",
        body: "{}",
      });

      expect(response.status).toBe(404);
      expect(composition.application.subscription).toBeUndefined();
      expect(composition.application.billingCustomer).toBeUndefined();
      expect(composition.seatSync).toBeUndefined();
    });
  });
});
