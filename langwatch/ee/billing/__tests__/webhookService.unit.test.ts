import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSendSlackSubscriptionEvent = vi.fn().mockResolvedValue(undefined);

vi.mock("../../../src/server/app-layer/app", () => ({
  getApp: () => ({
    notifications: {
      sendSlackSubscriptionEvent: mockSendSlackSubscriptionEvent,
    },
  }),
}));

import { SubscriptionStatus } from "../planTypes";
import { EEWebhookService } from "../services/webhookService";
import type { SubscriptionRepository, SubscriptionWithOrg } from "../../../src/server/app-layer/subscription/subscription.repository";
import type { OrganizationRepository } from "../../../src/server/app-layer/organizations/repositories/organization.repository";

const createMockSubscriptionRepository = () => ({
  findLastNonCancelled: vi.fn(),
  createPending: vi.fn(),
  updateStatus: vi.fn(),
  updatePlan: vi.fn(),
  findByStripeId: vi.fn(),
  linkStripeId: vi.fn(),
  activate: vi.fn(),
  recordPaymentFailure: vi.fn(),
  cancel: vi.fn(),
  cancelTrialSubscriptions: vi.fn(),
  migrateToSeatEvent: vi.fn(),
  updateQuantities: vi.fn(),
});

const createMockOrganizationRepository = () => ({
  getOrganizationIdByTeamId: vi.fn(),
  getProjectIds: vi.fn(),
  getFeature: vi.fn(),
  findWithAdmins: vi.fn(),
  updateSentPlanLimitAlert: vi.fn(),
  findProjectsWithName: vi.fn(),
  clearTrialLicense: vi.fn(),
  updateCurrency: vi.fn(),
  getPricingModel: vi.fn(),
  getStripeCustomerId: vi.fn(),
  findNameById: vi.fn(),
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
    GROWTH_EVENTS_EUR_MONTHLY_UNTIL_MAR_2026: "price_growth_events_eur_monthly_until_mar_2026",
    GROWTH_EVENTS_EUR_ANNUAL_UNTIL_MAR_2026: "price_growth_events_eur_annual_until_mar_2026",
    GROWTH_EVENTS_USD_MONTHLY_UNTIL_MAR_2026: "price_growth_events_usd_monthly_until_mar_2026",
    GROWTH_EVENTS_USD_ANNUAL_UNTIL_MAR_2026: "price_growth_events_usd_annual_until_mar_2026",
  },
});

const makeSubscription = (overrides: Record<string, unknown> = {}) => ({
  id: "sub_db_1",
  organizationId: "org_123",
  status: SubscriptionStatus.PENDING,
  plan: "LAUNCH",
  stripeSubscriptionId: "sub_stripe_1",
  startDate: new Date(),
  endDate: null,
  lastPaymentFailedDate: null,
  maxMembers: null,
  maxMessagesPerMonth: null,
  ...overrides,
});

const makeSubscriptionWithOrg = (overrides: Record<string, unknown> = {}): SubscriptionWithOrg => {
  const { organization, ...subscriptionOverrides } = overrides;
  return {
    ...makeSubscription(subscriptionOverrides),
    organization: { name: "Acme", license: null, ...(organization as Record<string, unknown>) },
  } as unknown as SubscriptionWithOrg;
};

const createMockStripe = (overrides: Record<string, unknown> = {}) => ({
  subscriptions: {
    retrieve: vi.fn().mockResolvedValue({ id: "sub_stripe_1", status: "active" }),
    cancel: vi.fn().mockResolvedValue({}),
  },
  ...overrides,
});

