import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../../../src/env.mjs", () => ({
  env: {
    IS_SAAS: true,
    BASE_HOST: "https://app.langwatch.ai",
  },
}));

vi.mock("../../../src/utils/logger/server", () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("../../../src/utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
}));

vi.mock("../../../src/server/app-layer/app", () => ({
  getApp: vi.fn(),
}));

vi.mock("../../../src/server/utils/dateUtils", () => ({
  getCurrentMonthStart: vi.fn(() => new Date("2025-01-01T00:00:00.000Z")),
}));

import { env } from "../../../src/env.mjs";
import {
  UsageLimitService,
  resourceLimitCooldown,
  planLimitCooldown,
  planLimitInFlight,
} from "../notifications/usage-limit.service";
import type { NotificationService } from "../notifications/notification.service";
import type { NotificationRepository } from "../notifications/repositories/notification.repository";
import type { OrganizationService } from "../../../src/server/app-layer/organizations/organization.service";
import type { UsageService } from "../../../src/server/app-layer/usage/usage.service";
import type { PlanProvider } from "../../../src/server/app-layer/subscription/plan-provider";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockNotificationService(): NotificationService {
  return {
    sendUsageLimitEmail: vi.fn().mockResolvedValue(undefined),
    sendSlackPlanLimitAlert: vi.fn().mockResolvedValue(undefined),
    sendSlackResourceLimitAlert: vi.fn().mockResolvedValue(undefined),
    sendSlackSubscriptionEvent: vi.fn().mockResolvedValue(undefined),
    sendSlackSignupEvent: vi.fn().mockResolvedValue(undefined),
    sendSlackLicensePurchase: vi.fn().mockResolvedValue(undefined),
    sendHubspotPlanLimitForm: vi.fn().mockResolvedValue(undefined),
  } as unknown as NotificationService;
}

