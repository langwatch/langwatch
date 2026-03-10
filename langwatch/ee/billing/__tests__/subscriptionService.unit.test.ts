import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSendSlackSubscriptionEvent = vi.fn().mockResolvedValue(undefined);

vi.mock("../../../src/server/app-layer/app", () => ({
  getApp: () => ({
    notifications: {
      sendSlackSubscriptionEvent: mockSendSlackSubscriptionEvent,
    },
  }),
}));

import { PlanTypes, SubscriptionStatus } from "../planTypes";
import { createSubscriptionService } from "../services/subscriptionService";
import { OrganizationNotFoundError } from "../errors";

const createMockStripe = () => ({
  subscriptions: {
    retrieve: vi.fn(),
    update: vi.fn(),
    cancel: vi.fn(),
  },
  checkout: {
    sessions: {
      create: vi.fn(),
    },
  },
  billingPortal: {
    sessions: {
      create: vi.fn(),
    },
  },
  invoices: {
    list: vi.fn(),
  },
});

const createMockDb = () => ({
  subscription: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  organization: {
    findUnique: vi.fn(),
  },
});

const createMockItemCalculator = () => ({
  getItemsToUpdate: vi.fn().mockReturnValue([]),
  createItemsToAdd: vi.fn().mockReturnValue([]),
  prices: { LAUNCH: "price_launch", FREE: undefined } as any,
});

