import { describe, expect, it, vi } from "vitest";
import {
  BillingPriceCatalogue,
  PlanTypes,
  SubscriptionStatus,
} from "@langwatch/enterprise-billing-contract";
import {
  BillingSubscriptionService,
  SubscriptionItemCalculatorService,
} from "../index";

const repository = () => ({
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

const service = (repo: ReturnType<typeof repository>, stripe: any = {}) =>
  BillingSubscriptionService.create({
    repository: repo,
    organizationRepository: {
      tryGetPricingModel: vi.fn().mockResolvedValue("TIERED"),
      tryGetStripeCustomerId: vi.fn(),
      tryFindName: vi.fn().mockResolvedValue({ id: "org_1", name: "Acme" }),
      tryFindFirstTeamId: vi.fn().mockResolvedValue(null),
    },
    stripe,
    itemCalculator: SubscriptionItemCalculatorService.create(
      BillingPriceCatalogue.create("test").prices,
    ),
    notifier: { send: vi.fn().mockResolvedValue(undefined) },
  });

describe("BillingSubscriptionService", () => {
  it("returns false when no subscription is present", async () => {
    const repo = repository();
    repo.tryFindLastNonCancelled.mockResolvedValue(null);
    await expect(
      service(repo).updateSubscriptionItems({
        organizationId: "org_1",
        plan: PlanTypes.LAUNCH,
        upgradeMembers: true,
        upgradeTraces: true,
        totalMembers: 2,
        totalTraces: 0,
      }),
    ).resolves.toEqual({ success: false });
  });

  it("cancels an active subscription when selecting free", async () => {
    const repo = repository();
    repo.tryFindLastNonCancelled.mockResolvedValue({
      id: "sub_1",
      status: SubscriptionStatus.ACTIVE,
      stripeSubscriptionId: "stripe_sub_1",
    });
    const stripe = {
      subscriptions: { cancel: vi.fn().mockResolvedValue({ status: "canceled" }) },
    };
    await expect(
      service(repo, stripe).createOrUpdateSubscription({
        organizationId: "org_1",
        baseUrl: "https://app.test",
        plan: PlanTypes.FREE,
        customerId: "cus_1",
      }),
    ).resolves.toEqual({ url: "https://app.test/settings/subscription" });
    expect(repo.updateStatus).toHaveBeenCalledWith({
      id: "sub_1",
      status: SubscriptionStatus.CANCELLED,
    });
  });
});
