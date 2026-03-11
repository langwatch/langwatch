/**
 * @vitest-environment node
 *
 * Unit tests for licenseEnforcement.reportLimitBlocked mutation.
 *
 * Verifies:
 * - Sends notification when limit is actually reached
 * - Does not send notification when limit is not reached (fabricated request)
 * - Captures exceptions when notification fails
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockCheckLimit = vi.fn();

vi.mock("~/server/license-enforcement", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/server/license-enforcement")>();
  return {
    ...actual,
    createLicenseEnforcementService: () => ({
      checkLimit: mockCheckLimit,
    }),
  };
});

const mockNotifyResourceLimitReached = vi.fn();
const mockUsageLimits = {
  notifyResourceLimitReached: mockNotifyResourceLimitReached,
};

vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    usageLimits: mockUsageLimits,
  }),
}));

const mockCaptureException = vi.fn();
vi.mock("~/utils/posthogErrorCapture", () => ({
  captureException: mockCaptureException,
}));

const mockTrackServerEvent = vi.fn();
vi.mock("~/server/posthog", () => ({
  trackServerEvent: mockTrackServerEvent,
}));

vi.mock("../../../auditLog", () => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
}));

// Mock RBAC to allow all permission checks (unit test, not testing auth)
vi.mock("../../rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../rbac")>();
  return {
    ...actual,
    checkOrganizationPermission:
      () =>
      async ({ ctx, next }: any) => {
        ctx.permissionChecked = true;
        return next();
      },
  };
});

// Dynamically import the router after mocks are in place
const { licenseEnforcementRouter } = await import("../licenseEnforcement");

// Helper to call the mutation directly via tRPC createCaller
async function callReportLimitBlocked({
  organizationId,
  limitType,
}: {
  organizationId: string;
  limitType: string;
}) {
  const caller = licenseEnforcementRouter.createCaller({
    prisma: {} as any,
    session: {
      user: { id: "user-1", email: "test@example.com", name: "Test User" },
      expires: "",
    },
  } as any);
  return caller.reportLimitBlocked({
    organizationId,
    limitType: limitType as any,
  });
}

describe("licenseEnforcement.reportLimitBlocked", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNotifyResourceLimitReached.mockResolvedValue(undefined);
  });

  describe("when limit is actually reached", () => {
    it("sends notification to ops team", async () => {
      mockCheckLimit.mockResolvedValue({
        allowed: false,
        current: 10,
        max: 10,
        limitType: "workflows",
      });

      await callReportLimitBlocked({
        organizationId: "org-123",
        limitType: "workflows",
      });

      expect(mockCheckLimit).toHaveBeenCalledWith(
        "org-123",
        "workflows",
        expect.objectContaining({ id: "user-1" })
      );
      expect(mockNotifyResourceLimitReached).toHaveBeenCalledWith({
        organizationId: "org-123",
        limitType: "workflows",
        current: 10,
        max: 10,
      });
    });

    it("fires a limit_blocked event with ui_pre_check source", async () => {
      mockCheckLimit.mockResolvedValue({
        allowed: false,
        current: 10,
        max: 10,
        limitType: "workflows",
      });

      await callReportLimitBlocked({
        organizationId: "org-123",
        limitType: "workflows",
      });

      expect(mockTrackServerEvent).toHaveBeenCalledWith({
        userId: "user-1",
        event: "limit_blocked",
        properties: {
          limitType: "workflows",
          current: 10,
          max: 10,
          source: "ui_pre_check",
        },
      });
    });
  });

  describe("when limit is not reached (fabricated request)", () => {
    it("does not send notification", async () => {
      mockCheckLimit.mockResolvedValue({
        allowed: true,
        current: 3,
        max: 10,
        limitType: "workflows",
      });

      await callReportLimitBlocked({
        organizationId: "org-123",
        limitType: "workflows",
      });

      expect(mockCheckLimit).toHaveBeenCalledWith(
        "org-123",
        "workflows",
        expect.objectContaining({ id: "user-1" })
      );
      expect(mockNotifyResourceLimitReached).not.toHaveBeenCalled();
      expect(mockTrackServerEvent).not.toHaveBeenCalled();
    });
  });

  describe("when notification fails", () => {
    it("captures the exception for observability", async () => {
      const notificationError = new Error("Slack webhook unreachable");
      mockNotifyResourceLimitReached.mockRejectedValue(notificationError);
      mockCheckLimit.mockResolvedValue({
        allowed: false,
        current: 10,
        max: 10,
        limitType: "workflows",
      });

      await callReportLimitBlocked({
        organizationId: "org-123",
        limitType: "workflows",
      });

      // Allow the rejected promise + .catch(captureException) to settle
      await vi.waitFor(() => {
        expect(mockCaptureException).toHaveBeenCalledWith(notificationError);
      });
    });
  });

  describe("when called with different limit types", () => {
    it("passes the correct limitType to checkLimit", async () => {
      mockCheckLimit.mockResolvedValue({
        allowed: false,
        current: 5,
        max: 5,
        limitType: "prompts",
      });

      await callReportLimitBlocked({
        organizationId: "org-456",
        limitType: "prompts",
      });

      expect(mockCheckLimit).toHaveBeenCalledWith(
        "org-456",
        "prompts",
        expect.any(Object)
      );
      expect(mockNotifyResourceLimitReached).toHaveBeenCalledWith(
        expect.objectContaining({ limitType: "prompts" })
      );
    });
  });
});