describe("subscriptionService", () => {
  let stripe: ReturnType<typeof createMockStripe>;
  let db: ReturnType<typeof createMockDb>;
  let itemCalculator: ReturnType<typeof createMockItemCalculator>;
  let service: ReturnType<typeof createSubscriptionService>;

  beforeEach(() => {
    vi.clearAllMocks();
    stripe = createMockStripe();
    db = createMockDb();
    itemCalculator = createMockItemCalculator();
    service = createSubscriptionService({
      stripe: stripe as any,
      db: db as any,
      itemCalculator,
    });
  });

  describe("updateSubscriptionItems()", () => {
    describe("when active subscription exists", () => {
      it("updates subscription items via Stripe", async () => {
        db.subscription.findFirst.mockResolvedValue({
          id: "sub_db_1",
          stripeSubscriptionId: "sub_stripe_1",
          status: SubscriptionStatus.ACTIVE,
          plan: PlanTypes.LAUNCH,
        });
        stripe.subscriptions.retrieve.mockResolvedValue({
          items: { data: [{ id: "si_1", price: { id: "price_launch" } }] },
        });
        itemCalculator.getItemsToUpdate.mockReturnValue([
          { id: "si_1", quantity: 1 },
        ]);
        stripe.subscriptions.update.mockResolvedValue({});

        const result = await service.updateSubscriptionItems({
          organizationId: "org_123",
          plan: PlanTypes.LAUNCH,
          upgradeMembers: true,
          upgradeTraces: true,
          totalMembers: 5,
          totalTraces: 30_000,
        });

        expect(result).toEqual({ success: true });
        expect(stripe.subscriptions.update).toHaveBeenCalledWith(
          "sub_stripe_1",
          { items: [{ id: "si_1", quantity: 1 }] },
        );
      });
    });

    describe("when no active subscription exists", () => {
      it("returns success false", async () => {
        db.subscription.findFirst.mockResolvedValue(null);

        const result = await service.updateSubscriptionItems({
          organizationId: "org_123",
          plan: PlanTypes.LAUNCH,
          upgradeMembers: true,
          upgradeTraces: true,
          totalMembers: 5,
          totalTraces: 30_000,
        });

        expect(result).toEqual({ success: false });
      });
    });
  });

  describe("createOrUpdateSubscription()", () => {
    describe("when cancelling to FREE with existing subscription", () => {
      it("cancels Stripe subscription and updates DB status", async () => {
        db.subscription.findFirst.mockResolvedValue({
          id: "sub_db_1",
          stripeSubscriptionId: "sub_stripe_1",
          status: SubscriptionStatus.ACTIVE,
        });
        stripe.subscriptions.cancel.mockResolvedValue({
          status: "canceled",
        });

        const result = await service.createOrUpdateSubscription({
          organizationId: "org_123",
          baseUrl: "https://app.test",
          plan: PlanTypes.FREE,
          customerId: "cus_123",
        });

        expect(result.url).toBe("https://app.test/settings/subscription");
        expect(db.subscription.update).toHaveBeenCalledWith({
          where: { id: "sub_db_1" },
          data: { status: SubscriptionStatus.CANCELLED },
        });
      });
    });

    describe("when upgrading existing subscription", () => {
      it("updates Stripe subscription items and DB plan", async () => {
        db.subscription.findFirst.mockResolvedValue({
          id: "sub_db_1",
          stripeSubscriptionId: "sub_stripe_1",
          status: SubscriptionStatus.ACTIVE,
        });
        stripe.subscriptions.retrieve.mockResolvedValue({
          items: { data: [] },
        });
        stripe.subscriptions.update.mockResolvedValue({
          status: "active",
        });

        const result = await service.createOrUpdateSubscription({
          organizationId: "org_123",
          baseUrl: "https://app.test",
          plan: PlanTypes.ACCELERATE,
          customerId: "cus_123",
        });

        expect(result.url).toBe(
          "https://app.test/settings/subscription?success",
        );
        expect(db.subscription.update).toHaveBeenCalledWith({
          where: { id: "sub_db_1" },
          data: { plan: PlanTypes.ACCELERATE },
        });
      });
    });

    describe("when creating new subscription", () => {
      it("creates checkout session for new plan", async () => {
        db.subscription.findFirst.mockResolvedValue(null);
        db.subscription.create.mockResolvedValue({ id: "sub_new" });
        stripe.checkout.sessions.create.mockResolvedValue({
          url: "https://checkout.stripe.com/session",
        });

        const result = await service.createOrUpdateSubscription({
          organizationId: "org_123",
          baseUrl: "https://app.test",
          plan: PlanTypes.LAUNCH,
          customerId: "cus_123",
        });

        expect(result.url).toBe("https://checkout.stripe.com/session");
        expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            mode: "subscription",
            customer: "cus_123",
            client_reference_id: "subscription_setup_sub_new",
          }),
        );
      });
    });

    describe("when selecting FREE with no existing subscription", () => {
      it("returns subscription settings URL", async () => {
        db.subscription.findFirst.mockResolvedValue(null);

        const result = await service.createOrUpdateSubscription({
          organizationId: "org_123",
          baseUrl: "https://app.test",
          plan: PlanTypes.FREE,
          customerId: "cus_123",
        });

        expect(result.url).toBe("https://app.test/settings/subscription");
      });
    });
  });

  describe("createBillingPortalSession()", () => {
    it("creates portal session with return URL", async () => {
      stripe.billingPortal.sessions.create.mockResolvedValue({
        url: "https://billing.stripe.com/session",
      });

      const result = await service.createBillingPortalSession({
        customerId: "cus_123",
        baseUrl: "https://app.test",
        organizationId: "org_123",
      });

      expect(result.url).toBe("https://billing.stripe.com/session");
      expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith({
        customer: "cus_123",
        return_url: "https://app.test/settings/subscription",
      });
    });
  });

  describe("getLastNonCancelledSubscription()", () => {
    it("queries for non-cancelled subscription ordered by creation date", async () => {
      const mockSub = { id: "sub_1", status: "ACTIVE" };
      db.subscription.findFirst.mockResolvedValue(mockSub);

      const result =
        await service.getLastNonCancelledSubscription("org_123");

      expect(result).toEqual(mockSub);
      expect(db.subscription.findFirst).toHaveBeenCalledWith({
        where: {
          organizationId: "org_123",
          status: { not: SubscriptionStatus.CANCELLED },
        },
        orderBy: { createdAt: "desc" },
      });
    });
  });

  describe("notifyProspective()", () => {
    describe("when organization exists", () => {
      it("dispatches prospective notification", async () => {
        db.organization.findUnique.mockResolvedValue({
          id: "org_123",
          name: "Acme",
        });

        const result = await service.notifyProspective({
          organizationId: "org_123",
          plan: PlanTypes.LAUNCH,
          customerName: "John",
          customerEmail: "john@acme.com",
          actorEmail: "actor@acme.com",
        });

        expect(result).toEqual({ success: true });
        expect(mockSendSlackSubscriptionEvent).toHaveBeenCalledWith({
          type: "prospective",
          organizationId: "org_123",
          organizationName: "Acme",
          plan: PlanTypes.LAUNCH,
          customerName: "John",
          customerEmail: "john@acme.com",
          actorEmail: "actor@acme.com",
          note: undefined,
        });
      });
    });

    describe("when organization not found", () => {
      it("throws OrganizationNotFoundError", async () => {
        db.organization.findUnique.mockResolvedValue(null);

        await expect(
          service.notifyProspective({
            organizationId: "org_missing",
            plan: PlanTypes.LAUNCH,
            actorEmail: "actor@acme.com",
          }),
        ).rejects.toThrow(OrganizationNotFoundError);
      });
    });
  });

  describe("listInvoices()", () => {
    describe("when organization has no stripeCustomerId", () => {
      it("returns an empty array", async () => {
        db.organization.findUnique.mockResolvedValue({
          stripeCustomerId: null,
        });

        const result = await service.listInvoices({
          organizationId: "org_no_stripe",
        });

        expect(result).toEqual([]);
        expect(stripe.invoices.list).not.toHaveBeenCalled();
      });
    });

    describe("when organization is not found", () => {
      it("returns an empty array", async () => {
        db.organization.findUnique.mockResolvedValue(null);

        const result = await service.listInvoices({
          organizationId: "org_missing",
        });

        expect(result).toEqual([]);
      });
    });

    describe("when organization has a stripeCustomerId", () => {
      it("returns mapped invoices excluding drafts", async () => {
        db.organization.findUnique.mockResolvedValue({
          stripeCustomerId: "cus_123",
        });

        stripe.invoices.list.mockResolvedValue({
          data: [
            {
              id: "inv_1",
              number: "INV-001",
              created: 1700000000,
              amount_due: 5000,
              currency: "usd",
              status: "paid",
              invoice_pdf: "https://pdf.example.com/inv_1",
              hosted_invoice_url: "https://hosted.example.com/inv_1",
            },
            {
              id: "inv_2",
              number: null,
              created: 1700001000,
              amount_due: 3000,
              currency: "eur",
              status: "draft",
              invoice_pdf: null,
              hosted_invoice_url: null,
            },
            {
              id: "inv_3",
              number: "INV-003",
              created: 1700002000,
              amount_due: 1000,
              currency: "usd",
              status: "open",
              invoice_pdf: null,
              hosted_invoice_url: "https://hosted.example.com/inv_3",
            },
          ],
        });

        const result = await service.listInvoices({
          organizationId: "org_with_stripe",
        });

        expect(stripe.invoices.list).toHaveBeenCalledWith({
          customer: "cus_123",
          limit: 4,
        });

        expect(result).toEqual([
          {
            id: "inv_1",
            number: "INV-001",
            date: 1700000000,
            amountDue: 5000,
            currency: "usd",
            status: "paid",
            pdfUrl: "https://pdf.example.com/inv_1",
            hostedUrl: "https://hosted.example.com/inv_1",
          },
          {
            id: "inv_3",
            number: "INV-003",
            date: 1700002000,
            amountDue: 1000,
            currency: "usd",
            status: "open",
            pdfUrl: null,
            hostedUrl: "https://hosted.example.com/inv_3",
          },
        ]);
      });

      it("maps null status to 'unknown'", async () => {
        db.organization.findUnique.mockResolvedValue({
          stripeCustomerId: "cus_456",
        });

        stripe.invoices.list.mockResolvedValue({
          data: [
            {
              id: "inv_4",
              number: null,
              created: 1700003000,
              amount_due: 0,
              currency: "usd",
              status: null,
              invoice_pdf: null,
              hosted_invoice_url: null,
            },
          ],
        });

        const result = await service.listInvoices({
          organizationId: "org_null_status",
        });

        expect(result).toHaveLength(1);
        expect(result[0]!.status).toBe("unknown");
      });
    });
  });
});
