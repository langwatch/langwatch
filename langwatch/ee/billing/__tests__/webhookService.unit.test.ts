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
    findMany: vi.fn().mockResolvedValue([]),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  organization: {
    update: vi.fn(),
  },
  $transaction: vi.fn(async (fn: (tx: any) => Promise<any>) => {
    const tx = {
      organization: { update: vi.fn() },
      subscription: {
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn(),
      },
    };
    return fn(tx);
  }),
});

const createMockStripe = () => ({
  subscriptions: {
    cancel: vi.fn().mockResolvedValue({}),
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
    GROWTH_SEAT_EUR_MONTHLY: "price_growth_seat_eur_monthly",
    GROWTH_SEAT_EUR_ANNUAL: "price_growth_seat_eur_annual",
    GROWTH_SEAT_USD_MONTHLY: "price_growth_seat_usd_monthly",
    GROWTH_SEAT_USD_ANNUAL: "price_growth_seat_usd_annual",
    GROWTH_EVENTS_EUR_MONTHLY: "price_growth_events_eur_monthly",
    GROWTH_EVENTS_EUR_ANNUAL: "price_growth_events_eur_annual",
    GROWTH_EVENTS_USD_MONTHLY: "price_growth_events_usd_monthly",
    GROWTH_EVENTS_USD_ANNUAL: "price_growth_events_usd_annual",
  },
});

describe("webhookService", () => {
  let db: ReturnType<typeof createMockDb>;
  let stripe: ReturnType<typeof createMockStripe>;
  let itemCalculator: ReturnType<typeof createMockItemCalculator>;
  let service: ReturnType<typeof createWebhookService>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    db = createMockDb();
    stripe = createMockStripe();
    itemCalculator = createMockItemCalculator();
    service = createWebhookService({
      db: db as any,
      stripe: stripe as any,
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
        db.subscription.updateMany.mockResolvedValue({ count: 1 });
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
        expect(db.subscription.updateMany).toHaveBeenCalledWith({
          where: { id: "sub_db_1" },
          data: { stripeSubscriptionId: "sub_stripe_1" },
        });
      });

      it("persists selected currency after successful checkout", async () => {
        db.subscription.updateMany.mockResolvedValue({ count: 1 });
        db.subscription.findUnique
          .mockResolvedValueOnce({
            id: "sub_db_1",
            status: SubscriptionStatus.PENDING,
          })
          .mockResolvedValueOnce({
            id: "sub_db_1",
            organizationId: "org_123",
          });
        db.subscription.update.mockResolvedValue({
          id: "sub_db_1",
          organizationId: "org_123",
          organization: { name: "Acme" },
          plan: "GROWTH_SEAT_EVENT",
          startDate: new Date(),
          maxMembers: null,
          maxMessagesPerMonth: null,
          status: SubscriptionStatus.ACTIVE,
        });

        const promise = service.handleCheckoutCompleted({
          subscriptionId: "sub_stripe_1",
          clientReferenceId: "subscription_setup_sub_db_1",
          selectedCurrency: "USD",
          selectedBillingInterval: "annual",
        });

        await vi.advanceTimersByTimeAsync(2000);
        await promise;

        expect(db.organization.update).toHaveBeenCalledWith({
          where: { id: "org_123" },
          data: { currency: "USD" },
        });
      });

      it("ignores invalid currency metadata", async () => {
        db.subscription.updateMany.mockResolvedValue({ count: 1 });
        db.subscription.findUnique.mockResolvedValue({
          id: "sub_db_1",
          status: SubscriptionStatus.PENDING,
        });
        db.subscription.update.mockResolvedValue({
          id: "sub_db_1",
          organizationId: "org_123",
          organization: { name: "Acme" },
          plan: "GROWTH_SEAT_EVENT",
          startDate: new Date(),
          maxMembers: null,
          maxMessagesPerMonth: null,
          status: SubscriptionStatus.ACTIVE,
        });

        const promise = service.handleCheckoutCompleted({
          subscriptionId: "sub_stripe_1",
          clientReferenceId: "subscription_setup_sub_db_1",
          selectedCurrency: "GBP",
        });

        await vi.advanceTimersByTimeAsync(2000);
        await promise;

        expect(db.organization.update).not.toHaveBeenCalled();
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

    describe("when subscription is already CANCELLED", () => {
      it("skips the update (idempotency)", async () => {
        db.subscription.findUnique.mockResolvedValue({
          id: "sub_db_1",
          status: SubscriptionStatus.CANCELLED,
        });

        await service.handleSubscriptionDeleted({
          stripeSubscriptionId: "sub_stripe_1",
        });

        expect(db.subscription.update).not.toHaveBeenCalled();
      });
    });
  });

  describe("handleInvoicePaymentSucceeded()", () => {
    describe("when GROWTH_SEAT_EVENT sub activates from PENDING", () => {
      beforeEach(() => {
        db.subscription.findUnique.mockResolvedValue({
          id: "sub_db_new",
          status: SubscriptionStatus.PENDING,
        });
        db.subscription.update.mockResolvedValue({
          id: "sub_db_new",
          organizationId: "org_1",
          organization: { name: "Acme" },
          plan: "GROWTH_SEAT_EVENT",
          startDate: new Date(),
          maxMembers: 5,
          maxMessagesPerMonth: null,
          status: SubscriptionStatus.ACTIVE,
        });
      });

      describe("when old TIERED subscriptions exist", () => {
        beforeEach(() => {
          db.$transaction.mockImplementation(async (fn: any) => {
            const tx = {
              organization: { update: vi.fn() },
              subscription: {
                findMany: vi.fn().mockResolvedValue([{
                  id: "old_sub_1",
                  stripeSubscriptionId: "sub_stripe_old",
                  plan: "ACCELERATE",
                  status: "ACTIVE",
                }]),
                update: vi.fn(),
              },
            };
            return fn(tx);
          });
        });

        it("cancels old TIERED subscription in Stripe with proration", async () => {
          const promise = service.handleInvoicePaymentSucceeded({
            subscriptionId: "sub_stripe_new",
            throwOnMissing: false,
          });
          await vi.advanceTimersByTimeAsync(2000);
          await promise;

          expect(stripe.subscriptions.cancel).toHaveBeenCalledWith(
            "sub_stripe_old",
            { prorate: true },
          );
        });
      });

      describe("when no old TIERED subscriptions exist", () => {
        it("does not cancel any Stripe subscriptions", async () => {
          const promise = service.handleInvoicePaymentSucceeded({
            subscriptionId: "sub_stripe_new",
            throwOnMissing: false,
          });
          await vi.advanceTimersByTimeAsync(2000);
          await promise;

          expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
        });
      });

      describe("when Stripe cancel fails", () => {
        beforeEach(() => {
          db.$transaction.mockImplementation(async (fn: any) => {
            const tx = {
              organization: { update: vi.fn() },
              subscription: {
                findMany: vi.fn().mockResolvedValue([{
                  id: "old_sub_1",
                  stripeSubscriptionId: "sub_stripe_old",
                  plan: "LAUNCH",
                  status: "ACTIVE",
                }]),
                update: vi.fn(),
              },
            };
            return fn(tx);
          });
          stripe.subscriptions.cancel.mockRejectedValue(new Error("Stripe down"));
        });

        it("resolves without throwing", async () => {
          const promise = service.handleInvoicePaymentSucceeded({
            subscriptionId: "sub_stripe_new",
            throwOnMissing: false,
          });
          await vi.advanceTimersByTimeAsync(2000);
          await expect(promise).resolves.toBeUndefined();
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
