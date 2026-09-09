import { describe, expect, it, vi } from "vitest";

import { UsageWarningService } from "../usage-warning.service.ts";
import type { UsageWarningServiceOptions } from "../../rules/usage-warning-thresholds.rules.ts";

const ORG = {
  id: "org-1",
  name: "Acme Corp",
  sentPlanLimitAlert: null,
  pricingModel: "TIERED" as const,
  currency: "USD" as const,
  members: [{ user: { id: "user-1", name: "Priya", email: "priya@acme.example" } }],
};

function baseOptions() {
  return {
    records: {
      listRecentByOrganization: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: "notif-1" }),
    },
    organizations: {
      findWithAdmins: vi.fn().mockResolvedValue(ORG),
      updateSentPlanLimitAlert: vi.fn().mockResolvedValue(undefined),
      findProjectsWithName: vi.fn().mockResolvedValue([{ id: "project-1", name: "Support" }]),
    },
    usageCounts: {
      getCountByProjects: vi.fn().mockResolvedValue([{ projectId: "project-1", count: 10 }]),
    },
    emails: { sendUsageLimitEmail: vi.fn().mockResolvedValue(undefined) },
    baseHost: "https://app.langwatch.ai",
  };
}

describe("UsageWarningService", () => {
  describe("when a next-step resolver and a usage-unit resolver are composed", () => {
    /** @scenario "The usage warning carries the organization's own next step and meter" */
    it("passes the resolved plan and unit through to the mail", async () => {
      const nextStep = {
        resolve: vi.fn().mockResolvedValue({
          kind: "self_serve" as const,
          name: "Accelerate",
          url: "https://app.langwatch.ai/settings/subscription/checkout/accelerate",
          price: 199,
          currency: "USD",
          billingPeriod: "monthly" as const,
          pricedPerSeat: false,
          raisesLimitTo: 5_000_000,
        }),
      };
      const usageUnit = vi.fn().mockResolvedValue("events" as const);
      const options = baseOptions();
      const service = UsageWarningService.create({
        ...options,
        nextStep,
        usageUnit,
      } as unknown as UsageWarningServiceOptions);

      await service.tryCheckAndSendWarning({
        organizationId: "org-1",
        currentMonthMessagesCount: 800,
        maxMonthlyUsageLimit: 1000,
      });

      expect(nextStep.resolve).toHaveBeenCalledWith({
        organizationId: "org-1",
        pricingModel: "TIERED",
        currency: "USD",
      });
      const sent = options.emails.sendUsageLimitEmail.mock.calls[0]?.[0];
      expect(sent.usageData.nextStep).toEqual({
        kind: "self_serve",
        name: "Accelerate",
        url: "https://app.langwatch.ai/settings/subscription/checkout/accelerate",
        price: 199,
        currency: "USD",
        billingPeriod: "monthly",
        pricedPerSeat: false,
        raisesLimitTo: 5_000_000,
      });
      expect(sent.usageData.usageUnit).toBe("events");
    });
  });

  describe("when the next-step resolver throws", () => {
    /** @scenario "A usage warning omits the next step it cannot resolve" */
    it("still sends the warning, without a next step", async () => {
      const nextStep = { resolve: vi.fn().mockRejectedValue(new Error("catalogue unavailable")) };
      const options = baseOptions();
      const service = UsageWarningService.create({
        ...options,
        nextStep,
      } as unknown as UsageWarningServiceOptions);

      await service.tryCheckAndSendWarning({
        organizationId: "org-1",
        currentMonthMessagesCount: 800,
        maxMonthlyUsageLimit: 1000,
      });

      const sent = options.emails.sendUsageLimitEmail.mock.calls[0]?.[0];
      expect(sent.usageData.nextStep).toBeUndefined();
    });
  });
});
