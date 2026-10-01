import { describe, expect, it, vi } from "vitest";

import { UsageWarningService } from "../usage-warning.service.ts";

const ORG = {
  id: "org-1",
  name: "Acme Corp",
  sentPlanLimitAlert: null,
  members: [{ user: { id: "user-1", name: "Priya", email: "priya@acme.example" } }],
};

const DECISION = {
  organizationId: "org-1",
  currentMonthMessagesCount: 800,
  maxMonthlyUsageLimit: 1000,
  crossedThreshold: 70,
  projectCounts: [{ projectId: "project-1", count: 40 }],
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
      findProjectsWithName: vi.fn().mockResolvedValue([
        { id: "project-1", name: "Support" },
        { id: "project-2", name: "Sales" },
      ]),
    },
    emails: { sendUsageLimitEmail: vi.fn().mockResolvedValue(undefined) },
    baseHost: "https://app.langwatch.ai",
  };
}

describe("UsageWarningService", () => {
  describe("when entitlement decided a crossed threshold", () => {
    /** @scenario "The usage warning carries main's severity and usage link" */
    it("sends main's email data to every deliverable admin", async () => {
      const options = baseOptions();
      const service = UsageWarningService.create(options);

      const result = await service.send(DECISION);

      expect(result.outcome).toBe("sent");
      const sent = options.emails.sendUsageLimitEmail.mock.calls[0]?.[0];
      expect(sent.to).toBe("priya@acme.example");
      expect(sent.usageData).toMatchObject({
        severity: "Medium",
        usagePercentageFormatted: "80",
        crossedThreshold: 70,
        actionUrl: "https://app.langwatch.ai/settings/usage",
      });
    });

    /** @scenario "The usage warning lists each project's count as entitlement decided it" */
    it("lists each named project with the decided count and counts nothing itself", async () => {
      const options = baseOptions();
      const service = UsageWarningService.create(options);

      await service.send(DECISION);

      expect(options.emails.sendUsageLimitEmail.mock.calls[0]?.[0].usageData).toMatchObject({
        projectUsageData: [
          { id: "project-1", name: "Support", messageCount: 40 },
          { id: "project-2", name: "Sales", messageCount: 0 },
        ],
      });
    });
  });

  describe("when the threshold already went out this month", () => {
    /** @scenario "A usage warning already sent this month is not sent again" */
    it("skips without sending or recording", async () => {
      const options = baseOptions();
      options.records.listRecentByOrganization.mockResolvedValue([
        { metadata: { type: "USAGE_LIMIT_WARNING", threshold: 70 }, sentAt: new Date() },
      ]);
      const service = UsageWarningService.create(options);

      const result = await service.send(DECISION);

      expect(result.outcome).toBe("skipped");
      expect(options.emails.sendUsageLimitEmail).not.toHaveBeenCalled();
      expect(options.records.create).not.toHaveBeenCalled();
    });
  });

  describe("when the organization no longer exists", () => {
    /** @scenario "A usage warning for an organization that no longer exists sends nothing" */
    it("sends nothing and reports it was not sent", async () => {
      const options = baseOptions();
      options.organizations.findWithAdmins.mockResolvedValue(null);
      const service = UsageWarningService.create(options);

      await expect(service.send(DECISION)).resolves.toEqual({ outcome: "skipped" });
      expect(options.emails.sendUsageLimitEmail).not.toHaveBeenCalled();
    });
  });
});
