/**
 * How one more seat is approved, from how the organization pays (ruling R6).
 * @see modules/organization/specs/seat-requests.feature
 */
import { describe, expect, it } from "vitest";

import {
  type SeatApprovalPlan,
  LICENSE_SETTINGS_PATH,
  SUBSCRIPTION_SETTINGS_PATH,
  seatApprovalPath,
} from "../seat-approval-path.rules.ts";

const freePlan: SeatApprovalPlan = { planSource: "free", type: "free", free: true, maxMembers: 2 };

function pathFor({
  isSaas = true,
  plan,
  pricingModel = "SEAT_EVENT",
}: {
  isSaas?: boolean;
  plan: Partial<SeatApprovalPlan>;
  pricingModel?: "TIERED" | "SEAT_EVENT" | null;
}) {
  return seatApprovalPath({
    isSaas,
    plan: { ...freePlan, ...plan },
    pricingModel,
    currency: "EUR",
    organizationName: "ACME",
  });
}

describe("seatApprovalPath", () => {
  describe("when the organization pays per seat through a live Stripe subscription", () => {
    /** @scenario "A live Stripe seat subscription approves through the seats upgrade" */
    it("expands the subscription from the current seats to one more", () => {
      const path = pathFor({
        plan: {
          planSource: "subscription",
          type: "GROWTH_SEAT_EUR_MONTHLY",
          free: false,
          maxMembers: 5,
          userPrice: { USD: 32, EUR: 29 },
        },
      });

      expect(path).toEqual({
        kind: "stripe_seats",
        currentSeats: 5,
        newSeats: 6,
        planType: "GROWTH_SEAT_EUR_MONTHLY",
        seatPrice: { amount: 29, currency: "EUR" },
      });
    });
  });

  describe("when the organization is on the free plan", () => {
    /** @scenario "A free or non-seat self-serve plan approves by upgrading the plan" */
    it("upgrades the plan from the subscription settings", () => {
      expect(pathFor({ plan: {} })).toEqual({
        kind: "upgrade_plan",
        url: SUBSCRIPTION_SETTINGS_PATH,
      });
    });

    it("upgrades the plan too for a paid tiered subscription", () => {
      const path = pathFor({
        plan: { planSource: "subscription", type: "LAUNCH", free: false },
        pricingModel: "TIERED",
      });

      expect(path.kind).toBe("upgrade_plan");
    });
  });

  describe("when the organization is on a negotiated licence on LangWatch Cloud", () => {
    /** @scenario "An account-managed cloud plan approves by contacting LangWatch" */
    it("contacts LangWatch naming the organization and one more seat", () => {
      const path = pathFor({ plan: { planSource: "license", type: "ENTERPRISE", free: false } });

      expect(path.kind).toBe("contact_sales");
      const url = new URL(path.kind === "contact_sales" ? path.url : "");
      expect(url.searchParams.get("organization")).toBe("ACME");
      expect(url.searchParams.get("seats")).toBe("3");
    });
  });

  describe("when the organization holds an Enterprise subscription billed outside Stripe", () => {
    /** @scenario "An Enterprise subscription billed outside Stripe approves by contacting LangWatch" */
    it("contacts LangWatch rather than the self-serve upgrade", () => {
      const path = pathFor({
        plan: { planSource: "subscription", type: "ENTERPRISE", free: false },
        pricingModel: "TIERED",
      });

      expect(path.kind).toBe("contact_sales");
    });
  });

  describe("when a self-hosted deployment runs on a Growth licence", () => {
    /** @scenario "A self-hosted Growth licence approves by buying more licence seats" */
    it("buys more licence seats", () => {
      const path = pathFor({ isSaas: false, plan: { planSource: "license", type: "GROWTH" } });

      expect(path).toEqual({ kind: "upgrade_licence", url: LICENSE_SETTINGS_PATH });
    });
  });

  describe("when a self-hosted deployment runs on any other licence", () => {
    /** @scenario "Any other self-hosted licence approves by contacting LangWatch" */
    it("contacts LangWatch", () => {
      const path = pathFor({ isSaas: false, plan: { planSource: "license", type: "ENTERPRISE" } });

      expect(path.kind).toBe("contact_sales");
    });
  });
});
