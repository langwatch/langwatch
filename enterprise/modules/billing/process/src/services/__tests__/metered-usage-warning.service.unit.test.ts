import { createApiFixture } from "@langwatch/api-fixture";
import type { NotificationService as NotificationApi } from "@langwatch/notification-contract";
import { OrganizationNotFoundError, type OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { describe, expect, it } from "vitest";

import type { UsageLimitEmailData } from "../billing-usage-notice.service.ts";
import { MeteredUsageWarningService } from "../metered-usage-warning.service.ts";
import { UsageLimitOrganizationService } from "../usage-limit-organization.service.ts";

const SENT_AT = new Date("2026-09-25T00:00:00Z");

function warningsFor(getWithAdministrators: OrganizationApi["getWithAdministrators"]) {
  const mails: UsageLimitEmailData[] = [];
  const service = MeteredUsageWarningService.create({
    records: createApiFixture<NotificationApi>({
      listRecentByOrganization: async () => [],
      create: async (input) => ({
        id: "notification-1",
        organizationId: input.organizationId,
        projectId: null,
        metadata: input.metadata,
        createdAt: SENT_AT,
        updatedAt: SENT_AT,
        sentAt: SENT_AT,
      }),
    }),
    organizations: UsageLimitOrganizationService.create({
      organizations: createApiFixture<OrganizationApi>({ getWithAdministrators }),
      projects: createApiFixture<ProjectApi>({
        findProjectsWithDepartments: async () => [
          { id: "project-1", name: "Support", departmentId: null },
        ],
      }),
    }),
    emails: {
      sendUsageLimitEmail: async ({ usageData }) => {
        mails.push(usageData);
      },
    },
    baseHost: "https://app.langwatch.ai",
    counters: {
      traces: { getCountByProjects: async () => [{ projectId: "project-1", count: 3 }] },
      events: { getCountByProjects: async () => [{ projectId: "project-1", count: 40 }] },
    },
  });
  return { service, mails };
}

const ACME = {
  id: "org-1",
  name: "Acme",
  sentPlanLimitAlert: null,
  administrators: [{ userId: "user-1", name: "Priya", email: "priya@acme.example" }],
};
const CHECK = {
  organizationId: "org-1",
  currentMonthMessagesCount: 800,
  maxMonthlyUsageLimit: 1000,
};

describe("MeteredUsageWarningService", () => {
  describe("when the caller resolved the events meter", () => {
    /** @scenario "The usage warning lists projects in the meter the caller resolved" */
    it("lists each project's billable events and reports the send", async () => {
      const { service, mails } = warningsFor(async () => ACME);

      const result = await service.checkAndSendWarning({ ...CHECK, meter: "events" });

      expect(result).toMatchObject({ sent: true, notificationId: "notification-1" });
      expect(result.sentAt?.epochMilliseconds).toBe(SENT_AT.getTime());
      expect(mails[0]?.projectUsageData).toEqual([
        { id: "project-1", name: "Support", messageCount: 40 },
      ]);
    });
  });

  describe("when the organization no longer exists", () => {
    /** @scenario "A usage warning for an organization that no longer exists sends nothing" */
    it("sends nothing and reports it was not sent", async () => {
      const { service, mails } = warningsFor(async ({ organizationId }) => {
        throw new OrganizationNotFoundError(organizationId);
      });

      await expect(service.checkAndSendWarning({ ...CHECK, meter: "traces" })).resolves.toEqual({
        sent: false,
      });
      expect(mails).toEqual([]);
    });
  });
});
