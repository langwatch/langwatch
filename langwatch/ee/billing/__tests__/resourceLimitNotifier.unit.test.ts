import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/env.mjs", () => ({
  env: {
    IS_SAAS: false,
  },
}));

vi.mock("../../../src/server/db", () => ({
  prisma: {},
}));

vi.mock("../notifications/notificationHandlers", () => ({
  notifyResourceLimitSlack: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../src/utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
}));

vi.mock("../../../src/server/app-layer/app", () => ({
  getApp: vi.fn().mockReturnValue({
    planProvider: {
      getActivePlan: vi.fn().mockResolvedValue({ name: "Launch" }),
    },
  }),
}));

import { env } from "../../../src/env.mjs";
import { createResourceLimitNotifier } from "../notifications/resourceLimitNotifier";
import { notifyResourceLimitSlack } from "../notifications/notificationHandlers";
import { captureException } from "../../../src/utils/posthogErrorCapture";

const mockEnv = env as { IS_SAAS: boolean | undefined };
const mockNotifyResourceLimitSlack = notifyResourceLimitSlack as ReturnType<
  typeof vi.fn
>;
const mockCaptureException = captureException as ReturnType<typeof vi.fn>;

const createMockDb = ({
  organization = null,
  updateFn = vi.fn(),
}: {
  organization?: unknown;
  updateFn?: ReturnType<typeof vi.fn>;
} = {}) => {
  return {
    organization: {
      findUnique: vi.fn().mockResolvedValue(organization),
      update: updateFn,
    },
  } as any;
};

const makeOrganization = ({
  sentResourceLimitAlert = null,
  adminName = "Admin",
  adminEmail = "admin@acme.com",
}: {
  sentResourceLimitAlert?: Date | null;
  adminName?: string;
  adminEmail?: string;
} = {}) => ({
  id: "org_123",
  name: "Acme",
  sentResourceLimitAlert,
  members: [
    {
      role: "ADMIN",
      user: {
        name: adminName,
        email: adminEmail,
      },
    },
  ],
});

const defaultInput = {
  organizationId: "org_123",
  limitType: "workflows" as const,
  current: 10,
  max: 10,
};

describe("createResourceLimitNotifier", () => {
  beforeEach(() => {
    mockEnv.IS_SAAS = false;
    vi.clearAllMocks();
  });

  describe("when IS_SAAS is false", () => {
    it("does nothing", async () => {
      mockEnv.IS_SAAS = false;

      const db = createMockDb();
      const notifier = createResourceLimitNotifier(db);
      await notifier(defaultInput);

      expect(db.organization.findUnique).not.toHaveBeenCalled();
      expect(mockNotifyResourceLimitSlack).not.toHaveBeenCalled();
    });
  });

  describe("when IS_SAAS is true", () => {
    beforeEach(() => {
      mockEnv.IS_SAAS = true;
    });

    describe("when org not found", () => {
      it("does nothing", async () => {
        const db = createMockDb({ organization: null });
        const notifier = createResourceLimitNotifier(db);
        await notifier({ ...defaultInput, organizationId: "org_missing" });

        expect(mockNotifyResourceLimitSlack).not.toHaveBeenCalled();
      });
    });

    describe("when alert was sent less than 24 hours ago", () => {
      it("suppresses notification", async () => {
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
        const db = createMockDb({
          organization: makeOrganization({
            sentResourceLimitAlert: twoHoursAgo,
          }),
        });

        const notifier = createResourceLimitNotifier(db);
        await notifier(defaultInput);

        expect(mockNotifyResourceLimitSlack).not.toHaveBeenCalled();
      });
    });

    describe("when alert was sent more than 24 hours ago", () => {
      it("notifies and updates timestamp", async () => {
        const thirtyHoursAgo = new Date(Date.now() - 30 * 60 * 60 * 1000);
        const updateFn = vi.fn().mockResolvedValue({});
        const db = createMockDb({
          organization: makeOrganization({
            sentResourceLimitAlert: thirtyHoursAgo,
          }),
          updateFn,
        });

        const notifier = createResourceLimitNotifier(db);
        await notifier(defaultInput);

        expect(mockNotifyResourceLimitSlack).toHaveBeenCalledWith({
          organizationId: "org_123",
          organizationName: "Acme",
          adminName: "Admin",
          adminEmail: "admin@acme.com",
          planName: "Launch",
          limitType: "Workflows",
          current: 10,
          max: 10,
        });
        expect(updateFn).toHaveBeenCalledWith({
          where: { id: "org_123" },
          data: { sentResourceLimitAlert: expect.any(Date) },
        });
      });
    });

    describe("when no previous alert exists", () => {
      it("notifies and updates timestamp", async () => {
        const updateFn = vi.fn().mockResolvedValue({});
        const db = createMockDb({
          organization: makeOrganization({
            sentResourceLimitAlert: null,
          }),
          updateFn,
        });

        const notifier = createResourceLimitNotifier(db);
        await notifier(defaultInput);

        expect(mockNotifyResourceLimitSlack).toHaveBeenCalledWith({
          organizationId: "org_123",
          organizationName: "Acme",
          adminName: "Admin",
          adminEmail: "admin@acme.com",
          planName: "Launch",
          limitType: "Workflows",
          current: 10,
          max: 10,
        });
        expect(updateFn).toHaveBeenCalled();
      });
    });

    describe("when cooldown applies across limit types", () => {
      it("suppresses notification for different limit type within cooldown", async () => {
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
        const db = createMockDb({
          organization: makeOrganization({
            sentResourceLimitAlert: twoHoursAgo,
          }),
        });

        const notifier = createResourceLimitNotifier(db);
        await notifier({
          ...defaultInput,
          limitType: "agents",
        });

        expect(mockNotifyResourceLimitSlack).not.toHaveBeenCalled();
      });
    });

    describe("when notify succeeds but DB write fails", () => {
      it("captures critical error", async () => {
        const dbError = new Error("DB connection lost");
        const updateFn = vi.fn().mockRejectedValue(dbError);
        const db = createMockDb({
          organization: makeOrganization({
            sentResourceLimitAlert: null,
          }),
          updateFn,
        });

        const notifier = createResourceLimitNotifier(db);
        await notifier(defaultInput);

        expect(mockNotifyResourceLimitSlack).toHaveBeenCalled();
        expect(mockCaptureException).toHaveBeenCalledWith(
          expect.objectContaining({
            message: expect.stringContaining(
              "Critical: resource limit notification sent but DB timestamp update failed for org org_123 limitType workflows",
            ),
          }),
        );
      });
    });

    describe("when plan provider fails", () => {
      it("sends notification with fallback plan name", async () => {
        const { getApp } = await import("../../../src/server/app-layer/app");
        (getApp as ReturnType<typeof vi.fn>).mockReturnValueOnce({
          planProvider: {
            getActivePlan: vi.fn().mockRejectedValue(new Error("no plan")),
          },
        });

        const updateFn = vi.fn().mockResolvedValue({});
        const db = createMockDb({
          organization: makeOrganization({
            sentResourceLimitAlert: null,
          }),
          updateFn,
        });

        const notifier = createResourceLimitNotifier(db);
        await notifier(defaultInput);

        expect(mockNotifyResourceLimitSlack).toHaveBeenCalledWith(
          expect.objectContaining({
            planName: "unknown",
          }),
        );
      });
    });
  });
});
