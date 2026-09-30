import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../licensing/licenseGenerationService", () => ({
  generateLicenseKey: vi.fn().mockReturnValue({
    licenseKey: "test-license-key-base64",
    licenseData: {
      licenseId: "lic-test-123",
      version: 1,
      organizationName: "Acme Corp",
      email: "buyer@acme.com",
      issuedAt: "2026-03-02T00:00:00.000Z",
      expiresAt: "2027-03-02T00:00:00.000Z",
      plan: { type: "GROWTH", name: "Growth", maxMembers: 5 },
    },
  }),
}));

vi.mock("../../../src/server/mailer/licenseEmail", () => ({
  sendLicenseEmail: vi.fn().mockResolvedValue(undefined),
}));

const mockCaptureException = vi.fn();

vi.mock("../../../src/utils/posthogErrorCapture", () => ({
  captureException: (error: unknown) => mockCaptureException(error),
  toError: (error: unknown) =>
    error instanceof Error ? error : new Error(String(error)),
}));

const mockSendSlackLicensePurchase = vi.fn().mockResolvedValue(undefined);

vi.mock("../../../src/server/app-layer/app", () => ({
  // Consumers that degrade without Redis read through this one.
  tryGetApp: () => null,
  getApp: () => ({
    notifications: {
      sendSlackLicensePurchase: mockSendSlackLicensePurchase,
    },
  }),
}));

import { sendLicenseEmail } from "../../../src/server/mailer/licenseEmail";
import { generateLicenseKey } from "../../licensing/licenseGenerationService";
import { handleLicensePurchase } from "../services/licensePurchaseHandler";

const mockGenerateLicenseKey = generateLicenseKey as ReturnType<typeof vi.fn>;
const mockSendLicenseEmail = sendLicenseEmail as ReturnType<typeof vi.fn>;

const createMockStripe = () => ({
  checkout: {
    sessions: {
      listLineItems: vi.fn().mockResolvedValue({
        data: [{ quantity: 5 }],
      }),
    },
  },
});

const createMockCheckoutSession = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "cs_test_123",
    customer_details: {
      email: "buyer@acme.com",
      name: "Acme Corp",
    },
    amount_total: 14900,
    currency: "usd",
    ...overrides,
  }) as any;

