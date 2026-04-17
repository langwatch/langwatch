import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/licensePurchaseHandler", () => ({
  handleLicensePurchase: vi.fn().mockResolvedValue(undefined),
}));

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {
    STRIPE_WEBHOOK_SECRET: "whsec_test",
    STRIPE_LICENSE_PAYMENT_LINK_ID: "plink_license_123",
    LANGWATCH_LICENSE_PRIVATE_KEY: "test-private-key-pem" as string | undefined,
  },
}));

vi.mock("../../../src/env.mjs", () => ({
  env: mockEnv,
}));

vi.mock("../../../src/server/db", () => ({
  prisma: {
    organization: { findFirst: vi.fn() },
  },
}));

vi.mock("../../../src/utils/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("../../../src/server/posthog", () => ({
  getPostHogInstance: vi.fn().mockReturnValue(null),
}));

import type Stripe from "stripe";
import { handleLicensePurchase } from "../services/licensePurchaseHandler";
import { processStripeWebhookEvent } from "../stripeWebhook";
import { prisma } from "../../../src/server/db";

const mockHandleLicensePurchase = handleLicensePurchase as ReturnType<
  typeof vi.fn
>;

const createMockWebhookService = () => ({
  handleCheckoutCompleted: vi.fn().mockResolvedValue({ earlyReturn: false }),
  handleInvoicePaymentSucceeded: vi.fn().mockResolvedValue(undefined),
  handleInvoicePaymentFailed: vi.fn().mockResolvedValue(undefined),
  handleSubscriptionDeleted: vi.fn().mockResolvedValue(undefined),
  handleSubscriptionUpdated: vi.fn().mockResolvedValue(undefined),
});

const createMockStripe = (): Stripe =>
  ({
    checkout: {
      sessions: {
        listLineItems: vi.fn().mockResolvedValue({ data: [] }),
      },
    },
  } as unknown as Stripe);

