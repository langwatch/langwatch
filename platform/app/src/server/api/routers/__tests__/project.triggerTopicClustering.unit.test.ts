import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import type * as PermissionAdapters from "~/server/app-layer/authz/permission-adapters";
import { appPermissionsService } from "~/test-utils/appPermissionsMock";
import { createInnerTRPCContext } from "../../trpc";
import { projectRouter } from "../project";

const { mockIsEnabled, mockSend, mockInFlight } = vi.hoisted(() => ({
  mockIsEnabled: vi.fn(),
  mockSend: vi.fn(),
  mockInFlight: vi.fn(),
}));

vi.mock("~/server/featureFlag", () => ({
  featureFlagService: { isEnabled: mockIsEnabled },
}));
vi.mock("~/server/app-layer/app", () => ({
  tryGetApp: () => null,
  getApp: () => ({
    permissions: appPermissionsService(),
    topicClustering: {
      status: { isRunInFlight: mockInFlight },
      requestClustering: mockSend,
    },
  }),
}));
vi.mock(
  "~/server/app-layer/authz/permission-adapters",
  async (importOriginal) => {
    const actual = await importOriginal<typeof PermissionAdapters>();
    return {
      ...actual,
      resolveProjectPermission: vi.fn().mockResolvedValue({
        permitted: true,
        organizationRole: "MEMBER",
      }),
      skipPermissionCheck: ({ ctx, next }: any) => {
        ctx.permissionChecked = true;
        return next();
      },
      skipPermissionCheckProjectCreation: ({ ctx, next }: any) => {
        ctx.permissionChecked = true;
        return next();
      },
    };
  },
);
vi.mock("@ee/audit-log/auditLog", () => ({ auditLog: vi.fn() }));

function caller() {
  const ctx = createInnerTRPCContext({
    session: { user: { id: "test-user-id" }, expires: "1" },
    req: undefined,
    res: undefined,
    permissionChecked: true,
    publiclyShared: false,
  });
  ctx.prisma = {} as PrismaClient;
  return projectRouter.createCaller(ctx);
}

describe("given a manual topic clustering request", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInFlight.mockResolvedValue(false);
    mockSend.mockResolvedValue(undefined);
  });

  describe("when the project command is disabled", () => {
    /** @scenario A disabled manual request is not reported as started */
    it("does not send or claim success for a disabled project command", async () => {
      mockIsEnabled.mockResolvedValue(true);
      const result = await caller().triggerTopicClustering({
        projectId: "project_123",
      });
      expect(result).toEqual({ started: false, reason: "disabled" });
      expect(mockSend).not.toHaveBeenCalled();
      expect(mockIsEnabled).toHaveBeenCalledWith(
        "es-topic_clustering-command-requestClustering-killswitch",
        expect.objectContaining({
          projectId: "project_123",
          distinctId: "project_123",
        }),
      );
    });
  });

  describe("when the project command is enabled", () => {
    /** @scenario An enabled manual request keeps its accepted feedback */
    it("sends and keeps the existing started response when enabled", async () => {
      mockIsEnabled.mockResolvedValue(false);
      const result = await caller().triggerTopicClustering({
        projectId: "project_123",
      });
      expect(result).toEqual({ started: true });
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "project_123",
          trigger: "manual",
          requestedByUserId: "test-user-id",
        }),
      );
    });
  });
});
