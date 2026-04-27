import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInnerTRPCContext } from "../../trpc";

const { mockIdentifyUser, mockCaptureException } = vi.hoisted(() => ({
  mockIdentifyUser: vi.fn().mockResolvedValue(undefined),
  mockCaptureException: vi.fn(),
}));

vi.mock("../../rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../rbac")>();
  return {
    ...actual,
    skipPermissionCheck: ({ ctx, next }: any) => {
      ctx.permissionChecked = true;
      return next();
    },
  };
});

// Mock the organization/project routers (needed by initializeOrganization, not setIntegrationMethod)
vi.mock("../organization", () => ({
  organizationRouter: { createCaller: vi.fn(() => ({})) },
}));
vi.mock("../project", () => ({
  projectRouter: { createCaller: vi.fn(() => ({})) },
}));

vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    nurturing: {
      identifyUser: mockIdentifyUser,
      trackEvent: vi.fn().mockResolvedValue(undefined),
      groupUser: vi.fn().mockResolvedValue(undefined),
      batch: vi.fn().mockResolvedValue(undefined),
    },
    notifications: {
      sendSlackSignupEvent: vi.fn().mockResolvedValue(undefined),
      sendHubspotSignupForm: vi.fn().mockResolvedValue(undefined),
    },
  }),
}));

vi.mock("~/utils/posthogErrorCapture", () => ({
  captureException: mockCaptureException,
}));

vi.mock("../../../auditLog", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
}));

import { onboardingRouter } from "./onboarding.router";

describe("onboarding.setIntegrationMethod", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createCaller() {
    const ctx = createInnerTRPCContext({
      session: {
        user: {
          id: "user-42",
          name: "Jane Doe",
          email: "jane@example.com",
        },
        expires: "1",
      },
      permissionChecked: false,
    });
    return onboardingRouter.createCaller(ctx);
  }

  describe("when the user selects 'Via Coding Agent'", () => {
    it("fires an identifyUser call with integration_method 'coding_agent'", async () => {
      const caller = createCaller();

      const result = await caller.setIntegrationMethod({
        integrationMethod: "via-claude-code",
      });

      expect(result).toEqual({ success: true });
      expect(mockIdentifyUser).toHaveBeenCalledWith({
        userId: "user-42",
        traits: { integration_method: "coding_agent" },
      });
    });
  });

  describe("when the user selects 'Via the Platform'", () => {
    it("fires an identifyUser call with integration_method 'platform'", async () => {
      const caller = createCaller();

      await caller.setIntegrationMethod({ integrationMethod: "via-platform" });

      expect(mockIdentifyUser).toHaveBeenCalledWith({
        userId: "user-42",
        traits: { integration_method: "platform" },
      });
    });
  });

  describe("when the user selects 'Via MCP'", () => {
    it("maps to integration_method 'mcp'", async () => {
      const caller = createCaller();

      await caller.setIntegrationMethod({
        integrationMethod: "via-claude-desktop",
      });

      expect(mockIdentifyUser).toHaveBeenCalledWith({
        userId: "user-42",
        traits: { integration_method: "mcp" },
      });
    });
  });

  describe("when the user selects 'Manually'", () => {
    it("maps to integration_method 'manual_sdk'", async () => {
      const caller = createCaller();

      await caller.setIntegrationMethod({
        integrationMethod: "manually",
      });

      expect(mockIdentifyUser).toHaveBeenCalledWith({
        userId: "user-42",
        traits: { integration_method: "manual_sdk" },
      });
    });
  });

  describe("when the identify call is independent of the initial signup", () => {
    it("sends only integration_method trait, no other signup traits", async () => {
      const caller = createCaller();

      await caller.setIntegrationMethod({
        integrationMethod: "via-claude-code",
      });

      const callArgs = mockIdentifyUser.mock.calls[0]![0];
      expect(Object.keys(callArgs.traits)).toEqual(["integration_method"]);
    });
  });

  describe("when Customer.io API is unavailable", () => {
    it("returns success without waiting for the CIO call", async () => {
      mockIdentifyUser.mockRejectedValueOnce(new Error("CIO down"));

      const caller = createCaller();
      const result = await caller.setIntegrationMethod({
        integrationMethod: "via-platform",
      });

      // The mutation resolves immediately (fire-and-forget)
      expect(result).toEqual({ success: true });

      // The error is eventually captured
      await vi.waitFor(() => {
        expect(mockCaptureException).toHaveBeenCalled();
      });
    });
  });
});