describe("processStripeWebhookEvent license routing", () => {
  let webhookService: ReturnType<typeof createMockWebhookService>;
  let stripe: Stripe;

  beforeEach(() => {
    vi.clearAllMocks();
    webhookService = createMockWebhookService();
    stripe = createMockStripe();
  });

  describe("when checkout.session.completed has a matching license payment link", () => {
    it("routes to license purchase handler", async () => {
      const event = {
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_test_123",
            payment_link: "plink_license_123",
            customer_details: {
              email: "buyer@acme.com",
              name: "Acme Corp",
            },
            amount_total: 14900,
            currency: "usd",
          },
        },
      } as unknown as Stripe.Event;

      const result = await processStripeWebhookEvent({
        event,
        stripe,
        webhookService: webhookService as any,
      });

      expect(result).toEqual({ status: "ok" });
      expect(mockHandleLicensePurchase).toHaveBeenCalledWith({
        checkoutSession: expect.objectContaining({
          id: "cs_test_123",
          payment_link: "plink_license_123",
        }),
        stripe,
        privateKey: "test-private-key-pem",
      });
    });

    it("does NOT execute the subscription checkout flow", async () => {
      const event = {
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_test_123",
            payment_link: "plink_license_123",
            customer_details: { email: "buyer@acme.com", name: null },
          },
        },
      } as unknown as Stripe.Event;

      await processStripeWebhookEvent({
        event,
        stripe,
        webhookService: webhookService as any,
      });

      expect(webhookService.handleCheckoutCompleted).not.toHaveBeenCalled();
      expect(prisma.organization.findFirst).not.toHaveBeenCalled();
    });
  });

  describe("when checkout.session.completed has no matching payment link", () => {
    it("continues with the subscription checkout flow", async () => {
      (prisma.organization.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "org-1",
        stripeCustomerId: "cus_test_123",
      });

      const event = {
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_test_456",
            payment_link: null,
            customer: "cus_test_123",
            subscription: "sub_test_123",
            client_reference_id: "org-1",
            metadata: {},
          },
        },
      } as unknown as Stripe.Event;

      await processStripeWebhookEvent({
        event,
        stripe,
        webhookService: webhookService as any,
      });

      expect(mockHandleLicensePurchase).not.toHaveBeenCalled();
      expect(webhookService.handleCheckoutCompleted).toHaveBeenCalledWith({
        subscriptionId: "sub_test_123",
        clientReferenceId: "org-1",
        selectedCurrency: null,
      });
    });
  });

  describe("when checkout.session.completed has a different payment link", () => {
    it("does NOT route to license handler", async () => {
      (prisma.organization.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "org-1",
        stripeCustomerId: "cus_test_123",
      });

      const event = {
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_test_789",
            payment_link: "plink_other_456",
            customer: "cus_test_123",
            subscription: "sub_test_123",
            client_reference_id: "org-1",
            metadata: {},
          },
        },
      } as unknown as Stripe.Event;

      await processStripeWebhookEvent({
        event,
        stripe,
        webhookService: webhookService as any,
      });

      expect(mockHandleLicensePurchase).not.toHaveBeenCalled();
    });
  });

  describe("when payment_link is a PaymentLink object instead of string", () => {
    it("extracts the id and routes correctly", async () => {
      const event = {
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_test_obj",
            payment_link: { id: "plink_license_123" },
            customer_details: { email: "buyer@acme.com", name: null },
          },
        },
      } as unknown as Stripe.Event;

      await processStripeWebhookEvent({
        event,
        stripe,
        webhookService: webhookService as any,
      });

      expect(mockHandleLicensePurchase).toHaveBeenCalled();
    });
  });

  describe("when private key is missing", () => {
    it("returns an error result with httpStatus 500", async () => {
      const originalKey = mockEnv.LANGWATCH_LICENSE_PRIVATE_KEY;

      try {
        mockEnv.LANGWATCH_LICENSE_PRIVATE_KEY = undefined;

        const event = {
          type: "checkout.session.completed",
          data: {
            object: {
              id: "cs_test_nokey",
              payment_link: "plink_license_123",
              customer_details: { email: "buyer@acme.com", name: null },
            },
          },
        } as unknown as Stripe.Event;

        const result = await processStripeWebhookEvent({
          event,
          stripe,
          webhookService: webhookService as any,
        });

        expect(result).toEqual({
          status: "error",
          httpStatus: 500,
          message: expect.stringContaining("missing private key"),
        });
        expect(mockHandleLicensePurchase).not.toHaveBeenCalled();
      } finally {
        mockEnv.LANGWATCH_LICENSE_PRIVATE_KEY = originalKey;
      }
    });
  });

  describe("when license handler throws an error", () => {
    it("returns an error result with httpStatus 500", async () => {
      mockHandleLicensePurchase.mockRejectedValueOnce(
        new Error("Email send failed"),
      );

      const event = {
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_test_fail",
            payment_link: "plink_license_123",
            customer_details: { email: "buyer@acme.com", name: null },
          },
        },
      } as unknown as Stripe.Event;

      const result = await processStripeWebhookEvent({
        event,
        stripe,
        webhookService: webhookService as any,
      });

      expect(result).toEqual({
        status: "error",
        httpStatus: 500,
        message: "Webhook processing error",
      });
    });
  });

  describe("when invoice.payment_succeeded event fires", () => {
    it("does NOT trigger license handling", async () => {
      (prisma.organization.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "org-1",
        stripeCustomerId: "cus_test_123",
      });

      const event = {
        type: "invoice.payment_succeeded",
        data: {
          object: {
            customer: "cus_test_123",
            subscription: "sub_test_123",
          },
        },
      } as unknown as Stripe.Event;

      await processStripeWebhookEvent({
        event,
        stripe,
        webhookService: webhookService as any,
      });

      expect(mockHandleLicensePurchase).not.toHaveBeenCalled();
      expect(webhookService.handleInvoicePaymentSucceeded).toHaveBeenCalled();
    });
  });
});
