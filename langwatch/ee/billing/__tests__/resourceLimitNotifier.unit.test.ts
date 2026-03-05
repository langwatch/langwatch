import type { PrismaClient } from "@prisma/client";
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
  notifyResourceLimit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../src/server/app-layer/app", () => ({
  getApp: vi.fn().mockReturnValue({
    planProvider: {
      getActivePlan: vi.fn().mockResolvedValue({ name: "Launch" }),
    },
  }),
}));

import { env } from "../../../src/env.mjs";
import {
  createResourceLimitNotifier,
  cooldownCache,
} from "../notifications/resourceLimitNotifier";
import { notifyResourceLimit } from "../notifications/notificationHandlers";

const mockEnv = env as { IS_SAAS: boolean | undefined };
const mockNotifyResourceLimit = notifyResourceLimit as ReturnType<
  typeof vi.fn
>;

const createMockDb = ({
  organization = null,
}: {
  organization?: unknown;
} = {}) => {
  return {
    organization: {
      findUnique: vi.fn().mockResolvedValue(organization),
    },
  } as unknown as PrismaClient;
};

const makeOrganization = ({
  adminName = "Admin",
  adminEmail = "admin@acme.com",
}: {
  adminName?: string;
  adminEmail?: string;
} = {}) => ({
  id: "org_123",
  name: "Acme",
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

describe("createResourceLimitNotifier()", () => {
  beforeEach(() => {
    mockEnv.IS_SAAS = false;
    cooldownCache.clear();
    vi.clearAllMocks();
  });

  describe("when IS_SAAS is false", () => {
    it("does nothing", async () => {
      mockEnv.IS_SAAS = false;

      const db = createMockDb();
      const notifier = createResourceLimitNotifier(db);
      await notifier(defaultInput);

      expect(db.organization.findUnique).not.toHaveBeenCalled();
      expect(mockNotifyResourceLimit).not.toHaveBeenCalled();
    });
  });

  describe("when IS_SAAS is true", () => {
    beforeEach(() => {
      mockEnv.IS_SAAS = true;
    });

    describe("given the organization does not exist", () => {
      it("does nothing", async () => {
        const db = createMockDb({ organization: null });
        const notifier = createResourceLimitNotifier(db);
        await notifier({ ...defaultInput, organizationId: "org_missing" });

        expect(mockNotifyResourceLimit).not.toHaveBeenCalled();
      });
    });

    describe("when cooldown is active", () => {
      it("suppresses notification", async () => {
        cooldownCache.set("org_123", true);

        const db = createMockDb({
          organization: makeOrganization(),
        });

        const notifier = createResourceLimitNotifier(db);
        await notifier(defaultInput);

        expect(db.organization.findUnique).not.toHaveBeenCalled();
        expect(mockNotifyResourceLimit).not.toHaveBeenCalled();
      });
    });

    describe("when cooldown applies across limit types", () => {
      it("suppresses notification for different limit type within cooldown", async () => {
        cooldownCache.set("org_123", true);

        const db = createMockDb({
          organization: makeOrganization(),
        });

        const notifier = createResourceLimitNotifier(db);
        await notifier({
          ...defaultInput,
          limitType: "agents",
        });

        expect(mockNotifyResourceLimit).not.toHaveBeenCalled();
      });
    });

    describe("when no cooldown is active", () => {
      it("sends notification with correct payload", async () => {
        const db = createMockDb({
          organization: makeOrganization(),
        });

        const notifier = createResourceLimitNotifier(db);
        await notifier(defaultInput);

        expect(mockNotifyResourceLimit).toHaveBeenCalledWith({
          organizationId: "org_123",
          organizationName: "Acme",
          adminName: "Admin",
          adminEmail: "admin@acme.com",
          planName: "Launch",
          limitType: "Workflows",
          current: 10,
          max: 10,
        });
      });

      it("sets cooldown eagerly to prevent concurrent duplicates", async () => {
        const db = createMockDb({
          organization: makeOrganization(),
        });

        const notifier = createResourceLimitNotifier(db);
        await notifier(defaultInput);

        expect(cooldownCache.get("org_123")).toBe(true);
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

        const db = createMockDb({
          organization: makeOrganization(),
        });

        const notifier = createResourceLimitNotifier(db);
        await notifier(defaultInput);

        expect(mockNotifyResourceLimit).toHaveBeenCalledWith(
          expect.objectContaining({
            planName: "unknown",
          }),
        );
      });
    });
  });
});
