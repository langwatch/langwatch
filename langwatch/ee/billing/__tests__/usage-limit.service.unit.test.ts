import { beforeEach, describe, expect, it, vi } from "vitest";

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
  getApp: vi.fn(() => ({
    usage: {
      getCountByProjects: vi.fn().mockResolvedValue([]),
    },
  })),
}));

vi.mock("../../../src/server/utils/dateUtils", () => ({
  getCurrentMonthStart: vi.fn(() => new Date("2025-01-01T00:00:00.000Z")),
}));

import { env } from "../../../src/env.mjs";
import { UsageLimitService } from "../notifications/usage-limit.service";
import type { NotificationService } from "../notifications/notification.service";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockNotificationService(): NotificationService {
  return {
    sendUsageLimitEmail: vi.fn().mockResolvedValue(undefined),
    sendSlackPlanLimitAlert: vi.fn().mockResolvedValue(undefined),
    sendSlackSubscriptionEvent: vi.fn().mockResolvedValue(undefined),
    sendSlackLicensePurchase: vi.fn().mockResolvedValue(undefined),
    sendHubspotPlanLimitForm: vi.fn().mockResolvedValue(undefined),
  } as unknown as NotificationService;
}

function createMockPrisma() {
  return {
    organization: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    project: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    notification: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
        id: "notif_1",
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    },
  } as any;
}

function createMockUsageService() {
  return {
    getCountByProjects: vi.fn().mockResolvedValue([]),
    checkLimit: vi.fn(),
  } as any;
}

function createService({
  prisma = createMockPrisma(),
  usageService = createMockUsageService(),
  notificationService = createMockNotificationService(),
} = {}) {
  return {
    service: UsageLimitService.create({ prisma, usageService, notificationService }),
    prisma,
    usageService,
    notificationService,
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
        email: "jane@acme.com",
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
    describe("when IS_SAAS is false", () => {
      it("returns early without querying the database", async () => {
        const originalIsSaas = (env as any).IS_SAAS;
        (env as any).IS_SAAS = false;

        const { service, prisma } = createService();

        await service.notifyPlanLimitReached({
          organizationId: "org_1",
          planName: "free",
        });

        expect(prisma.organization.findUnique).not.toHaveBeenCalled();
        (env as any).IS_SAAS = originalIsSaas;
      });
    });

    describe("when organization is not found", () => {
      it("returns without sending notifications", async () => {
        const { service, prisma, notificationService } = createService();
        prisma.organization.findUnique.mockResolvedValue(null);

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
        const { service, prisma, notificationService } = createService();
        prisma.organization.findUnique.mockResolvedValue({
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
        const { service, prisma, notificationService } = createService();
        prisma.organization.findUnique.mockResolvedValue(ORG_WITH_ADMIN);
        prisma.organization.update.mockResolvedValue({});

        await service.notifyPlanLimitReached({
          organizationId: "org_1",
          planName: "free",
        });

        expect(notificationService.sendSlackPlanLimitAlert).toHaveBeenCalledWith(
          expect.objectContaining({
            organizationId: "org_1",
            organizationName: "Acme Corp",
            adminName: "Jane Admin",
            adminEmail: "jane@acme.com",
            planName: "free",
          }),
        );
        expect(notificationService.sendHubspotPlanLimitForm).toHaveBeenCalledWith(
          expect.objectContaining({
            organizationId: "org_1",
          }),
        );
        expect(prisma.organization.update).toHaveBeenCalledWith({
          where: { id: "org_1" },
          data: { sentPlanLimitAlert: expect.any(Date) },
        });
      });
    });

    describe("when alert was sent more than 30 days ago", () => {
      it("sends notifications again", async () => {
        const { service, prisma, notificationService } = createService();
        prisma.organization.findUnique.mockResolvedValue({
          ...ORG_WITH_ADMIN,
          sentPlanLimitAlert: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000), // 31 days ago
        });
        prisma.organization.update.mockResolvedValue({});

        await service.notifyPlanLimitReached({
          organizationId: "org_1",
          planName: "free",
        });

        expect(notificationService.sendSlackPlanLimitAlert).toHaveBeenCalled();
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
        const { service, prisma, usageService, notificationService } = createService();
        prisma.organization.findUnique.mockResolvedValue(ORG_WITH_ADMIN);
        prisma.project.findMany.mockResolvedValue([
          { id: "p1", name: "My Project" },
        ]);
        usageService.getCountByProjects.mockResolvedValue([
          { projectId: "p1", count: 5500 },
        ]);

        const result = await service.checkAndSendWarning({
          organizationId: "org_1",
          currentMonthMessagesCount: 5500,
          maxMonthlyUsageLimit: 10000,
        });

        expect(notificationService.sendUsageLimitEmail).toHaveBeenCalledWith(
          expect.objectContaining({
            to: "jane@acme.com",
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
        const { service, prisma } = createService();
        prisma.organization.findUnique.mockResolvedValue(null);

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
        const { service, prisma } = createService();
        prisma.organization.findUnique.mockResolvedValue({
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
        const { service, prisma, notificationService } = createService();
        prisma.organization.findUnique.mockResolvedValue(ORG_WITH_ADMIN);
        prisma.notification.findMany.mockResolvedValue([
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
        const { service, prisma, usageService, notificationService } = createService();
        prisma.organization.findUnique.mockResolvedValue(ORG_WITH_ADMIN);
        prisma.project.findMany.mockResolvedValue([]);
        usageService.getCountByProjects.mockResolvedValue([]);
        (notificationService.sendUsageLimitEmail as ReturnType<typeof vi.fn>)
          .mockRejectedValue(new Error("SMTP failure"));

        await expect(
          service.checkAndSendWarning({
            organizationId: "org_1",
            currentMonthMessagesCount: 9500,
            maxMonthlyUsageLimit: 10000,
          }),
        ).rejects.toThrow("All 1 usage limit warning emails failed to send");

        expect(prisma.notification.create).not.toHaveBeenCalled();
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
        const { service, prisma, notificationService } = createService();
        prisma.organization.findUnique.mockResolvedValue({
          ...ORG_WITH_ADMIN,
          members: [
            {
              role: "ADMIN",
              user: { id: "user_no_email", name: "No Email Admin", email: null },
            },
          ],
        });
        prisma.project.findMany.mockResolvedValue([]);

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
