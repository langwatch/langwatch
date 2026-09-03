import { beforeEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";
import { PlanTypes, SubscriptionStatus } from "@langwatch/enterprise-billing-contract";
import {
  BillingSubscriptionService,
  SeatEventSubscriptionService,
  RECENT_INVOICES_LIMIT,
  type BillingSubscriptionRepository,
  type BillingOrganizationPort,
  type BillingSubscriptionNotifierPort,
  type SubscriptionItemCalculatorService,
} from "../index";

const mockSendSlackSubscriptionEvent = vi.fn().mockResolvedValue(undefined);

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

const createMockRepository = (): {
  [K in keyof BillingSubscriptionRepository]: ReturnType<typeof vi.fn>;
} => ({
  tryFindActive: vi.fn(),
  tryFindLastNonCancelled: vi.fn(),
  createPending: vi.fn(),
  updateStatus: vi.fn(),
  updatePlan: vi.fn(),
  tryFindByStripeId: vi.fn(),
  linkStripeId: vi.fn(),
  activate: vi.fn(),
  recordPaymentFailure: vi.fn(),
  cancel: vi.fn(),
  cancelTrialSubscriptions: vi.fn(),
  migrateToSeatEvent: vi.fn(),
  updateQuantities: vi.fn(),
});

const createMockItemCalculator = () => ({
  getItemsToUpdate: vi.fn().mockReturnValue([]),
  createItemsToAdd: vi.fn().mockReturnValue([]),
  prices: { LAUNCH: "price_launch", FREE: undefined } as any,
});

const createMockOrganizationRepository = (): {
  [K in keyof BillingOrganizationPort]: ReturnType<typeof vi.fn>;
} => ({
  tryGetPricingModel: vi.fn(),
  tryGetStripeCustomerId: vi.fn(),
  tryFindName: vi.fn(),
  tryFindFirstTeamId: vi.fn(),
});

const createMockNotifier = (): BillingSubscriptionNotifierPort => ({
  send: mockSendSlackSubscriptionEvent,
});

const createMockSeatEventService = () =>
  ({
    createSeatEventCheckout: vi.fn(),
    updateSeatEventItems: vi.fn(),
    previewProration: vi.fn(),
    seatEventBillingPortalUrl: vi.fn(),
  }) as unknown as SeatEventSubscriptionService;

const createServiceWithSeatEventFns = ({
  repository,
  stripe: stripeInstance,
  itemCalculator: calc,
  organizationRepository: orgRepo,
  seatEventService,
}: {
  repository: ReturnType<typeof createMockRepository>;
  stripe: ReturnType<typeof createMockStripe>;
  itemCalculator: ReturnType<typeof createMockItemCalculator>;
  organizationRepository: ReturnType<typeof createMockOrganizationRepository>;
  seatEventService: ReturnType<typeof createMockSeatEventService>;
}) =>
  BillingSubscriptionService.create({
    repository: repository as unknown as BillingSubscriptionRepository,
    organizationRepository: orgRepo as unknown as BillingOrganizationPort,
    stripe: stripeInstance as unknown as Stripe,
    itemCalculator: calc as unknown as SubscriptionItemCalculatorService,
    seatEventService,
    notifier: createMockNotifier(),
  });

describe("BillingSubscriptionService", () => {
  let stripe: ReturnType<typeof createMockStripe>;
  let repository: ReturnType<typeof createMockRepository>;
  let itemCalculator: ReturnType<typeof createMockItemCalculator>;
  let organizationRepository: ReturnType<typeof createMockOrganizationRepository>;
  let service: BillingSubscriptionService;

  describe("interface conformance", () => {
    /** @scenario "New class implements the same interface as old factory" */
    it("implements the SubscriptionService app-layer interface", () => {
      const localService = BillingSubscriptionService.create({
        repository: createMockRepository() as unknown as BillingSubscriptionRepository,
        organizationRepository:
          createMockOrganizationRepository() as unknown as BillingOrganizationPort,
        stripe: createMockStripe() as unknown as Stripe,
        itemCalculator: createMockItemCalculator() as unknown as SubscriptionItemCalculatorService,
        notifier: createMockNotifier(),
      });

      expect(typeof localService.updateSubscriptionItems).toBe("function");
      expect(typeof localService.createOrUpdateSubscription).toBe("function");
      expect(typeof localService.createBillingPortalSession).toBe("function");
      expect(typeof localService.getLastNonCancelledSubscription).toBe("function");
      expect(typeof localService.notifyProspective).toBe("function");
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    stripe = createMockStripe();
    repository = createMockRepository();
    itemCalculator = createMockItemCalculator();
    organizationRepository = createMockOrganizationRepository();
    service = BillingSubscriptionService.create({
      repository: repository as unknown as BillingSubscriptionRepository,
      organizationRepository: organizationRepository as unknown as BillingOrganizationPort,
      stripe: stripe as unknown as Stripe,
      itemCalculator: itemCalculator as unknown as SubscriptionItemCalculatorService,
      notifier: createMockNotifier(),
    });
  });

  describe("updateSubscriptionItems()", () => {
    describe("when active subscription exists", () => {
      /** @scenario EESubscriptionService updates subscription items via Stripe */
      it("updates subscription items via Stripe", async () => {
        repository.tryFindLastNonCancelled.mockResolvedValue({
          id: "sub_db_1",
          stripeSubscriptionId: "sub_stripe_1",
          status: SubscriptionStatus.ACTIVE,
          plan: PlanTypes.LAUNCH,
        });
        stripe.subscriptions.retrieve.mockResolvedValue({
          items: { data: [{ id: "si_1", price: { id: "price_launch" } }] },
        });
        itemCalculator.getItemsToUpdate.mockReturnValue([{ id: "si_1", quantity: 1 }]);
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
        expect(stripe.subscriptions.update).toHaveBeenCalledWith("sub_stripe_1", {
          items: [{ id: "si_1", quantity: 1 }],
        });
      });
    });

    describe("when upgradeTraces is false", () => {
      it("passes zero traces to the item calculator", async () => {
        repository.tryFindLastNonCancelled.mockResolvedValue({
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
        repository.tryFindLastNonCancelled.mockResolvedValue({
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
        repository.tryFindLastNonCancelled.mockResolvedValue(null);

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
      /** @scenario EESubscriptionService cancels subscription when downgrading to free */
      it("cancels Stripe subscription and updates status via repository", async () => {
        repository.tryFindLastNonCancelled.mockResolvedValue({
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
        repository.tryFindLastNonCancelled.mockResolvedValue({
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

        expect(result.url).toBe("https://app.test/settings/subscription?success");
        expect(repository.updatePlan).toHaveBeenCalledWith({
          id: "sub_db_1",
          plan: PlanTypes.ACCELERATE,
        });
      });
    });

    describe("when creating new subscription", () => {
      /** @scenario EESubscriptionService creates checkout for new subscription */
      it("creates checkout session for new plan", async () => {
        repository.tryFindLastNonCancelled.mockResolvedValue(null);
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
      it("raises billing_plan_price_missing without creating a pending subscription", async () => {
        repository.tryFindLastNonCancelled.mockResolvedValue(null);

        await expect(
          service.createOrUpdateSubscription({
            organizationId: "org_123",
            baseUrl: "https://app.test",
            plan: "INVALID_PLAN" as any,
            customerId: "cus_123",
          }),
        ).rejects.toMatchObject({ code: "billing_plan_price_missing" });

        expect(repository.createPending).not.toHaveBeenCalled();
      });
    });

    describe("when selecting FREE with no existing subscription", () => {
      it("returns subscription settings URL", async () => {
        repository.tryFindLastNonCancelled.mockResolvedValue(null);

        const result = await service.createOrUpdateSubscription({
          organizationId: "org_123",
          baseUrl: "https://app.test",
          plan: PlanTypes.FREE,
          customerId: "cus_123",
        });

        expect(result.url).toBe("https://app.test/settings/subscription");
      });
    });

    describe("when createPending succeeds but stripe checkout throws", () => {
      it("propagates the error", async () => {
        repository.tryFindLastNonCancelled.mockResolvedValue(null);
        repository.createPending.mockResolvedValue({ id: "sub_new" });
        stripe.checkout.sessions.create.mockRejectedValue(new Error("Stripe checkout failed"));

        await expect(
          service.createOrUpdateSubscription({
            organizationId: "org_123",
            baseUrl: "https://app.test",
            plan: PlanTypes.LAUNCH,
            customerId: "cus_123",
          }),
        ).rejects.toThrow("Stripe checkout failed");
      });
    });

    describe("when upgrading and stripe subscriptions.update throws", () => {
      it("does not call repository.updatePlan", async () => {
        repository.tryFindLastNonCancelled.mockResolvedValue({
          id: "sub_db_1",
          stripeSubscriptionId: "sub_stripe_1",
          status: SubscriptionStatus.ACTIVE,
        });
        stripe.subscriptions.retrieve.mockResolvedValue({
          items: { data: [] },
        });
        stripe.subscriptions.update.mockRejectedValue(new Error("Stripe update failed"));

        await expect(
          service.createOrUpdateSubscription({
            organizationId: "org_123",
            baseUrl: "https://app.test",
            plan: PlanTypes.ACCELERATE,
            customerId: "cus_123",
          }),
        ).rejects.toThrow("Stripe update failed");

        expect(repository.updatePlan).not.toHaveBeenCalled();
      });
    });

    describe("when cancelling and stripe subscriptions.cancel throws", () => {
      it("does not call repository.updateStatus", async () => {
        repository.tryFindLastNonCancelled.mockResolvedValue({
          id: "sub_db_1",
          stripeSubscriptionId: "sub_stripe_1",
          status: SubscriptionStatus.ACTIVE,
        });
        stripe.subscriptions.cancel.mockRejectedValue(new Error("Stripe cancel failed"));

        await expect(
          service.createOrUpdateSubscription({
            organizationId: "org_123",
            baseUrl: "https://app.test",
            plan: PlanTypes.FREE,
            customerId: "cus_123",
          }),
        ).rejects.toThrow("Stripe cancel failed");

        expect(repository.updateStatus).not.toHaveBeenCalled();
      });
    });
  });

  describe("createBillingPortalSession()", () => {
    describe("when called with valid customer and base URL", () => {
      /** @scenario EESubscriptionService creates billing portal session */
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
        repository.tryFindLastNonCancelled.mockResolvedValue(mockSub);

        const result = await service.getLastNonCancelledSubscription("org_123");

        expect(result).toEqual(mockSub);
        expect(repository.tryFindLastNonCancelled).toHaveBeenCalledWith("org_123");
      });
    });
  });

  describe("notifyProspective()", () => {
    describe("when organization exists", () => {
      /** @scenario EESubscriptionService notifies for prospective subscription */
      it("dispatches prospective notification", async () => {
        organizationRepository.tryFindName.mockResolvedValue({
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
        expect(mockSendSlackSubscriptionEvent).toHaveBeenCalledWith({
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
      it("raises organization_not_found", async () => {
        organizationRepository.tryFindName.mockResolvedValue(null);

        await expect(
          service.notifyProspective({
            organizationId: "org_missing",
            plan: PlanTypes.LAUNCH,
            actorEmail: "actor@example.com",
          }),
        ).rejects.toMatchObject({ code: "organization_not_found" });
      });
    });
  });

  describe("createSubscriptionWithInvites()", () => {
    describe("when seatEventFns is not configured", () => {
      it("raises seat_billing_unavailable", async () => {
        await expect(
          service.createSubscriptionWithInvites({
            organizationId: "org_123",
            baseUrl: "https://app.test",
            membersToAdd: 3,
            customerId: "cus_123",
            invites: [{ email: "alice@example.com", role: "MEMBER" as any }],
          }),
        ).rejects.toMatchObject({ code: "seat_billing_unavailable" });
      });
    });

    describe("when seatEventFns is configured", () => {
      it("creates seat event checkout with mapped invites", async () => {
        const seatEventService = createMockSeatEventService();
        const svcWithSeats = createServiceWithSeatEventFns({
          repository,
          stripe,
          itemCalculator,
          organizationRepository,
          seatEventService,
        });

        organizationRepository.tryFindFirstTeamId.mockResolvedValue("team_1");
        organizationRepository.tryGetPricingModel.mockResolvedValue("SEAT_EVENT");
        (seatEventService.createSeatEventCheckout as ReturnType<typeof vi.fn>).mockResolvedValue({
          url: "https://checkout.stripe.com/seat-session",
        });

        const result = await svcWithSeats.createSubscriptionWithInvites({
          organizationId: "org_123",
          baseUrl: "https://app.test",
          membersToAdd: 2,
          customerId: "cus_123",
          invites: [
            { email: "alice@example.com", role: "MEMBER" as any },
            { email: "bob@example.com", role: "ADMIN" as any },
          ],
        });

        expect(result.url).toBe("https://checkout.stripe.com/seat-session");
        expect(seatEventService.createSeatEventCheckout).toHaveBeenCalledWith(
          expect.objectContaining({
            organizationId: "org_123",
            customerId: "cus_123",
            membersToAdd: 2,
            invites: [
              { email: "alice@example.com", role: "MEMBER", teamIds: "team_1" },
              { email: "bob@example.com", role: "ADMIN", teamIds: "team_1" },
            ],
          }),
        );
      });
    });
  });

  describe("previewProration()", () => {
    describe("when seatEventFns is not configured", () => {
      it("raises seat_billing_unavailable", async () => {
        await expect(
          service.previewProration({
            organizationId: "org_123",
            newTotalSeats: 5,
          }),
        ).rejects.toMatchObject({ code: "seat_billing_unavailable" });
      });
    });

    describe("when seatEventFns is configured", () => {
      it("delegates to seatEventFns.previewProration", async () => {
        const seatEventService = createMockSeatEventService();
        const svcWithSeats = createServiceWithSeatEventFns({
          repository,
          stripe,
          itemCalculator,
          organizationRepository,
          seatEventService,
        });

        const mockResult = {
          formattedAmountDue: "$10.00",
          formattedRecurringTotal: "$50.00",
          billingInterval: "month",
        };
        (seatEventService.previewProration as ReturnType<typeof vi.fn>).mockResolvedValue(
          mockResult,
        );

        const result = await svcWithSeats.previewProration({
          organizationId: "org_123",
          newTotalSeats: 5,
        });

        expect(result).toEqual(mockResult);
        expect(seatEventService.previewProration).toHaveBeenCalledWith({
          organizationId: "org_123",
          newTotalSeats: 5,
        });
      });
    });
  });

  describe("listInvoices()", () => {
    describe("when organization has no stripeCustomerId", () => {
      it("returns an empty array", async () => {
        organizationRepository.tryGetStripeCustomerId.mockResolvedValue(null);

        const result = await service.listInvoices({
          organizationId: "org_no_stripe",
        });

        expect(result).toEqual([]);
        expect(stripe.invoices.list).not.toHaveBeenCalled();
      });
    });

    describe("when organization is not found", () => {
      it("returns an empty array", async () => {
        organizationRepository.tryGetStripeCustomerId.mockResolvedValue(null);

        const result = await service.listInvoices({
          organizationId: "org_missing",
        });

        expect(result).toEqual([]);
      });
    });

    describe("when the provider rate-limits the invoice list", () => {
      it("fails with a retryable provider-unavailable error", async () => {
        organizationRepository.tryGetStripeCustomerId.mockResolvedValue("cus_123");
        stripe.invoices.list.mockRejectedValue(
          new Stripe.errors.StripeRateLimitError({
            message: "slow down",
            type: "rate_limit_error",
          }),
        );

        await expect(
          service.listInvoices({ organizationId: "org_with_stripe" }),
        ).rejects.toMatchObject({ code: "billing_provider_unavailable" });
      });
    });

    describe("when the provider is unreachable for the invoice list", () => {
      it("fails with the same retryable provider-unavailable error", async () => {
        organizationRepository.tryGetStripeCustomerId.mockResolvedValue("cus_123");
        stripe.invoices.list.mockRejectedValue(
          new Stripe.errors.StripeConnectionError({
            message: "network down",
            type: "api_error",
          }),
        );

        await expect(
          service.listInvoices({ organizationId: "org_with_stripe" }),
        ).rejects.toMatchObject({ code: "billing_provider_unavailable" });
      });
    });

    describe("when the invoice list fails for a reason we cannot name", () => {
      it("lets the original error through rather than dressing it as handled", async () => {
        const providerError = new Error("No such customer");
        organizationRepository.tryGetStripeCustomerId.mockResolvedValue("cus_123");
        stripe.invoices.list.mockRejectedValue(providerError);

        const error = await service
          .listInvoices({ organizationId: "org_with_stripe" })
          .catch((caught: unknown) => caught);

        expect(error).toBe(providerError);
        expect(error).not.toHaveProperty("isHandled");
      });
    });

    describe("when organization has a stripeCustomerId", () => {
      it("returns mapped invoices excluding drafts", async () => {
        organizationRepository.tryGetStripeCustomerId.mockResolvedValue("cus_123");

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
              id: "inv_draft",
              number: null,
              created: 1700001000,
              amount_due: 3000,
              currency: "eur",
              status: "draft",
              invoice_pdf: null,
              hosted_invoice_url: null,
            },
          ],
        });

        const result = await service.listInvoices({
          organizationId: "org_with_stripe",
        });

        expect(stripe.invoices.list).toHaveBeenCalledWith({
          customer: "cus_123",
          limit: RECENT_INVOICES_LIMIT,
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
        ]);
      });
    });
  });
});
