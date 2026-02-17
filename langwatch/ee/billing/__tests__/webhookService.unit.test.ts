import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../notifications/notificationHandlers", () => ({
  notifySubscriptionEvent: vi.fn().mockResolvedValue(undefined),
}));

import { notifySubscriptionEvent } from "../notifications/notificationHandlers";
import { SubscriptionStatus } from "../planTypes";
import { createWebhookService } from "../services/webhookService";

const mockNotifySubscriptionEvent = notifySubscriptionEvent as ReturnType<
  typeof vi.fn
>;

const createMockDb = () => ({
  subscription: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
});

const createMockItemCalculator = () => ({
  calculateQuantityForPrice: vi.fn().mockReturnValue(0),
  prices: {
    PRO: "price_pro",
    GROWTH: "price_growth",
    LAUNCH: "price_launch",
    LAUNCH_ANNUAL: "price_launch_annual",
    ACCELERATE: "price_accelerate",
    ACCELERATE_ANNUAL: "price_acc_annual",
    LAUNCH_USERS: "price_launch_users",
    ACCELERATE_USERS: "price_acc_users",
    LAUNCH_ANNUAL_USERS: "price_launch_annual_users",
    ACCELERATE_ANNUAL_USERS: "price_acc_annual_users",
    LAUNCH_TRACES_10K: "price_launch_traces",
    ACCELERATE_TRACES_100K: "price_acc_traces",
    LAUNCH_ANNUAL_TRACES_10K: "price_launch_annual_traces",
    ACCELERATE_ANNUAL_TRACES_100K: "price_acc_annual_traces",
  },
});

