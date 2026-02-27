import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../notifications/notificationHandlers", () => ({
  notifySubscriptionEvent: vi.fn().mockResolvedValue(undefined),
}));

import type { PrismaClient } from "@prisma/client";
import type Stripe from "stripe";
import { notifySubscriptionEvent } from "../notifications/notificationHandlers";
import { PlanTypes, SubscriptionStatus } from "../planTypes";
import { EESubscriptionService } from "../services/subscription.service";
import { InvalidPlanError, OrganizationNotFoundError } from "../errors";
import type { SubscriptionRepository } from "../../../src/server/app-layer/subscription/subscription.repository";

const mockNotifySubscriptionEvent = notifySubscriptionEvent as ReturnType<
  typeof vi.fn
>;

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
});

const createMockRepository = (): {
  [K in keyof SubscriptionRepository]: ReturnType<typeof vi.fn>;
} => ({
  findLastNonCancelled: vi.fn(),
  createPending: vi.fn(),
  updateStatus: vi.fn(),
  updatePlan: vi.fn(),
});

const createMockDb = () => ({
  organization: {
    findUnique: vi.fn(),
  },
  team: {
    findFirst: vi.fn(),
  },
});

const createMockItemCalculator = () => ({
  getItemsToUpdate: vi.fn().mockReturnValue([]),
  createItemsToAdd: vi.fn().mockReturnValue([]),
  prices: { LAUNCH: "price_launch", FREE: undefined } as any,
});

describe("EESubscriptionService", () => {
  let stripe: ReturnType<typeof createMockStripe>;
  let db: ReturnType<typeof createMockDb>;
  let repository: ReturnType<typeof createMockRepository>;
  let itemCalculator: ReturnType<typeof createMockItemCalculator>;
  let service: EESubscriptionService;

  beforeEach(() => {
    vi.clearAllMocks();
    stripe = createMockStripe();
    db = createMockDb();
    repository = createMockRepository();
    itemCalculator = createMockItemCalculator();
    service = new EESubscriptionService(
      db as unknown as PrismaClient,
      repository as unknown as SubscriptionRepository,
      stripe as unknown as Stripe,
      itemCalculator,
    );
  });

  describe("updateSubscriptionItems()", () => {
    describe("when active subscription exists", () => {
      it("updates subscription items via Stripe", async () => {
        repository.findLastNonCancelled.mockResolvedValue({
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

    describe("when upgradeTraces is false", () => {
      it("passes zero traces to the item calculator", async () => {
        repository.findLastNonCancelled.mockResolvedValue({
          id: "sub_db_1",
          stripeSubscriptionId: "sub_stripe_1",
          status: SubscriptionStatus.ACTIVE,
          plan: PlanTypes.LAUNCH,
        });
        stripe.subscriptions.retrieve.mockResolvedValue({
          items: { data: [{ id: "si_1", price: { id: "price_launch" } }] },
        });
        itemCalculator.getItemsToUpdate.mockReturnValue([]);
        stripe.subscriptions.update.mockResolvedValue({});

        await service.updateSubscriptionItems({
          organizationId: "org_123",
          plan: PlanTypes.LAUNCH,
          upgradeMembers: true,
          upgradeTraces: false,
          totalMembers: 5,
          totalTraces: 30_000,
        });

        expect(itemCalculator.getItemsToUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            tracesToAdd: 0,
            membersToAdd: 5,
          }),
        );
      });
    });

    describe("when upgradeMembers is false", () => {
      it("passes zero members to the item calculator", async () => {
        repository.findLastNonCancelled.mockResolvedValue({
          id: "sub_db_1",
          stripeSubscriptionId: "sub_stripe_1",
          status: SubscriptionStatus.ACTIVE,
          plan: PlanTypes.LAUNCH,
        });
        stripe.subscriptions.retrieve.mockResolvedValue({
          items: { data: [{ id: "si_1", price: { id: "price_launch" } }] },
        });
        itemCalculator.getItemsToUpdate.mockReturnValue([]);
        stripe.subscriptions.update.mockResolvedValue({});

        await service.updateSubscriptionItems({
          organizationId: "org_123",
          plan: PlanTypes.LAUNCH,
          upgradeMembers: false,
          upgradeTraces: true,
          totalMembers: 5,
          totalTraces: 30_000,
        });

        expect(itemCalculator.getItemsToUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            tracesToAdd: 30_000,
            membersToAdd: 0,
          }),
        );
      });
    });

    describe("when no active subscription exists", () => {
      it("returns success false", async () => {
        repository.findLastNonCancelled.mockResolvedValue(null);

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
      it("cancels Stripe subscription and updates status via repository", async () => {
        repository.findLastNonCancelled.mockResolvedValue({
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
        expect(repository.updateStatus).toHaveBeenCalledWith({
          id: "sub_db_1",
          status: SubscriptionStatus.CANCELLED,
        });
      });
    });

    describe("when upgrading existing subscription", () => {
      it("updates Stripe subscription items and plan via repository", async () => {
        repository.findLastNonCancelled.mockResolvedValue({
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
        expect(repository.updatePlan).toHaveBeenCalledWith({
          id: "sub_db_1",
          plan: PlanTypes.ACCELERATE,
        });
      });
    });

    describe("when creating new subscription", () => {
      it("creates checkout session for new plan", async () => {
        repository.findLastNonCancelled.mockResolvedValue(null);
        repository.createPending.mockResolvedValue({ id: "sub_new" });
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
        expect(repository.createPending).toHaveBeenCalledWith({
          organizationId: "org_123",
          plan: PlanTypes.LAUNCH,
        });
        expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            mode: "subscription",
            customer: "cus_123",
            client_reference_id: "subscription_setup_sub_new",
          }),
        );
      });
    });

    describe("when plan is invalid", () => {
      it("throws InvalidPlanError without creating a pending subscription", async () => {
        repository.findLastNonCancelled.mockResolvedValue(null);

        await expect(
          service.createOrUpdateSubscription({
            organizationId: "org_123",
            baseUrl: "https://app.test",
            plan: "INVALID_PLAN" as any,
            customerId: "cus_123",
          }),
        ).rejects.toThrow(InvalidPlanError);

        expect(repository.createPending).not.toHaveBeenCalled();
      });
    });

    describe("when selecting FREE with no existing subscription", () => {
      it("returns subscription settings URL", async () => {
        repository.findLastNonCancelled.mockResolvedValue(null);

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
    describe("when called with valid customer and base URL", () => {
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
  });

  describe("getLastNonCancelledSubscription()", () => {
    describe("when querying for an organization", () => {
      it("delegates to repository and returns the result", async () => {
        const mockSub = { id: "sub_1", status: "ACTIVE" };
        repository.findLastNonCancelled.mockResolvedValue(mockSub);

        const result =
          await service.getLastNonCancelledSubscription("org_123");

        expect(result).toEqual(mockSub);
        expect(repository.findLastNonCancelled).toHaveBeenCalledWith("org_123");
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
          customerEmail: "john@example.com",
          actorEmail: "actor@example.com",
        });

        expect(result).toEqual({ success: true });
        expect(mockNotifySubscriptionEvent).toHaveBeenCalledWith({
          type: "prospective",
          organizationId: "org_123",
          organizationName: "Acme",
          plan: PlanTypes.LAUNCH,
          customerName: "John",
          customerEmail: "john@example.com",
          actorEmail: "actor@example.com",
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
            actorEmail: "actor@example.com",
          }),
        ).rejects.toThrow(OrganizationNotFoundError);
      });
    });
  });
});
