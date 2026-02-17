import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/env.mjs", () => ({
  env: {
    IS_SAAS: false,
  },
}));

vi.mock("../../../src/server/db", () => ({
  prisma: {},
}));

vi.mock("../notificationHandlers", () => ({
  notifyPlanLimit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../src/utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
}));

import { env } from "../../../src/env.mjs";
import { createPlanLimitNotifier } from "../planLimitNotifier";
import { notifyPlanLimit } from "../notificationHandlers";
import { captureException } from "../../../src/utils/posthogErrorCapture";

const mockEnv = env as { IS_SAAS: boolean | undefined };
const mockNotifyPlanLimit = notifyPlanLimit as ReturnType<typeof vi.fn>;
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
  sentPlanLimitAlert = null,
  adminName = "Admin",
  adminEmail = "admin@acme.com",
}: {
  sentPlanLimitAlert?: Date | null;
  adminName?: string;
  adminEmail?: string;
} = {}) => ({
  id: "org_123",
  name: "Acme",
  sentPlanLimitAlert,
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

describe("createPlanLimitNotifier", () => {
  beforeEach(() => {
    mockEnv.IS_SAAS = false;
    vi.clearAllMocks();
  });

  describe("when IS_SAAS is false", () => {
    it("does nothing", async () => {
      mockEnv.IS_SAAS = false;

      const db = createMockDb();
      const notifier = createPlanLimitNotifier(db);
      await notifier({ organizationId: "org_123", planName: "LAUNCH" });

      expect(db.organization.findUnique).not.toHaveBeenCalled();
      expect(mockNotifyPlanLimit).not.toHaveBeenCalled();
    });
  });

  describe("when IS_SAAS is true", () => {
    beforeEach(() => {
      mockEnv.IS_SAAS = true;
    });

    describe("when org not found", () => {
      it("does nothing", async () => {
        const db = createMockDb({ organization: null });
        const notifier = createPlanLimitNotifier(db);
        await notifier({ organizationId: "org_missing", planName: "LAUNCH" });

        expect(mockNotifyPlanLimit).not.toHaveBeenCalled();
      });
    });

    describe("when alert was sent less than 30 days ago", () => {
      it("suppresses notification", async () => {
        const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
        const db = createMockDb({
          organization: makeOrganization({ sentPlanLimitAlert: tenDaysAgo }),
        });

        const notifier = createPlanLimitNotifier(db);
        await notifier({ organizationId: "org_123", planName: "LAUNCH" });

        expect(mockNotifyPlanLimit).not.toHaveBeenCalled();
      });
    });

    describe("when alert was sent more than 30 days ago", () => {
      it("notifies and updates timestamp", async () => {
        const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
        const updateFn = vi.fn().mockResolvedValue({});
        const db = createMockDb({
          organization: makeOrganization({ sentPlanLimitAlert: fortyDaysAgo }),
          updateFn,
        });

        const notifier = createPlanLimitNotifier(db);
        await notifier({ organizationId: "org_123", planName: "LAUNCH" });

        expect(mockNotifyPlanLimit).toHaveBeenCalledWith({
          organizationId: "org_123",
          organizationName: "Acme",
          adminName: "Admin",
          adminEmail: "admin@acme.com",
          planName: "LAUNCH",
        });
        expect(updateFn).toHaveBeenCalledWith({
          where: { id: "org_123" },
          data: { sentPlanLimitAlert: expect.any(Date) },
        });
      });
    });

    describe("when no previous alert exists", () => {
      it("notifies and updates timestamp", async () => {
        const updateFn = vi.fn().mockResolvedValue({});
        const db = createMockDb({
          organization: makeOrganization({ sentPlanLimitAlert: null }),
          updateFn,
        });

        const notifier = createPlanLimitNotifier(db);
        await notifier({ organizationId: "org_123", planName: "LAUNCH" });

        expect(mockNotifyPlanLimit).toHaveBeenCalledWith({
          organizationId: "org_123",
          organizationName: "Acme",
          adminName: "Admin",
          adminEmail: "admin@acme.com",
          planName: "LAUNCH",
        });
        expect(updateFn).toHaveBeenCalled();
      });
    });

    describe("when notify succeeds but DB write fails", () => {
      it("logs critical error and does not save timestamp", async () => {
        const dbError = new Error("DB connection lost");
        const updateFn = vi.fn().mockRejectedValue(dbError);
        const db = createMockDb({
          organization: makeOrganization({ sentPlanLimitAlert: null }),
          updateFn,
        });

        const notifier = createPlanLimitNotifier(db);
        await notifier({ organizationId: "org_123", planName: "LAUNCH" });

        expect(mockNotifyPlanLimit).toHaveBeenCalled();
        expect(mockCaptureException).toHaveBeenCalledWith(
          expect.objectContaining({
            message: expect.stringContaining(
              "Critical: plan limit notification sent but DB timestamp update failed for org org_123 on plan LAUNCH",
            ),
          }),
        );
      });
    });
  });
});