describe("webhookService", () => {
  let db: ReturnType<typeof createMockDb>;
  let itemCalculator: ReturnType<typeof createMockItemCalculator>;
  let service: ReturnType<typeof createWebhookService>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    db = createMockDb();
    itemCalculator = createMockItemCalculator();
    service = createWebhookService({
      db: db as any,
      itemCalculator,
    });
  });

  describe("handleCheckoutCompleted()", () => {
    describe("when client reference ID is missing", () => {
      it("returns early", async () => {
        const result = await service.handleCheckoutCompleted({
          subscriptionId: "sub_1",
          clientReferenceId: null,
        });

        expect(result.earlyReturn).toBe(true);
        expect(db.subscription.update).not.toHaveBeenCalled();
      });
    });

    describe("when client reference ID exists", () => {
      it("links Stripe subscription and activates", async () => {
        db.subscription.findUnique.mockResolvedValue({
          id: "sub_db_1",
          status: SubscriptionStatus.PENDING,
        });
        db.subscription.update.mockResolvedValue({
          id: "sub_db_1",
          organizationId: "org_123",
          organization: { name: "Acme" },
          plan: "LAUNCH",
          startDate: new Date(),
          maxMembers: null,
          maxMessagesPerMonth: null,
          status: SubscriptionStatus.ACTIVE,
        });

        const promise = service.handleCheckoutCompleted({
          subscriptionId: "sub_stripe_1",
          clientReferenceId: "subscription_setup_sub_db_1",
        });

        await vi.advanceTimersByTimeAsync(2000);
        const result = await promise;

        expect(result.earlyReturn).toBe(false);
        expect(db.subscription.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: "sub_db_1" },
            data: { stripeSubscriptionId: "sub_stripe_1" },
          }),
        );
      });
    });
  });

  describe("handleInvoicePaymentFailed()", () => {
    describe("when no subscription found", () => {
      it("skips without error", async () => {
        db.subscription.findUnique.mockResolvedValue(null);

        const promise = service.handleInvoicePaymentFailed({
          subscriptionId: "sub_missing",
        });

        await vi.advanceTimersByTimeAsync(2000);
        await promise;

        expect(db.subscription.update).not.toHaveBeenCalled();
      });
    });

    describe("when subscription is ACTIVE", () => {
      it("keeps status as ACTIVE with failed payment date", async () => {
        db.subscription.findUnique.mockResolvedValue({
          id: "sub_db_1",
          status: SubscriptionStatus.ACTIVE,
        });
        db.subscription.update.mockResolvedValue({});

        const promise = service.handleInvoicePaymentFailed({
          subscriptionId: "sub_1",
        });

        await vi.advanceTimersByTimeAsync(2000);
        await promise;

        expect(db.subscription.update).toHaveBeenCalledWith({
          where: { id: "sub_db_1" },
          data: {
            status: SubscriptionStatus.ACTIVE,
            lastPaymentFailedDate: expect.any(Date),
          },
        });
      });
    });

    describe("when subscription is PENDING", () => {
      it("sets status to FAILED", async () => {
        db.subscription.findUnique.mockResolvedValue({
          id: "sub_db_1",
          status: SubscriptionStatus.PENDING,
        });
        db.subscription.update.mockResolvedValue({});

        const promise = service.handleInvoicePaymentFailed({
          subscriptionId: "sub_1",
        });

        await vi.advanceTimersByTimeAsync(2000);
        await promise;

        expect(db.subscription.update).toHaveBeenCalledWith({
          where: { id: "sub_db_1" },
          data: {
            status: SubscriptionStatus.FAILED,
            lastPaymentFailedDate: expect.any(Date),
          },
        });
      });
    });
  });

  describe("handleSubscriptionDeleted()", () => {
    describe("when no subscription found", () => {
      it("skips without error", async () => {
        db.subscription.findUnique.mockResolvedValue(null);

        await service.handleSubscriptionDeleted({
          stripeSubscriptionId: "sub_missing",
        });

        expect(db.subscription.update).not.toHaveBeenCalled();
      });
    });

    describe("when subscription exists", () => {
      it("cancels and nullifies limits", async () => {
        db.subscription.findUnique.mockResolvedValue({
          id: "sub_db_1",
        });
        db.subscription.update.mockResolvedValue({});

        await service.handleSubscriptionDeleted({
          stripeSubscriptionId: "sub_stripe_1",
        });

        expect(db.subscription.update).toHaveBeenCalledWith({
          where: { id: "sub_db_1" },
          data: {
            status: SubscriptionStatus.CANCELLED,
            endDate: expect.any(Date),
            maxMembers: null,
            maxMessagesPerMonth: null,
            maxProjects: null,
            evaluationsCredit: null,
          },
        });
      });
    });
  });

  describe("handleSubscriptionUpdated()", () => {
    describe("when no subscription found", () => {
      it("skips without error", async () => {
        db.subscription.findUnique.mockResolvedValue(null);

        const promise = service.handleSubscriptionUpdated({
          subscription: { id: "sub_missing", items: { data: [] } } as any,
        });

        await vi.advanceTimersByTimeAsync(2000);
        await promise;

        expect(db.subscription.update).not.toHaveBeenCalled();
      });
    });

    describe("when subscription is cancelled", () => {
      it("sets cancelled status and nullifies limits", async () => {
        db.subscription.findUnique.mockResolvedValue({
          id: "sub_db_1",
          status: SubscriptionStatus.ACTIVE,
        });
        db.subscription.update.mockResolvedValue({});

        const promise = service.handleSubscriptionUpdated({
          subscription: {
            id: "sub_stripe_1",
            status: "canceled",
            canceled_at: 1234567890,
            items: { data: [] },
          } as any,
        });

        await vi.advanceTimersByTimeAsync(2000);
        await promise;

        expect(db.subscription.update).toHaveBeenCalledWith({
          where: { id: "sub_db_1" },
          data: expect.objectContaining({
            status: SubscriptionStatus.CANCELLED,
          }),
        });
      });
    });

    describe("when subscription is active", () => {
      it("recalculates quantities and updates DB", async () => {
        db.subscription.findUnique.mockResolvedValue({
          id: "sub_db_1",
          status: SubscriptionStatus.ACTIVE,
          plan: "LAUNCH",
        });
        itemCalculator.calculateQuantityForPrice
          .mockReturnValueOnce(5) // users
          .mockReturnValueOnce(30_000); // traces
        db.subscription.update.mockResolvedValue({
          id: "sub_db_1",
          organizationId: "org_123",
          organization: { name: "Acme" },
          plan: "LAUNCH",
          startDate: new Date(),
          maxMembers: 5,
          maxMessagesPerMonth: 30_000,
        });

        const promise = service.handleSubscriptionUpdated({
          subscription: {
            id: "sub_stripe_1",
            status: "active",
            canceled_at: null,
            ended_at: null,
            items: {
              data: [
                { price: { id: "price_launch_users" }, quantity: 2 },
                { price: { id: "price_launch_traces" }, quantity: 1 },
              ],
            },
          } as any,
        });

        await vi.advanceTimersByTimeAsync(2000);
        await promise;

        expect(db.subscription.update).toHaveBeenCalledWith({
          where: { id: "sub_db_1" },
          data: {
            status: SubscriptionStatus.ACTIVE,
            lastPaymentFailedDate: null,
            maxMembers: 5,
            maxMessagesPerMonth: 30_000,
          },
          include: { organization: true },
        });
      });

      it("notifies when transitioning from non-active to active", async () => {
        db.subscription.findUnique.mockResolvedValue({
          id: "sub_db_1",
          status: SubscriptionStatus.PENDING,
          plan: "LAUNCH",
        });
        db.subscription.update.mockResolvedValue({
          id: "sub_db_1",
          organizationId: "org_123",
          organization: { name: "Acme" },
          plan: "LAUNCH",
          startDate: new Date(),
          maxMembers: null,
          maxMessagesPerMonth: null,
        });

        const promise = service.handleSubscriptionUpdated({
          subscription: {
            id: "sub_stripe_1",
            status: "active",
            canceled_at: null,
            ended_at: null,
            items: { data: [] },
          } as any,
        });

        await vi.advanceTimersByTimeAsync(2000);
        await promise;

        expect(mockNotifySubscriptionEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "confirmed",
            organizationId: "org_123",
          }),
        );
      });

      it("skips notification when already active", async () => {
        db.subscription.findUnique.mockResolvedValue({
          id: "sub_db_1",
          status: SubscriptionStatus.ACTIVE,
          plan: "LAUNCH",
        });
        db.subscription.update.mockResolvedValue({
          id: "sub_db_1",
          organizationId: "org_123",
          organization: { name: "Acme" },
          plan: "LAUNCH",
          startDate: new Date(),
          maxMembers: null,
          maxMessagesPerMonth: null,
        });

        const promise = service.handleSubscriptionUpdated({
          subscription: {
            id: "sub_stripe_1",
            status: "active",
            canceled_at: null,
            ended_at: null,
            items: { data: [] },
          } as any,
        });

        await vi.advanceTimersByTimeAsync(2000);
        await promise;

        expect(mockNotifySubscriptionEvent).not.toHaveBeenCalled();
      });
    });
  });
});