describe("licensePurchaseHandler", () => {
  let mockStripe: ReturnType<typeof createMockStripe>;
  const recordLicense = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockStripe = createMockStripe();
    recordLicense.mockResolvedValue(undefined);
  });

  describe("handleLicensePurchase()", () => {
    describe("when a checkout completes", () => {
      /** @scenario A license bought through the payment link is recorded */
      it("records the same license that is emailed to the buyer", async () => {
        await handleLicensePurchase({
          checkoutSession: createMockCheckoutSession(),
          stripe: mockStripe as any,
          privateKey: "test-private-key",
          recordLicense,
        });

        expect(recordLicense).toHaveBeenCalledTimes(1);
        expect(recordLicense).toHaveBeenCalledWith({
          licenseKey: "test-license-key-base64",
        });
        expect(mockSendLicenseEmail).toHaveBeenCalledWith(
          expect.objectContaining({ licenseKey: "test-license-key-base64" }),
        );
      });
    });

    describe("when the registry cannot be written", () => {
      /** @scenario A purchase still delivers its license when the registry cannot be written */
      it("still emails the license and reports the failure", async () => {
        recordLicense.mockRejectedValue(new Error("registry unavailable"));

        await expect(
          handleLicensePurchase({
            checkoutSession: createMockCheckoutSession(),
            stripe: mockStripe as any,
            privateKey: "test-private-key",
            recordLicense,
          }),
        ).resolves.toBeUndefined();

        expect(mockSendLicenseEmail).toHaveBeenCalledTimes(1);
        expect(mockCaptureException).toHaveBeenCalledTimes(1);
      });
    });

    describe("when checkout session has valid buyer details", () => {
      /** @scenario Use business name as organization name in license */
      it("generates a GROWTH license with the correct seat count", async () => {
        const session = createMockCheckoutSession();

        await handleLicensePurchase({
          checkoutSession: session,
          stripe: mockStripe as any,
          privateKey: "test-private-key",
          recordLicense,
        });

        expect(mockGenerateLicenseKey).toHaveBeenCalledWith({
          organizationName: "Acme Corp",
          email: "buyer@acme.com",
          planType: "GROWTH",
          maxMembers: 5,
          privateKey: "test-private-key",
        });
      });

      it("sends the license email to the buyer", async () => {
        const session = createMockCheckoutSession();

        await handleLicensePurchase({
          checkoutSession: session,
          stripe: mockStripe as any,
          privateKey: "test-private-key",
          recordLicense,
        });

        expect(mockSendLicenseEmail).toHaveBeenCalledWith({
          email: "buyer@acme.com",
          licenseKey: "test-license-key-base64",
          planType: "GROWTH",
          maxMembers: 5,
          expiresAt: "2027-03-02T00:00:00.000Z",
          organizationName: "Acme Corp",
        });
      });

      it("notifies Slack with purchase details", async () => {
        const session = createMockCheckoutSession();

        await handleLicensePurchase({
          checkoutSession: session,
          stripe: mockStripe as any,
          privateKey: "test-private-key",
          recordLicense,
        });

        expect(mockSendSlackLicensePurchase).toHaveBeenCalledWith({
          buyerEmail: "buyer@acme.com",
          planType: "GROWTH",
          seats: 5,
          amountPaid: 14900,
          currency: "usd",
        });
      });
    });

    describe("when checkout session has no email", () => {
      it("throws an error", async () => {
        const session = createMockCheckoutSession({
          customer_details: { email: null, name: "Acme Corp" },
        });

        await expect(
          handleLicensePurchase({
            checkoutSession: session,
            stripe: mockStripe as any,
            privateKey: "test-private-key",
            recordLicense,
          }),
        ).rejects.toThrow(
          "No email found in checkout session customer_details",
        );
      });
    });

    describe("when line items have no quantity", () => {
      it("defaults to 1 seat", async () => {
        const session = createMockCheckoutSession();
        mockStripe.checkout.sessions.listLineItems.mockResolvedValue({
          data: [{ quantity: null }],
        });

        await handleLicensePurchase({
          checkoutSession: session,
          stripe: mockStripe as any,
          privateKey: "test-private-key",
          recordLicense,
        });

        expect(mockGenerateLicenseKey).toHaveBeenCalledWith(
          expect.objectContaining({ maxMembers: 1 }),
        );
      });
    });

    describe("when line items are empty", () => {
      it("defaults to 1 seat", async () => {
        const session = createMockCheckoutSession();
        mockStripe.checkout.sessions.listLineItems.mockResolvedValue({
          data: [],
        });

        await handleLicensePurchase({
          checkoutSession: session,
          stripe: mockStripe as any,
          privateKey: "test-private-key",
          recordLicense,
        });

        expect(mockGenerateLicenseKey).toHaveBeenCalledWith(
          expect.objectContaining({ maxMembers: 1 }),
        );
      });
    });

    describe("when business name is missing", () => {
      it("passes empty string to license generation", async () => {
        const session = createMockCheckoutSession({
          customer_details: { email: "buyer@solo.dev", name: null },
        });

        await handleLicensePurchase({
          checkoutSession: session,
          stripe: mockStripe as any,
          privateKey: "test-private-key",
          recordLicense,
        });

        expect(mockGenerateLicenseKey).toHaveBeenCalledWith(
          expect.objectContaining({
            organizationName: "",
            email: "buyer@solo.dev",
          }),
        );
      });
    });

    describe("when amount_total is null", () => {
      it("uses 0 for Slack notification amount", async () => {
        const session = createMockCheckoutSession({ amount_total: null });

        await handleLicensePurchase({
          checkoutSession: session,
          stripe: mockStripe as any,
          privateKey: "test-private-key",
          recordLicense,
        });

        expect(mockSendSlackLicensePurchase).toHaveBeenCalledWith(
          expect.objectContaining({ amountPaid: 0 }),
        );
      });
    });

    describe("when currency is null", () => {
      it("defaults to usd for Slack notification", async () => {
        const session = createMockCheckoutSession({ currency: null });

        await handleLicensePurchase({
          checkoutSession: session,
          stripe: mockStripe as any,
          privateKey: "test-private-key",
          recordLicense,
        });

        expect(mockSendSlackLicensePurchase).toHaveBeenCalledWith(
          expect.objectContaining({ currency: "usd" }),
        );
      });
    });

    describe("when stripe listLineItems is called", () => {
      it("passes the checkout session ID", async () => {
        const session = createMockCheckoutSession({ id: "cs_specific_456" });

        await handleLicensePurchase({
          checkoutSession: session,
          stripe: mockStripe as any,
          privateKey: "test-private-key",
          recordLicense,
        });

        expect(mockStripe.checkout.sessions.listLineItems).toHaveBeenCalledWith(
          "cs_specific_456",
        );
      });
    });
  });
});
