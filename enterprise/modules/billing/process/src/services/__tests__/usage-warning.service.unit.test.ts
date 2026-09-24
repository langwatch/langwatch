import { describe, expect, it, vi } from "vitest";

import { UsageWarningService } from "../usage-warning.service.ts";

const ORG = {
  id: "org-1",
  name: "Acme Corp",
  sentPlanLimitAlert: null,
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
  describe("when usage crosses a warning threshold", () => {
    /** @scenario "The usage warning carries main's severity and usage link" */
    it("sends main's email data to every deliverable admin", async () => {
      const options = baseOptions();
      const service = UsageWarningService.create(options);

      const result = await service.checkAndSendWarning({
        organizationId: "org-1",
        currentMonthMessagesCount: 800,
        maxMonthlyUsageLimit: 1000,
      });

      expect(result.outcome).toBe("sent");
      const sent = options.emails.sendUsageLimitEmail.mock.calls[0]?.[0];
      expect(sent.to).toBe("priya@acme.example");
      expect(sent.usageData).toMatchObject({
        severity: "Medium",
        usagePercentageFormatted: "80",
        crossedThreshold: 70,
        actionUrl: "https://app.langwatch.ai/settings/usage",
        projectUsageData: [{ id: "project-1", name: "Support", messageCount: 10 }],
      });
    });
  });

  describe("when usage is below every threshold", () => {
    /** @scenario "A usage warning below every threshold sends nothing" */
    it("skips without sending or recording", async () => {
      const options = baseOptions();
      const service = UsageWarningService.create(options);

      const result = await service.checkAndSendWarning({
        organizationId: "org-1",
        currentMonthMessagesCount: 100,
        maxMonthlyUsageLimit: 1000,
      });

      expect(result.outcome).toBe("skipped");
      expect(options.emails.sendUsageLimitEmail).not.toHaveBeenCalled();
      expect(options.records.create).not.toHaveBeenCalled();
    });
  });
});
