/**
 * @vitest-environment node
 *
 * Unit tests for enforceLicenseLimit middleware.
 *
 * Verifies the side-effect behavior when LimitExceededError is thrown:
 * - Fire-and-forget notification via notifyResourceLimitReached
 * - PostHog tracking with source: "server_safety_net"
 * - captureException on notification failure
 * - TRPCError propagation to caller
 * - No side-effects when limit is not exceeded
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

import { LimitExceededError } from "../errors";
import { ProjectNotFoundError } from "../errors";

// --- Mocks ---

const mockEnforceLimitByOrganization = vi.fn();
vi.mock("../index", () => ({
  createLicenseEnforcementService: () => ({
    enforceLimitByOrganization: mockEnforceLimitByOrganization,
  }),
}));

const mockGetOrganizationIdForProject = vi.fn();
vi.mock("../utils", () => ({
  getOrganizationIdForProject: (...args: unknown[]) =>
    mockGetOrganizationIdForProject(...args),
}));

const mockNotifyResourceLimitReached = vi.fn();
vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    usageLimits: {
      notifyResourceLimitReached: mockNotifyResourceLimitReached,
    },
  }),
}));

const mockTrackServerEvent = vi.fn();
vi.mock("~/server/posthog", () => ({
  trackServerEvent: mockTrackServerEvent,
}));

const mockCaptureException = vi.fn();
vi.mock("~/utils/posthogErrorCapture", () => ({
  captureException: mockCaptureException,
}));

// Import SUT after mocks are wired
const { enforceLicenseLimit } = await import("../enforcement.middleware");

// --- Test helpers ---

function buildCtx({ userId = "user-1" } = {}) {
  return {
    prisma: {} as any,
    session: {
      user: { id: userId, email: "test@example.com", name: "Test User" },
      expires: "",
    },
  };
}

describe("enforceLicenseLimit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrganizationIdForProject.mockResolvedValue("org-123");
    mockNotifyResourceLimitReached.mockResolvedValue(undefined);
  });

  describe("when limit is exceeded", () => {
    beforeEach(() => {
      mockEnforceLimitByOrganization.mockRejectedValue(
        new LimitExceededError("workflows", 10, 10)
      );
    });

    it("calls notifyResourceLimitReached with the correct payload", async () => {
      await expect(
        enforceLicenseLimit(buildCtx(), "project-1", "workflows")
      ).rejects.toThrow(TRPCError);

      expect(mockNotifyResourceLimitReached).toHaveBeenCalledWith({
        organizationId: "org-123",
        limitType: "workflows",
        current: 10,
        max: 10,
      });
    });

    it("calls trackServerEvent with source server_safety_net and projectId", async () => {
      await expect(
        enforceLicenseLimit(buildCtx(), "project-1", "workflows")
      ).rejects.toThrow(TRPCError);

      expect(mockTrackServerEvent).toHaveBeenCalledWith({
        userId: "user-1",
        event: "limit_blocked",
        projectId: "project-1",
        properties: {
          limitType: "workflows",
          current: 10,
          max: 10,
          source: "server_safety_net",
        },
      });
    });

    it("throws a TRPCError with FORBIDDEN code to the caller", async () => {
      try {
        await enforceLicenseLimit(buildCtx(), "project-1", "workflows");
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(TRPCError);
        const trpcError = error as TRPCError;
        expect(trpcError.code).toBe("FORBIDDEN");
        expect(trpcError.cause).toMatchObject({
          limitType: "workflows",
          current: 10,
          max: 10,
        });
      }
    });
  });

  describe("when notifyResourceLimitReached rejects", () => {
    it("captures the exception without re-throwing", async () => {
      const notificationError = new Error("Slack webhook unreachable");
      mockNotifyResourceLimitReached.mockRejectedValue(notificationError);
      mockEnforceLimitByOrganization.mockRejectedValue(
        new LimitExceededError("prompts", 5, 5)
      );

      await expect(
        enforceLicenseLimit(buildCtx(), "project-1", "prompts")
      ).rejects.toThrow(TRPCError);

      // Allow the fire-and-forget .catch(captureException) to settle
      await vi.waitFor(() => {
        expect(mockCaptureException).toHaveBeenCalledWith(notificationError);
      });
    });
  });

  describe("when limit is not exceeded", () => {
    beforeEach(() => {
      mockEnforceLimitByOrganization.mockResolvedValue(undefined);
    });

    it("does not call notifyResourceLimitReached or trackServerEvent", async () => {
      await enforceLicenseLimit(buildCtx(), "project-1", "workflows");

      expect(mockNotifyResourceLimitReached).not.toHaveBeenCalled();
      expect(mockTrackServerEvent).not.toHaveBeenCalled();
    });
  });

  describe("when project is not found", () => {
    it("throws a TRPCError with NOT_FOUND code", async () => {
      mockGetOrganizationIdForProject.mockRejectedValue(
        new ProjectNotFoundError("project-unknown")
      );

      try {
        await enforceLicenseLimit(buildCtx(), "project-unknown", "workflows");
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(TRPCError);
        expect((error as TRPCError).code).toBe("NOT_FOUND");
      }
    });
  });
});