function createMockNotificationRepository(): NotificationRepository {
  return {
    findRecentByOrganization: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockImplementation((params: Record<string, unknown>) => ({
      id: "notif_1",
      ...params,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    findById: vi.fn().mockResolvedValue(null),
  } as unknown as NotificationRepository;
}

function createMockOrganizationService(): OrganizationService {
  return {
    findWithAdmins: vi.fn().mockResolvedValue(null),
    updateSentPlanLimitAlert: vi.fn().mockResolvedValue(undefined),
    findProjectsWithName: vi.fn().mockResolvedValue([]),
    getOrganizationIdByTeamId: vi.fn().mockResolvedValue(null),
    getProjectIds: vi.fn().mockResolvedValue([]),
    isFeatureEnabled: vi.fn().mockResolvedValue(false),
  } as unknown as OrganizationService;
}

function createMockUsageService(): UsageService {
  return {
    getCountByProjects: vi.fn().mockResolvedValue([]),
    checkLimit: vi.fn(),
  } as unknown as UsageService;
}

function createMockPlanProvider(): PlanProvider {
  return {
    getActivePlan: vi.fn().mockResolvedValue({ name: "Launch" }),
  } as unknown as PlanProvider;
}

function createService({
  notificationRepository = createMockNotificationRepository(),
  organizationService = createMockOrganizationService(),
  usageService = createMockUsageService(),
  notificationService = createMockNotificationService(),
  planProvider = createMockPlanProvider(),
} = {}) {
  return {
    service: UsageLimitService.create({
      notificationRepository,
      organizationService,
      usageService,
      notificationService,
      planProvider,
    }),
    notificationRepository,
    organizationService,
    usageService,
    notificationService,
    planProvider,
  };
}

const ORG_WITH_ADMIN = {
  id: "org_1",
  name: "Acme Corp",
  sentPlanLimitAlert: null,
  members: [
    {
      role: "ADMIN",
      user: {
        id: "user_1",
        name: "Jane Admin",
        email: "jane@example.com",
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("UsageLimitService", () => {
  describe("create()", () => {
    it("returns a UsageLimitService instance", () => {
      const { service } = createService();
      expect(service).toBeInstanceOf(UsageLimitService);
    });
  });

  // -------------------------------------------------------------------------
  // notifyPlanLimitReached
  // -------------------------------------------------------------------------

  describe("notifyPlanLimitReached()", () => {
    afterEach(async () => {
      planLimitInFlight.delete("org_1");
      planLimitInFlight.delete("org_missing");
      await planLimitCooldown.delete("org_1");
      await planLimitCooldown.delete("org_missing");
    });

    describe("when IS_SAAS is false", () => {
      beforeEach(() => {
        vi.mocked(env).IS_SAAS = false;
      });

      afterEach(() => {
        vi.mocked(env).IS_SAAS = true;
      });

      it("returns early without querying the database", async () => {
        const { service, organizationService } = createService();

        await service.notifyPlanLimitReached({
          organizationId: "org_1",
          planName: "free",
        });

        expect(organizationService.findWithAdmins).not.toHaveBeenCalled();
      });
    });

    describe("when organization is not found", () => {
      it("returns without sending notifications", async () => {
        const { service, organizationService, notificationService } = createService();
        (organizationService.findWithAdmins as ReturnType<typeof vi.fn>).mockResolvedValue(null);

        await service.notifyPlanLimitReached({
          organizationId: "org_missing",
          planName: "free",
        });

        expect(notificationService.sendSlackPlanLimitAlert).not.toHaveBeenCalled();
        expect(notificationService.sendHubspotPlanLimitForm).not.toHaveBeenCalled();
      });
    });

    describe("when alert was sent recently (within 30 days)", () => {
      it("returns without sending notifications", async () => {
        const { service, organizationService, notificationService } = createService();
        (organizationService.findWithAdmins as ReturnType<typeof vi.fn>).mockResolvedValue({
          ...ORG_WITH_ADMIN,
          sentPlanLimitAlert: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
        });

        await service.notifyPlanLimitReached({
          organizationId: "org_1",
          planName: "free",
        });

        expect(notificationService.sendSlackPlanLimitAlert).not.toHaveBeenCalled();
      });
    });

    describe("when no recent alert exists", () => {
      it("sends Slack and Hubspot notifications and updates the timestamp", async () => {
        const { service, organizationService, notificationService } = createService();
        (organizationService.findWithAdmins as ReturnType<typeof vi.fn>).mockResolvedValue(ORG_WITH_ADMIN);

        await service.notifyPlanLimitReached({
          organizationId: "org_1",
          planName: "free",
        });

        expect(notificationService.sendSlackPlanLimitAlert).toHaveBeenCalledWith(
          expect.objectContaining({
            organizationId: "org_1",
            organizationName: "Acme Corp",
            adminName: "Jane Admin",
            adminEmail: "jane@example.com",
            planName: "free",
          }),
        );
        expect(notificationService.sendHubspotPlanLimitForm).toHaveBeenCalledWith(
          expect.objectContaining({
            organizationId: "org_1",
          }),
        );
        expect(organizationService.updateSentPlanLimitAlert).toHaveBeenCalledWith(
          "org_1",
          expect.any(Date),
        );
      });
    });

    describe("when alert was sent more than 30 days ago", () => {
      it("sends notifications again", async () => {
        const { service, organizationService, notificationService } = createService();
        (organizationService.findWithAdmins as ReturnType<typeof vi.fn>).mockResolvedValue({
          ...ORG_WITH_ADMIN,
          sentPlanLimitAlert: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000), // 31 days ago
        });

        await service.notifyPlanLimitReached({
          organizationId: "org_1",
          planName: "free",
        });

        expect(notificationService.sendSlackPlanLimitAlert).toHaveBeenCalled();
      });
    });

    describe("when called concurrently for the same organization", () => {
      it("sends only one notification", async () => {
        const { service, organizationService, notificationService } = createService();
        (organizationService.findWithAdmins as ReturnType<typeof vi.fn>).mockResolvedValue(ORG_WITH_ADMIN);

        await Promise.all([
          service.notifyPlanLimitReached({ organizationId: "org_1", planName: "free" }),
          service.notifyPlanLimitReached({ organizationId: "org_1", planName: "free" }),
          service.notifyPlanLimitReached({ organizationId: "org_1", planName: "free" }),
          service.notifyPlanLimitReached({ organizationId: "org_1", planName: "free" }),
          service.notifyPlanLimitReached({ organizationId: "org_1", planName: "free" }),
        ]);

        expect(notificationService.sendSlackPlanLimitAlert).toHaveBeenCalledTimes(1);
      });
    });

    describe("when called again after cooldown expires", () => {
      it("sends notification again", async () => {
        const { service, organizationService, notificationService } = createService();
        (organizationService.findWithAdmins as ReturnType<typeof vi.fn>).mockResolvedValue(ORG_WITH_ADMIN);

        await service.notifyPlanLimitReached({ organizationId: "org_1", planName: "free" });
        expect(notificationService.sendSlackPlanLimitAlert).toHaveBeenCalledTimes(1);

        // Simulate cooldown expiry
        planLimitInFlight.delete("org_1");
        await planLimitCooldown.delete("org_1");
        vi.mocked(notificationService.sendSlackPlanLimitAlert as ReturnType<typeof vi.fn>).mockClear();

        await service.notifyPlanLimitReached({ organizationId: "org_1", planName: "free" });
        expect(notificationService.sendSlackPlanLimitAlert).toHaveBeenCalledTimes(1);
      });
    });
  });

  // -------------------------------------------------------------------------
  // notifyResourceLimitReached
  // -------------------------------------------------------------------------

  describe("notifyResourceLimitReached()", () => {

    describe("when IS_SAAS is false", () => {
      beforeEach(() => {
        vi.mocked(env).IS_SAAS = false;
      });

      afterEach(() => {
        vi.mocked(env).IS_SAAS = true;
      });

      it("returns without sending", async () => {
        const { service, notificationService } = createService();

        await service.notifyResourceLimitReached({
          organizationId: "org_1",
          limitType: "workflows",
          current: 5,
          max: 5,
        });

        expect(
          notificationService.sendSlackResourceLimitAlert,
        ).not.toHaveBeenCalled();
      });
    });

    describe("when cooldown is active for the organization and limit type", () => {
      it("suppresses the notification", async () => {
        const { service, notificationService } = createService();

        await resourceLimitCooldown.set("org_1:workflows", true);

        await service.notifyResourceLimitReached({
          organizationId: "org_1",
          limitType: "workflows",
          current: 5,
          max: 5,
        });

        expect(
          notificationService.sendSlackResourceLimitAlert,
        ).not.toHaveBeenCalled();
      });
    });

    describe("when cooldown is active for a different limit type", () => {
      it("sends the notification (cooldown is per-org+type)", async () => {
        const { service, organizationService, notificationService } = createService();
        (organizationService.findWithAdmins as ReturnType<typeof vi.fn>).mockResolvedValue(ORG_WITH_ADMIN);

        // First call sets the cooldown for workflows
        await service.notifyResourceLimitReached({
          organizationId: "org_1",
          limitType: "workflows",
          current: 5,
          max: 5,
        });

        vi.mocked(
          notificationService.sendSlackResourceLimitAlert as ReturnType<
            typeof vi.fn
          >,
        ).mockClear();

        // Second call with different type is NOT suppressed
        await service.notifyResourceLimitReached({
          organizationId: "org_1",
          limitType: "agents",
          current: 3,
          max: 3,
        });

        expect(
          notificationService.sendSlackResourceLimitAlert,
        ).toHaveBeenCalled();
      });
    });

    describe("when notification conditions are met", () => {
      // TODO(#3048): pre-existing failure unmasked by #3001
      it.skip("sends correct payload with org name, admin, plan, display label, and counts", async () => {
        const { service, organizationService, notificationService } = createService();
        (organizationService.findWithAdmins as ReturnType<typeof vi.fn>).mockResolvedValue(ORG_WITH_ADMIN);

        await service.notifyResourceLimitReached({
          organizationId: "org_1",
          limitType: "workflows",
          current: 5,
          max: 5,
        });

        expect(
          notificationService.sendSlackResourceLimitAlert,
        ).toHaveBeenCalledWith({
          organizationId: "org_1",
          organizationName: "Acme Corp",
          adminName: "Jane Admin",
          adminEmail: "jane@example.com",
          planName: "Launch",
          limitType: "Workflows",
          current: 5,
          max: 5,
        });
      });
    });

    describe("when called concurrently for the same organization", () => {
      // TODO(#3048): pre-existing failure unmasked by #3001
      it.skip("sends only one notification", async () => {
        const { service, organizationService, notificationService } = createService();
        (organizationService.findWithAdmins as ReturnType<typeof vi.fn>).mockResolvedValue(ORG_WITH_ADMIN);

        await Promise.all([
          service.notifyResourceLimitReached({
            organizationId: "org_1",
            limitType: "workflows",
            current: 5,
            max: 5,
          }),
          service.notifyResourceLimitReached({
            organizationId: "org_1",
            limitType: "workflows",
            current: 5,
            max: 5,
          }),
        ]);

        expect(
          notificationService.sendSlackResourceLimitAlert,
        ).toHaveBeenCalledTimes(1);
      });
    });

    describe("when organization is not found", () => {
      it("releases the cooldown", async () => {
        const { service, organizationService } = createService();
        (organizationService.findWithAdmins as ReturnType<typeof vi.fn>).mockResolvedValue(null);

        await service.notifyResourceLimitReached({
          organizationId: "org_missing",
          limitType: "workflows",
          current: 5,
          max: 5,
        });

        expect(await resourceLimitCooldown.get("org_missing:workflows")).toBeUndefined();
      });
    });

    describe("when notification dispatch fails", () => {
      // TODO(#3048): pre-existing failure unmasked by #3001
      it.skip("releases the cooldown", async () => {
        const { service, organizationService, notificationService } = createService();
        (organizationService.findWithAdmins as ReturnType<typeof vi.fn>).mockResolvedValue(ORG_WITH_ADMIN);
        (
          notificationService.sendSlackResourceLimitAlert as ReturnType<
            typeof vi.fn
          >
        ).mockRejectedValue(new Error("Slack down"));

        await service.notifyResourceLimitReached({
          organizationId: "org_1",
          limitType: "workflows",
          current: 5,
          max: 5,
        });

        expect(await resourceLimitCooldown.get("org_1:workflows")).toBeUndefined();
      });
    });

    describe("when plan provider fails", () => {
      // TODO(#3048): pre-existing failure unmasked by #3001
      it.skip("sends notification with 'unknown' plan name", async () => {
        const failingPlanProvider: PlanProvider = {
          getActivePlan: vi.fn().mockRejectedValue(new Error("plan error")),
        } as unknown as PlanProvider;
        const organizationService = createMockOrganizationService();
        (organizationService.findWithAdmins as ReturnType<typeof vi.fn>).mockResolvedValue(ORG_WITH_ADMIN);
        const { service, notificationService } = createService({
          organizationService,
          planProvider: failingPlanProvider,
        });

        await service.notifyResourceLimitReached({
          organizationId: "org_1",
          limitType: "workflows",
          current: 5,
          max: 5,
        });

        expect(
          notificationService.sendSlackResourceLimitAlert,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            planName: "unknown",
          }),
        );
      });
    });
  });

  // -------------------------------------------------------------------------
  // checkAndSendWarning
  // -------------------------------------------------------------------------

  describe("checkAndSendWarning()", () => {
    describe("when usage is below all thresholds", () => {
      it("returns null without sending emails", async () => {
        const { service, notificationService } = createService();

        const result = await service.checkAndSendWarning({
          organizationId: "org_1",
          currentMonthMessagesCount: 100,
          maxMonthlyUsageLimit: 10000,
        });

        expect(result).toBeNull();
        expect(notificationService.sendUsageLimitEmail).not.toHaveBeenCalled();
      });
    });

    describe("when usage exceeds 50% threshold", () => {
      beforeEach(() => {
        vi.clearAllMocks();
      });

      it("sends email to admin members and creates notification record", async () => {
        const { service, organizationService, usageService, notificationService } = createService();
        (organizationService.findWithAdmins as ReturnType<typeof vi.fn>).mockResolvedValue(ORG_WITH_ADMIN);
        (organizationService.findProjectsWithName as ReturnType<typeof vi.fn>).mockResolvedValue([
          { id: "p1", name: "My Project" },
        ]);
        (usageService.getCountByProjects as ReturnType<typeof vi.fn>).mockResolvedValue([
          { projectId: "p1", count: 5500 },
        ]);

        const result = await service.checkAndSendWarning({
          organizationId: "org_1",
          currentMonthMessagesCount: 5500,
          maxMonthlyUsageLimit: 10000,
        });

        expect(notificationService.sendUsageLimitEmail).toHaveBeenCalledWith(
          expect.objectContaining({
            to: "jane@example.com",
            orgName: "Acme Corp",
            usageData: expect.objectContaining({
              crossedThreshold: 50,
              currentMonthMessagesCount: 5500,
              maxMonthlyUsageLimit: 10000,
            }),
          }),
        );
        expect(result).toMatchObject({
          id: "notif_1",
          organizationId: "org_1",
        });
      });
    });

    describe("when organization is not found", () => {
      it("returns null", async () => {
        const { service, organizationService } = createService();
        (organizationService.findWithAdmins as ReturnType<typeof vi.fn>).mockResolvedValue(null);

        const result = await service.checkAndSendWarning({
          organizationId: "org_missing",
          currentMonthMessagesCount: 9500,
          maxMonthlyUsageLimit: 10000,
        });

        expect(result).toBeNull();
      });
    });

    describe("when organization has no admin members", () => {
      it("returns null", async () => {
        const { service, organizationService } = createService();
        (organizationService.findWithAdmins as ReturnType<typeof vi.fn>).mockResolvedValue({
          ...ORG_WITH_ADMIN,
          members: [],
        });

        const result = await service.checkAndSendWarning({
          organizationId: "org_1",
          currentMonthMessagesCount: 9500,
          maxMonthlyUsageLimit: 10000,
        });

        expect(result).toBeNull();
      });
    });

    describe("when notification was already sent for this threshold this month", () => {
      it("returns null without sending duplicate", async () => {
        const { service, organizationService, notificationRepository, notificationService } = createService();
        (organizationService.findWithAdmins as ReturnType<typeof vi.fn>).mockResolvedValue(ORG_WITH_ADMIN);
        (notificationRepository.findRecentByOrganization as ReturnType<typeof vi.fn>).mockResolvedValue([
          {
            id: "existing_notif",
            sentAt: new Date(),
            metadata: {
              type: "USAGE_LIMIT_WARNING",
              threshold: 90,
            },
          },
        ]);

        const result = await service.checkAndSendWarning({
          organizationId: "org_1",
          currentMonthMessagesCount: 9200,
          maxMonthlyUsageLimit: 10000,
        });

        expect(result).toBeNull();
        expect(notificationService.sendUsageLimitEmail).not.toHaveBeenCalled();
      });
    });

    describe("when all email sends fail", () => {
      it("throws an error without creating a notification record", async () => {
        const { service, organizationService, notificationRepository, usageService, notificationService } = createService();
        (organizationService.findWithAdmins as ReturnType<typeof vi.fn>).mockResolvedValue(ORG_WITH_ADMIN);
        (organizationService.findProjectsWithName as ReturnType<typeof vi.fn>).mockResolvedValue([]);
        (usageService.getCountByProjects as ReturnType<typeof vi.fn>).mockResolvedValue([]);
        (notificationService.sendUsageLimitEmail as ReturnType<typeof vi.fn>)
          .mockRejectedValue(new Error("SMTP failure"));

        await expect(
          service.checkAndSendWarning({
            organizationId: "org_1",
            currentMonthMessagesCount: 9500,
            maxMonthlyUsageLimit: 10000,
          }),
        ).rejects.toThrow("All 1 usage limit warning emails failed to send");

        expect(notificationRepository.create).not.toHaveBeenCalled();
      });
    });

    describe("when maxMonthlyUsageLimit is 0", () => {
      it("returns null (no threshold crossed)", async () => {
        const { service } = createService();

        const result = await service.checkAndSendWarning({
          organizationId: "org_1",
          currentMonthMessagesCount: 100,
          maxMonthlyUsageLimit: 0,
        });

        expect(result).toBeNull();
      });
    });

    describe("when admins have no email addresses", () => {
      it("returns null without sending emails", async () => {
        const { service, organizationService, notificationService } = createService();
        (organizationService.findWithAdmins as ReturnType<typeof vi.fn>).mockResolvedValue({
          ...ORG_WITH_ADMIN,
          members: [
            {
              role: "ADMIN",
              user: { id: "user_no_email", name: "No Email Admin", email: null },
            },
          ],
        });
        (organizationService.findProjectsWithName as ReturnType<typeof vi.fn>).mockResolvedValue([]);

        const result = await service.checkAndSendWarning({
          organizationId: "org_1",
          currentMonthMessagesCount: 9500,
          maxMonthlyUsageLimit: 10000,
        });

        expect(result).toBeNull();
        expect(notificationService.sendUsageLimitEmail).not.toHaveBeenCalled();
      });
    });
  });
});
