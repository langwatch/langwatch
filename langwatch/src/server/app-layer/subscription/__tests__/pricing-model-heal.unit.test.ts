import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { TtlCache } from "../../../utils/ttlCache";
import { createPricingModelSelfHeal } from "../pricing-model-heal";

describe("createPricingModelSelfHeal()", () => {
  let hasActiveSeatEventSubscription: Mock<(organizationId: string) => Promise<boolean>>;
  let getPricingModel: Mock<(organizationId: string) => Promise<string | null>>;
  let setPricingModel: Mock<
    (params: {
      organizationId: string;
      pricingModel: "SEAT_EVENT";
    }) => Promise<void>
  >;
  let invalidateMeterDecision: Mock<(organizationId: string) => Promise<void>>;
  let guard: TtlCache<true>;

  function makeHeal() {
    return createPricingModelSelfHeal({
      hasActiveSeatEventSubscription,
      getPricingModel,
      setPricingModel,
      invalidateMeterDecision,
      guard,
    });
  }

  beforeEach(() => {
    hasActiveSeatEventSubscription = vi.fn().mockResolvedValue(true);
    getPricingModel = vi.fn().mockResolvedValue("TIERED");
    setPricingModel = vi.fn().mockResolvedValue(undefined);
    invalidateMeterDecision = vi.fn().mockResolvedValue(undefined);
    guard = new TtlCache<true>(60_000, `test:heal:${Math.random()}:`);
  });

  describe("when the column drifted against an active seat subscription", () => {
    /** @scenario Resolving a drifted organization heals the pricingModel column */
    it("updates the pricingModel to SEAT_EVENT", async () => {
      await makeHeal()({ organizationId: "org-drifted" });

      expect(setPricingModel).toHaveBeenCalledWith({
        organizationId: "org-drifted",
        pricingModel: "SEAT_EVENT",
      });
    });

    /** @scenario A heal invalidates the organization's meter decision cache */
    it("invalidates the meter decision cache after healing", async () => {
      await makeHeal()({ organizationId: "org-drifted" });

      expect(invalidateMeterDecision).toHaveBeenCalledWith("org-drifted");
    });
  });

  describe("when a heal already ran within the guard window", () => {
    /** @scenario The self-heal fires at most once per guard window */
    it("does not issue another pricingModel update", async () => {
      const heal = makeHeal();
      await heal({ organizationId: "org-drifted" });
      await heal({ organizationId: "org-drifted" });

      expect(setPricingModel).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the organization has no active seat subscription", () => {
    it("does not touch the column", async () => {
      hasActiveSeatEventSubscription.mockResolvedValue(false);

      await makeHeal()({ organizationId: "org-tiered" });

      expect(setPricingModel).not.toHaveBeenCalled();
    });
  });

  describe("when the column already says SEAT_EVENT", () => {
    it("does not write or invalidate", async () => {
      getPricingModel.mockResolvedValue("SEAT_EVENT");

      await makeHeal()({ organizationId: "org-ok" });

      expect(setPricingModel).not.toHaveBeenCalled();
      expect(invalidateMeterDecision).not.toHaveBeenCalled();
    });
  });

  describe("when a non-free license wins while an active seat subscription exists", () => {
    /** @scenario An ENTERPRISE license winning over an active subscription alerts without touching the subscription */
    it("alerts ops and mutates nothing beyond the column heal", async () => {
      const notifyLicenseSubscriptionConflict = vi
        .fn()
        .mockResolvedValue(undefined);
      const heal = createPricingModelSelfHeal({
        hasActiveSeatEventSubscription,
        getPricingModel,
        setPricingModel,
        invalidateMeterDecision,
        notifyLicenseSubscriptionConflict,
        guard,
      });

      await heal({
        organizationId: "org-conflict",
        plan: { planSource: "license", type: "ENTERPRISE", free: false },
      });

      expect(notifyLicenseSubscriptionConflict).toHaveBeenCalledWith({
        organizationId: "org-conflict",
        licensePlanType: "ENTERPRISE",
      });
    });

    it("does not alert when the winning plan is not a license", async () => {
      const notifyLicenseSubscriptionConflict = vi
        .fn()
        .mockResolvedValue(undefined);
      const heal = createPricingModelSelfHeal({
        hasActiveSeatEventSubscription,
        getPricingModel,
        setPricingModel,
        invalidateMeterDecision,
        notifyLicenseSubscriptionConflict,
        guard,
      });

      await heal({
        organizationId: "org-sub",
        plan: {
          planSource: "subscription",
          type: "GROWTH_SEAT_USD_MONTHLY",
          free: false,
        },
      });

      expect(notifyLicenseSubscriptionConflict).not.toHaveBeenCalled();
    });
  });

  describe("when a dependency throws", () => {
    it("swallows the error (fire-and-forget)", async () => {
      setPricingModel.mockRejectedValue(new Error("db down"));

      await expect(
        makeHeal()({ organizationId: "org-drifted" }),
      ).resolves.toBeUndefined();
    });
  });
});
