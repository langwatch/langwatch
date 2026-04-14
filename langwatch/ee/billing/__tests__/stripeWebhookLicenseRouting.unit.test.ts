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

vi.mock("micro", () => ({
  buffer: vi.fn().mockResolvedValue(Buffer.from("raw-body")),
}));

vi.mock("../../../src/server/posthog", () => ({
  getPostHogInstance: vi.fn().mockReturnValue(null),
}));

import { handleLicensePurchase } from "../services/licensePurchaseHandler";
import { createStripeWebhookHandlerFactory } from "../stripeWebhook";
import { prisma } from "../../../src/server/db";
import type { NextApiRequest, NextApiResponse } from "~/types/next-stubs";
import type Stripe from "stripe";

const mockHandleLicensePurchase = handleLicensePurchase as ReturnType<
  typeof vi.fn
>;

const createMockReqRes = () => {
  const req = {
    method: "POST",
    headers: { "stripe-signature": "sig_test" },
  } as unknown as NextApiRequest;

  const res = {
    json: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis(),
  } as unknown as NextApiResponse;

  return { req, res };
};

const createMockWebhookService = () => ({
  handleCheckoutCompleted: vi.fn().mockResolvedValue({ earlyReturn: false }),
  handleInvoicePaymentSucceeded: vi.fn().mockResolvedValue(undefined),
  handleInvoicePaymentFailed: vi.fn().mockResolvedValue(undefined),
  handleSubscriptionDeleted: vi.fn().mockResolvedValue(undefined),
  handleSubscriptionUpdated: vi.fn().mockResolvedValue(undefined),
});

describe("stripeWebhook license routing", () => {
  let mockStripe: Record<string, any>;
  let webhookService: ReturnType<typeof createMockWebhookService>;

  beforeEach(() => {
    vi.clearAllMocks();
    webhookService = createMockWebhookService();
  });

  const createHandler = (stripeOverrides: Record<string, any> = {}) => {
    mockStripe = {
      webhooks: {
        constructEvent: vi.fn(),
      },
      checkout: {
        sessions: {
          listLineItems: vi.fn().mockResolvedValue({ data: [] }),
        },
      },
      ...stripeOverrides,
    };

    return createStripeWebhookHandlerFactory({
      stripe: mockStripe as any,
      webhookService: webhookService as any,
    });
  };

  describe("when checkout.session.completed has a matching license payment link", () => {
    it("routes to license purchase handler", async () => {
      const handler = createHandler();
      const { req, res } = createMockReqRes();

      mockStripe.webhooks.constructEvent.mockReturnValue({
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
      });

      await handler(req, res);

      expect(mockHandleLicensePurchase).toHaveBeenCalledWith({
        checkoutSession: expect.objectContaining({
          id: "cs_test_123",
          payment_link: "plink_license_123",
        }),
        stripe: mockStripe,
        privateKey: "test-private-key-pem",
      });
      expect(res.json).toHaveBeenCalledWith({ received: true });
    });

    it("does NOT execute the subscription checkout flow", async () => {
      const handler = createHandler();
      const { req, res } = createMockReqRes();

      mockStripe.webhooks.constructEvent.mockReturnValue({
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_test_123",
            payment_link: "plink_license_123",
            customer_details: { email: "buyer@acme.com", name: null },
          },
        },
      });

      await handler(req, res);

      expect(webhookService.handleCheckoutCompleted).not.toHaveBeenCalled();
      expect(prisma.organization.findFirst).not.toHaveBeenCalled();
    });
  });

  describe("when checkout.session.completed has no matching payment link", () => {
    it("continues with the subscription checkout flow", async () => {
      const handler = createHandler();
      const { req, res } = createMockReqRes();

      (prisma.organization.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "org-1",
        stripeCustomerId: "cus_test_123",
      });

      mockStripe.webhooks.constructEvent.mockReturnValue({
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
      });

      await handler(req, res);

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
      const handler = createHandler();
      const { req, res } = createMockReqRes();

      (prisma.organization.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "org-1",
        stripeCustomerId: "cus_test_123",
      });

      mockStripe.webhooks.constructEvent.mockReturnValue({
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
      });

      await handler(req, res);

      expect(mockHandleLicensePurchase).not.toHaveBeenCalled();
    });
  });

  describe("when payment_link is a PaymentLink object instead of string", () => {
    it("extracts the id and routes correctly", async () => {
      const handler = createHandler();
      const { req, res } = createMockReqRes();

      mockStripe.webhooks.constructEvent.mockReturnValue({
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_test_obj",
            payment_link: { id: "plink_license_123" },
            customer_details: { email: "buyer@acme.com", name: null },
          },
        },
      });

      await handler(req, res);

      expect(mockHandleLicensePurchase).toHaveBeenCalled();
    });
  });

  describe("when private key is missing", () => {
    it("returns 500 error", async () => {
      const originalKey = mockEnv.LANGWATCH_LICENSE_PRIVATE_KEY;

      try {
        mockEnv.LANGWATCH_LICENSE_PRIVATE_KEY = undefined;

        const handler = createHandler();
        const { req, res } = createMockReqRes();

        mockStripe.webhooks.constructEvent.mockReturnValue({
          type: "checkout.session.completed",
          data: {
            object: {
              id: "cs_test_nokey",
              payment_link: "plink_license_123",
              customer_details: { email: "buyer@acme.com", name: null },
            },
          },
        });

        await handler(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.send).toHaveBeenCalledWith(
          expect.stringContaining("missing private key"),
        );
        expect(mockHandleLicensePurchase).not.toHaveBeenCalled();
      } finally {
        mockEnv.LANGWATCH_LICENSE_PRIVATE_KEY = originalKey;
      }
    });
  });

  describe("when license handler throws an error", () => {
    it("returns 500 error", async () => {
      const handler = createHandler();
      const { req, res } = createMockReqRes();

      mockStripe.webhooks.constructEvent.mockReturnValue({
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_test_fail",
            payment_link: "plink_license_123",
            customer_details: { email: "buyer@acme.com", name: null },
          },
        },
      });

      mockHandleLicensePurchase.mockRejectedValueOnce(
        new Error("Email send failed"),
      );

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.send).toHaveBeenCalledWith("Webhook processing error");
    });
  });

  describe("when invoice.payment_succeeded event fires", () => {
    it("does NOT trigger license handling", async () => {
      const handler = createHandler();
      const { req, res } = createMockReqRes();

      (prisma.organization.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "org-1",
        stripeCustomerId: "cus_test_123",
      });

      mockStripe.webhooks.constructEvent.mockReturnValue({
        type: "invoice.payment_succeeded",
        data: {
          object: {
            customer: "cus_test_123",
            subscription: "sub_test_123",
          },
        },
      });

      await handler(req, res);

      expect(mockHandleLicensePurchase).not.toHaveBeenCalled();
      expect(webhookService.handleInvoicePaymentSucceeded).toHaveBeenCalled();
    });
  });
});