describe("webhookService", () => {
  let subRepo: ReturnType<typeof createMockSubscriptionRepository>;
  let orgRepo: ReturnType<typeof createMockOrganizationRepository>;
  let itemCalculator: ReturnType<typeof createMockItemCalculator>;
  let mockStripeInstance: ReturnType<typeof createMockStripe>;
  let service: EEWebhookService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    subRepo = createMockSubscriptionRepository();
    orgRepo = createMockOrganizationRepository();
    itemCalculator = createMockItemCalculator();
    mockStripeInstance = createMockStripe();
    service = new EEWebhookService({
      subscriptionRepository: subRepo as unknown as SubscriptionRepository,
      organizationRepository: orgRepo as unknown as OrganizationRepository,
      stripe: mockStripeInstance as any,
      itemCalculator,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("handleCheckoutCompleted()", () => {
    describe("when client reference ID is missing", () => {
      it("returns early", async () => {
        const result = await service.handleCheckoutCompleted({
          subscriptionId: "sub_1",
          clientReferenceId: null,
        });

        expect(result.earlyReturn).toBe(true);
        expect(subRepo.linkStripeId).not.toHaveBeenCalled();
      });
    });

    describe("when client reference ID exists", () => {
      it("strips subscription_setup_ prefix and links Stripe subscription", async () => {
        subRepo.linkStripeId.mockResolvedValue({ count: 1 });
        subRepo.findByStripeId.mockResolvedValue(
          makeSubscription({ status: SubscriptionStatus.PENDING }),
        );
        subRepo.activate.mockResolvedValue(
          makeSubscriptionWithOrg({ status: SubscriptionStatus.ACTIVE }),
        );

        const promise = service.handleCheckoutCompleted({
          subscriptionId: "sub_stripe_1",
          clientReferenceId: "subscription_setup_sub_db_1",
        });

        await vi.advanceTimersByTimeAsync(2000);
        const result = await promise;

        expect(result.earlyReturn).toBe(false);
        expect(subRepo.linkStripeId).toHaveBeenCalledWith({
          id: "sub_db_1",
          stripeSubscriptionId: "sub_stripe_1",
        });
      });

      it("activates subscription and cancels trial subscriptions", async () => {
        subRepo.linkStripeId.mockResolvedValue({ count: 1 });
        subRepo.findByStripeId.mockResolvedValue(
          makeSubscription({ status: SubscriptionStatus.PENDING }),
        );
        subRepo.activate.mockResolvedValue(
          makeSubscriptionWithOrg({ status: SubscriptionStatus.ACTIVE }),
        );

        const promise = service.handleCheckoutCompleted({
          subscriptionId: "sub_stripe_1",
          clientReferenceId: "subscription_setup_sub_db_1",
        });

        await vi.advanceTimersByTimeAsync(2000);
        await promise;

        expect(subRepo.activate).toHaveBeenCalledWith({
          id: "sub_db_1",
          previousStatus: SubscriptionStatus.PENDING,
        });
        expect(subRepo.cancelTrialSubscriptions).toHaveBeenCalledWith("org_123");
      });

      it("throws SubscriptionRecordNotFoundError when no subscription matches", async () => {
        subRepo.linkStripeId.mockResolvedValue({ count: 0 });

        await expect(
          service.handleCheckoutCompleted({
            subscriptionId: "sub_stripe_1",
            clientReferenceId: "subscription_setup_sub_db_1",
          }),
        ).rejects.toThrow("No subscription record found");
      });

      it("continues when currency update fails", async () => {
        subRepo.linkStripeId.mockResolvedValue({ count: 1 });
        subRepo.findByStripeId.mockResolvedValue(
          makeSubscription({ status: SubscriptionStatus.PENDING }),
        );
        subRepo.activate.mockResolvedValue(
          makeSubscriptionWithOrg({ status: SubscriptionStatus.ACTIVE }),
        );
        orgRepo.updateCurrency.mockRejectedValue(new Error("DB error"));

        const promise = service.handleCheckoutCompleted({
          subscriptionId: "sub_stripe_1",
          clientReferenceId: "subscription_setup_sub_db_1",
          selectedCurrency: "EUR",
        });

        await vi.advanceTimersByTimeAsync(2000);
        await promise;

        expect(subRepo.activate).toHaveBeenCalled();
        expect(subRepo.cancelTrialSubscriptions).toHaveBeenCalledWith("org_123");
      });

      it("continues when invite approval fails", async () => {
        const mockInviteApprover = {
          approvePaymentPendingInvites: vi.fn().mockRejectedValue(new Error("invite error")),
        };
        service = new EEWebhookService({
          subscriptionRepository: subRepo as unknown as SubscriptionRepository,
          organizationRepository: orgRepo as unknown as OrganizationRepository,
          stripe: mockStripeInstance as any,
          itemCalculator,
          inviteApprover: mockInviteApprover,
        });

        subRepo.linkStripeId.mockResolvedValue({ count: 1 });
        subRepo.findByStripeId.mockResolvedValue(
          makeSubscription({ status: SubscriptionStatus.PENDING }),
        );
        subRepo.activate.mockResolvedValue(
          makeSubscriptionWithOrg({ status: SubscriptionStatus.ACTIVE }),
        );

        const promise = service.handleCheckoutCompleted({
          subscriptionId: "sub_stripe_1",
          clientReferenceId: "subscription_setup_sub_db_1",
        });

        await vi.advanceTimersByTimeAsync(2000);
        await promise;

        expect(subRepo.activate).toHaveBeenCalled();
        expect(subRepo.cancelTrialSubscriptions).toHaveBeenCalledWith("org_123");
      });

      it("completes without invite approver", async () => {
        subRepo.linkStripeId.mockResolvedValue({ count: 1 });
        subRepo.findByStripeId.mockResolvedValue(
          makeSubscription({ status: SubscriptionStatus.PENDING }),
        );
        subRepo.activate.mockResolvedValue(
          makeSubscriptionWithOrg({ status: SubscriptionStatus.ACTIVE }),
        );

        const promise = service.handleCheckoutCompleted({
          subscriptionId: "sub_stripe_1",
          clientReferenceId: "subscription_setup_sub_db_1",
        });

        await vi.advanceTimersByTimeAsync(2000);
        await promise;

        // No invite approver configured — should not throw
        expect(subRepo.activate).toHaveBeenCalled();
      });
    });
  });

  describe("handleInvoicePaymentSucceeded()", () => {
    describe("when no subscription found", () => {
      it("skips without error", async () => {
        subRepo.findByStripeId.mockResolvedValue(null);

        const promise = service.handleInvoicePaymentSucceeded({
          subscriptionId: "sub_missing",
        });

        await vi.advanceTimersByTimeAsync(2000);
        await promise;

        expect(subRepo.activate).not.toHaveBeenCalled();
      });
    });

    describe("when subscription is not previously active", () => {
      it("activates and clears trial license", async () => {
        subRepo.findByStripeId.mockResolvedValue(
          makeSubscription({ status: SubscriptionStatus.PENDING }),
        );
        subRepo.activate.mockResolvedValue(
          makeSubscriptionWithOrg({
            status: SubscriptionStatus.ACTIVE,
            organization: { name: "Acme", license: "trial-license-key" },
          }),
        );

        const promise = service.handleInvoicePaymentSucceeded({
          subscriptionId: "sub_stripe_1",
        });

        await vi.advanceTimersByTimeAsync(2000);
        await promise;

        expect(subRepo.activate).toHaveBeenCalledWith({
          id: "sub_db_1",
          previousStatus: SubscriptionStatus.PENDING,
        });
        expect(orgRepo.clearTrialLicense).toHaveBeenCalledWith("org_123");
        expect(mockSendSlackSubscriptionEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "confirmed",
            organizationId: "org_123",
          }),
        );
      });
    });

    describe("when subscription is already active", () => {
      it("does not set startDate and does not notify", async () => {
        subRepo.findByStripeId.mockResolvedValue(
          makeSubscription({ status: SubscriptionStatus.ACTIVE }),
        );
        subRepo.activate.mockResolvedValue(
          makeSubscriptionWithOrg({ status: SubscriptionStatus.ACTIVE }),
        );

        const promise = service.handleInvoicePaymentSucceeded({
          subscriptionId: "sub_stripe_1",
        });

        await vi.advanceTimersByTimeAsync(2000);
        await promise;

        expect(subRepo.activate).toHaveBeenCalledWith({
          id: "sub_db_1",
          previousStatus: SubscriptionStatus.ACTIVE,
        });
        expect(mockSendSlackSubscriptionEvent).not.toHaveBeenCalled();
      });
    });

    describe("when subscription is a growth seat-event plan", () => {
      it("migrates tiered subscriptions and cancels old Stripe subs", async () => {
        const localStripe = createMockStripe();
        service = new EEWebhookService({
          subscriptionRepository: subRepo as unknown as SubscriptionRepository,
          organizationRepository: orgRepo as unknown as OrganizationRepository,
          stripe: localStripe as any,
          itemCalculator,
        });

        subRepo.findByStripeId.mockResolvedValue(
          makeSubscription({ status: SubscriptionStatus.PENDING, plan: "GROWTH_SEAT_EUR_MONTHLY" }),
        );
        subRepo.activate.mockResolvedValue(
          makeSubscriptionWithOrg({ status: SubscriptionStatus.ACTIVE, plan: "GROWTH_SEAT_EUR_MONTHLY" }),
        );
        subRepo.migrateToSeatEvent.mockResolvedValue([
          { stripeSubscriptionId: "sub_old_1" },
          { stripeSubscriptionId: "sub_old_2" },
        ]);

        const promise = service.handleInvoicePaymentSucceeded({
          subscriptionId: "sub_stripe_1",
        });

        await vi.advanceTimersByTimeAsync(2000);
        await promise;

        expect(subRepo.migrateToSeatEvent).toHaveBeenCalledWith({
          organizationId: "org_123",
          excludeSubscriptionId: "sub_db_1",
        });
        expect(localStripe.subscriptions.cancel).toHaveBeenCalledWith("sub_old_1", { prorate: true });
        expect(localStripe.subscriptions.cancel).toHaveBeenCalledWith("sub_old_2", { prorate: true });
      });

      it("logs but does not fail when Stripe cancellation fails", async () => {
        const localStripe = createMockStripe();
        localStripe.subscriptions.cancel.mockRejectedValue(new Error("Stripe error"));
        service = new EEWebhookService({
          subscriptionRepository: subRepo as unknown as SubscriptionRepository,
          organizationRepository: orgRepo as unknown as OrganizationRepository,
          stripe: localStripe as any,
          itemCalculator,
        });

        subRepo.findByStripeId.mockResolvedValue(
          makeSubscription({ status: SubscriptionStatus.PENDING, plan: "GROWTH_SEAT_EUR_MONTHLY" }),
        );
        subRepo.activate.mockResolvedValue(
          makeSubscriptionWithOrg({ status: SubscriptionStatus.ACTIVE, plan: "GROWTH_SEAT_EUR_MONTHLY" }),
        );
        subRepo.migrateToSeatEvent.mockResolvedValue([
          { stripeSubscriptionId: "sub_old_1" },
        ]);

        const promise = service.handleInvoicePaymentSucceeded({
          subscriptionId: "sub_stripe_1",
        });

        await vi.advanceTimersByTimeAsync(2000);
        // Should not throw
        await promise;

        expect(mockSendSlackSubscriptionEvent).toHaveBeenCalled();
      });
    });

    describe("when subscription is already CANCELLED in DB and Stripe subscription is canceled", () => {
      it("does not reactivate a cancelled subscription", async () => {
        mockStripeInstance.subscriptions.retrieve.mockResolvedValue({
          id: "sub_stripe_1",
          status: "canceled",
        });

        subRepo.findByStripeId.mockResolvedValue(
          makeSubscription({
            status: SubscriptionStatus.CANCELLED,
            plan: "GROWTH_SEAT_EUR_MONTHLY",
          }),
        );

        const promise = service.handleInvoicePaymentSucceeded({
          subscriptionId: "sub_stripe_1",
        });

        await vi.advanceTimersByTimeAsync(2000);
        await promise;

        expect(subRepo.activate).not.toHaveBeenCalled();
        expect(mockSendSlackSubscriptionEvent).not.toHaveBeenCalled();
      });
    });

    describe("when subscription is ACTIVE in DB but Stripe subscription is canceled", () => {
      it("does not reactivate a cancelling subscription", async () => {
        mockStripeInstance.subscriptions.retrieve.mockResolvedValue({
          id: "sub_stripe_1",
          status: "canceled",
        });

        subRepo.findByStripeId.mockResolvedValue(
          makeSubscription({
            status: SubscriptionStatus.ACTIVE,
            plan: "GROWTH_SEAT_EUR_MONTHLY",
          }),
        );

        const promise = service.handleInvoicePaymentSucceeded({
          subscriptionId: "sub_stripe_1",
        });

        await vi.advanceTimersByTimeAsync(2000);
        await promise;

        expect(subRepo.activate).not.toHaveBeenCalled();
        expect(mockSendSlackSubscriptionEvent).not.toHaveBeenCalled();
      });
    });

    describe("when Stripe subscription status check fails", () => {
      it("proceeds with activation (fail-open)", async () => {
        mockStripeInstance.subscriptions.retrieve.mockRejectedValue(
          new Error("Stripe API unreachable"),
        );

        subRepo.findByStripeId.mockResolvedValue(
          makeSubscription({ status: SubscriptionStatus.PENDING }),
        );
        subRepo.activate.mockResolvedValue(
          makeSubscriptionWithOrg({ status: SubscriptionStatus.ACTIVE }),
        );

        const promise = service.handleInvoicePaymentSucceeded({
          subscriptionId: "sub_stripe_1",
        });

        await vi.advanceTimersByTimeAsync(2000);
        await promise;

        expect(subRepo.activate).toHaveBeenCalledWith({
          id: "sub_db_1",
          previousStatus: SubscriptionStatus.PENDING,
        });
        expect(mockSendSlackSubscriptionEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "confirmed",
            organizationId: "org_123",
          }),
        );
      });
    });

    describe("when Stripe subscription is active (normal renewal)", () => {
      it("activates the subscription as usual", async () => {
        subRepo.findByStripeId.mockResolvedValue(
          makeSubscription({ status: SubscriptionStatus.PENDING }),
        );
        subRepo.activate.mockResolvedValue(
          makeSubscriptionWithOrg({ status: SubscriptionStatus.ACTIVE }),
        );

        const promise = service.handleInvoicePaymentSucceeded({
          subscriptionId: "sub_stripe_1",
        });

        await vi.advanceTimersByTimeAsync(2000);
        await promise;

        expect(subRepo.activate).toHaveBeenCalledWith({
          id: "sub_db_1",
          previousStatus: SubscriptionStatus.PENDING,
        });
        expect(mockSendSlackSubscriptionEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "confirmed",
            organizationId: "org_123",
          }),
        );
      });
    });
  });

  describe("handleInvoicePaymentFailed()", () => {
    describe("when no subscription found", () => {
      it("skips without error", async () => {
        subRepo.findByStripeId.mockResolvedValue(null);

        const promise = service.handleInvoicePaymentFailed({
          subscriptionId: "sub_missing",
        });

        await vi.advanceTimersByTimeAsync(2000);
        await promise;

        expect(subRepo.recordPaymentFailure).not.toHaveBeenCalled();
      });
    });

    describe("when subscription is ACTIVE", () => {
      it("keeps status as ACTIVE with failed payment date", async () => {
        subRepo.findByStripeId.mockResolvedValue(
          makeSubscription({ status: SubscriptionStatus.ACTIVE }),
        );

        const promise = service.handleInvoicePaymentFailed({
          subscriptionId: "sub_1",
        });

        await vi.advanceTimersByTimeAsync(2000);
        await promise;

        expect(subRepo.recordPaymentFailure).toHaveBeenCalledWith({
          id: "sub_db_1",
          currentStatus: SubscriptionStatus.ACTIVE,
        });
      });
    });

    describe("when subscription is PENDING", () => {
      it("sets status to FAILED", async () => {
        subRepo.findByStripeId.mockResolvedValue(
          makeSubscription({ status: SubscriptionStatus.PENDING }),
        );

        const promise = service.handleInvoicePaymentFailed({
          subscriptionId: "sub_1",
        });

        await vi.advanceTimersByTimeAsync(2000);
        await promise;

        expect(subRepo.recordPaymentFailure).toHaveBeenCalledWith({
          id: "sub_db_1",
          currentStatus: SubscriptionStatus.PENDING,
        });
      });
    });
  });

  describe("handleSubscriptionDeleted()", () => {
    it("waits for Stripe eventual consistency before looking up the subscription", async () => {
      subRepo.findByStripeId.mockResolvedValue(null);

      const promise = service.handleSubscriptionDeleted({
        stripeSubscriptionId: "sub_stripe_1",
      });

      // Repository should not have been called yet — still waiting
      expect(subRepo.findByStripeId).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(2000);
      await promise;

      expect(subRepo.findByStripeId).toHaveBeenCalledWith("sub_stripe_1");
    });

    describe("when no subscription found", () => {
      it("skips without error", async () => {
        subRepo.findByStripeId.mockResolvedValue(null);

        const promise = service.handleSubscriptionDeleted({
          stripeSubscriptionId: "sub_missing",
        });

        await vi.advanceTimersByTimeAsync(2000);
        await promise;

        expect(subRepo.cancel).not.toHaveBeenCalled();
      });
    });

    describe("when subscription exists", () => {
      it("cancels and nullifies overrides", async () => {
        subRepo.findByStripeId.mockResolvedValue(
          makeSubscription({ status: SubscriptionStatus.ACTIVE }),
        );

        const promise = service.handleSubscriptionDeleted({
          stripeSubscriptionId: "sub_stripe_1",
        });

        await vi.advanceTimersByTimeAsync(2000);
        await promise;

        expect(subRepo.cancel).toHaveBeenCalledWith({ id: "sub_db_1" });
      });
    });

    describe("when subscription is already cancelled", () => {
      it("is idempotent — skips redundant update", async () => {
        subRepo.findByStripeId.mockResolvedValue(
          makeSubscription({ status: SubscriptionStatus.CANCELLED }),
        );

        const promise = service.handleSubscriptionDeleted({
          stripeSubscriptionId: "sub_stripe_1",
        });

        await vi.advanceTimersByTimeAsync(2000);
        await promise;

        expect(subRepo.cancel).not.toHaveBeenCalled();
      });
    });

    describe("when subscription is active and gets cancelled", () => {
      it("sends a cancelled Slack notification", async () => {
        subRepo.findByStripeId.mockResolvedValue(
          makeSubscription({ status: SubscriptionStatus.ACTIVE, plan: "GROWTH_SEAT_EUR_MONTHLY" }),
        );
        orgRepo.findNameById.mockResolvedValue({ id: "org_123", name: "Acme" });

        const promise = service.handleSubscriptionDeleted({
          stripeSubscriptionId: "sub_stripe_1",
        });

        await vi.advanceTimersByTimeAsync(2000);
        await promise;

        expect(mockSendSlackSubscriptionEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "cancelled",
            organizationId: "org_123",
            organizationName: "Acme",
            plan: "GROWTH_SEAT_EUR_MONTHLY",
            subscriptionId: "sub_db_1",
          }),
        );
      });

      it("sends notification with cancellation date", async () => {
        const cancelDate = new Date("2026-03-15T10:00:00Z");
        subRepo.findByStripeId.mockResolvedValue(
          makeSubscription({ status: SubscriptionStatus.ACTIVE, plan: "GROWTH_SEAT_EUR_MONTHLY" }),
        );
        orgRepo.findNameById.mockResolvedValue({ id: "org_123", name: "Acme" });

        const promise = service.handleSubscriptionDeleted({
          stripeSubscriptionId: "sub_stripe_1",
        });

        await vi.advanceTimersByTimeAsync(2000);
        await promise;

        expect(mockSendSlackSubscriptionEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "cancelled",
            cancellationDate: expect.any(Date),
          }),
        );
      });

      it("still cancels and notifies even when org name lookup fails", async () => {
        subRepo.findByStripeId.mockResolvedValue(
          makeSubscription({ status: SubscriptionStatus.ACTIVE, plan: "GROWTH_SEAT_EUR_MONTHLY" }),
        );
        orgRepo.findNameById.mockResolvedValue(null);

        const promise = service.handleSubscriptionDeleted({
          stripeSubscriptionId: "sub_stripe_1",
        });

        await vi.advanceTimersByTimeAsync(2000);
        await promise;

        expect(subRepo.cancel).toHaveBeenCalledWith({ id: "sub_db_1" });
        expect(mockSendSlackSubscriptionEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "cancelled",
            organizationName: "Unknown",
          }),
        );
      });
    });
  });

  describe("handleSubscriptionUpdated()", () => {
    describe("when no subscription found", () => {
      it("skips without error", async () => {
        subRepo.findByStripeId.mockResolvedValue(null);

        const promise = service.handleSubscriptionUpdated({
          subscription: { id: "sub_missing", items: { data: [] } } as any,
        });

        await vi.advanceTimersByTimeAsync(2000);
        await promise;

        expect(subRepo.cancel).not.toHaveBeenCalled();
        expect(subRepo.updateQuantities).not.toHaveBeenCalled();
      });
    });

    describe("when Stripe status is not active", () => {
      it("cancels with nullified overrides", async () => {
        subRepo.findByStripeId.mockResolvedValue(
          makeSubscription({ status: SubscriptionStatus.ACTIVE }),
        );

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

        expect(subRepo.cancel).toHaveBeenCalledWith({ id: "sub_db_1" });
      });
    });

    describe("when Stripe reports ended", () => {
      it("cancels with nullified overrides", async () => {
        subRepo.findByStripeId.mockResolvedValue(
          makeSubscription({ status: SubscriptionStatus.ACTIVE }),
        );

        const promise = service.handleSubscriptionUpdated({
          subscription: {
            id: "sub_stripe_1",
            status: "active",
            ended_at: 1234567890,
            items: { data: [] },
          } as any,
        });

        await vi.advanceTimersByTimeAsync(2000);
        await promise;

        expect(subRepo.cancel).toHaveBeenCalledWith({ id: "sub_db_1" });
      });
    });

    describe("when only canceled_at is set (scheduled cancellation)", () => {
      it("does NOT cancel — updates quantities as normal", async () => {
        subRepo.findByStripeId.mockResolvedValue(
          makeSubscription({ status: SubscriptionStatus.ACTIVE }),
        );
        subRepo.updateQuantities.mockResolvedValue(
          makeSubscriptionWithOrg({ status: SubscriptionStatus.ACTIVE }),
        );

        const promise = service.handleSubscriptionUpdated({
          subscription: {
            id: "sub_stripe_1",
            status: "active",
            canceled_at: 1234567890,
            ended_at: null,
            items: { data: [] },
          } as any,
        });

        await vi.advanceTimersByTimeAsync(2000);
        await promise;

        expect(subRepo.cancel).not.toHaveBeenCalled();
        expect(subRepo.updateQuantities).toHaveBeenCalled();
      });
    });

    describe("when subscription is active", () => {
      it("recalculates quantities and updates", async () => {
        subRepo.findByStripeId.mockResolvedValue(
          makeSubscription({ status: SubscriptionStatus.ACTIVE, plan: "LAUNCH" }),
        );
        itemCalculator.calculateQuantityForPrice
          .mockReturnValueOnce(5) // users
          .mockReturnValueOnce(30_000); // traces
        subRepo.updateQuantities.mockResolvedValue(
          makeSubscriptionWithOrg({
            status: SubscriptionStatus.ACTIVE,
            maxMembers: 5,
            maxMessagesPerMonth: 30_000,
          }),
        );

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

        expect(subRepo.updateQuantities).toHaveBeenCalledWith({
          id: "sub_db_1",
          maxMembers: 5,
          maxMessagesPerMonth: 30_000,
        });
      });

      it("notifies when transitioning from non-active to active", async () => {
        subRepo.findByStripeId.mockResolvedValue(
          makeSubscription({ status: SubscriptionStatus.PENDING, plan: "LAUNCH" }),
        );
        subRepo.updateQuantities.mockResolvedValue(
          makeSubscriptionWithOrg({ status: SubscriptionStatus.ACTIVE }),
        );

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

        expect(mockSendSlackSubscriptionEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "confirmed",
            organizationId: "org_123",
          }),
        );
      });

      it("skips notification when already active", async () => {
        subRepo.findByStripeId.mockResolvedValue(
          makeSubscription({ status: SubscriptionStatus.ACTIVE, plan: "LAUNCH" }),
        );
        subRepo.updateQuantities.mockResolvedValue(
          makeSubscriptionWithOrg({ status: SubscriptionStatus.ACTIVE }),
        );

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

        expect(mockSendSlackSubscriptionEvent).not.toHaveBeenCalled();
      });
    });
  });
});
