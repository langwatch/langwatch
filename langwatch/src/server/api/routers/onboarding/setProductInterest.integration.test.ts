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

// Mock the organization/project routers (needed by initializeOrganization, not setProductInterest)
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

describe("onboarding.setProductInterest", () => {
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

  describe("when the user selects 'Observability'", () => {
    it("fires an identifyUser call with product_interest 'observability'", async () => {
      const caller = createCaller();

      const result = await caller.setProductInterest({
        productInterest: "observability",
      });

      expect(result).toEqual({ success: true });
      expect(mockIdentifyUser).toHaveBeenCalledWith({
        userId: "user-42",
        traits: { product_interest: "observability" },
      });
    });
  });

  describe("when the user selects 'Evaluations'", () => {
    it("fires an identifyUser call with product_interest 'evaluations'", async () => {
      const caller = createCaller();

      await caller.setProductInterest({ productInterest: "evaluations" });

      expect(mockIdentifyUser).toHaveBeenCalledWith({
        userId: "user-42",
        traits: { product_interest: "evaluations" },
      });
    });
  });

  describe("when the user selects 'prompt-management'", () => {
    it("maps to product_interest 'prompt_management'", async () => {
      const caller = createCaller();

      await caller.setProductInterest({
        productInterest: "prompt-management",
      });

      expect(mockIdentifyUser).toHaveBeenCalledWith({
        userId: "user-42",
        traits: { product_interest: "prompt_management" },
      });
    });
  });

  describe("when the user selects 'agent-simulations'", () => {
    it("maps to product_interest 'agent_simulations'", async () => {
      const caller = createCaller();

      await caller.setProductInterest({
        productInterest: "agent-simulations",
      });

      expect(mockIdentifyUser).toHaveBeenCalledWith({
        userId: "user-42",
        traits: { product_interest: "agent_simulations" },
      });
    });
  });

  describe("when the identify call is independent of the initial signup", () => {
    it("sends only product_interest trait, no other signup traits", async () => {
      const caller = createCaller();

      await caller.setProductInterest({
        productInterest: "observability",
      });

      const callArgs = mockIdentifyUser.mock.calls[0]![0];
      expect(Object.keys(callArgs.traits)).toEqual(["product_interest"]);
    });
  });

  describe("when Customer.io API is unavailable", () => {
    it("returns success without waiting for the CIO call", async () => {
      mockIdentifyUser.mockRejectedValueOnce(new Error("CIO down"));

      const caller = createCaller();
      const result = await caller.setProductInterest({
        productInterest: "evaluations",
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
