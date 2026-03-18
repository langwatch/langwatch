import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInnerTRPCContext } from "../../trpc";

const {
  mockCreateAndAssign,
  mockCreateProject,
  mockCaptureException,
  mockSendSlackSignupEvent,
  mockSendHubspotSignupForm,
} = vi.hoisted(() => ({
  mockCreateAndAssign: vi.fn(),
  mockCreateProject: vi.fn(),
  mockCaptureException: vi.fn(),
  mockSendSlackSignupEvent: vi.fn(),
  mockSendHubspotSignupForm: vi.fn(),
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

vi.mock("../organization", () => ({
  organizationRouter: {
    createCaller: vi.fn(() => ({
      createAndAssign: mockCreateAndAssign,
    })),
  },
}));

vi.mock("../project", () => ({
  projectRouter: {
    createCaller: vi.fn(() => ({
      create: mockCreateProject,
    })),
  },
}));

vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    notifications: {
      sendSlackSignupEvent: mockSendSlackSignupEvent,
      sendHubspotSignupForm: mockSendHubspotSignupForm,
    },
    nurturing: {
      identifyUser: vi.fn().mockResolvedValue(undefined),
      trackEvent: vi.fn().mockResolvedValue(undefined),
      groupUser: vi.fn().mockResolvedValue(undefined),
      batch: vi.fn().mockResolvedValue(undefined),
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

describe("onboarding.initializeOrganization", () => {
  const orgResult = {
    success: true,
    organization: { id: "org_1", name: "Acme Corp" },
    team: { id: "team_1", name: "Acme Team", slug: "acme-team" },
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockCreateAndAssign.mockResolvedValue(orgResult);
    mockCreateProject.mockResolvedValue({
      success: true,
      projectSlug: "acme-project",
    });
  });

  function createCaller() {
    const ctx = createInnerTRPCContext({
      session: {
        user: {
          id: "user_1",
          name: "Jane Doe",
          email: "jane@example.com",
        },
        expires: "1",
      },
      permissionChecked: false,
    });

    return onboardingRouter.createCaller(ctx);
  }

  describe("when notifications are available", () => {
    it("sends the signup event after creating the organization", async () => {
      mockSendSlackSignupEvent.mockResolvedValue(undefined);
      mockSendHubspotSignupForm.mockResolvedValue(undefined);
      const caller = createCaller();

      const result = await caller.initializeOrganization({
        orgName: "Acme Corp",
        phoneNumber: "+31 20 123 4567",
        signUpData: { utmCampaign: "launch-week" },
        projectName: "Acme Project",
      });

      expect(result).toEqual({
        success: true,
        teamSlug: "acme-team",
        teamName: "Acme Team",
        teamId: "team_1",
        organizationId: "org_1",
        projectSlug: "acme-project",
      });
      expect(mockSendSlackSignupEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          userName: "Jane Doe",
          userEmail: "jane@example.com",
          organizationName: "Acme Corp",
          phoneNumber: "+31 20 123 4567",
          utmCampaign: "launch-week",
        }),
      );
    });

    it("sends the HubSpot signup form alongside the Slack event", async () => {
      mockSendSlackSignupEvent.mockResolvedValue(undefined);
      mockSendHubspotSignupForm.mockResolvedValue(undefined);
      const caller = createCaller();

      await caller.initializeOrganization({
        orgName: "Acme Corp",
        phoneNumber: "+31 20 123 4567",
        signUpData: {
          utmCampaign: "launch-week",
          featureUsage: "Evaluations",
          yourRole: "Engineer",
        },
        projectName: "Acme Project",
      });

      expect(mockSendHubspotSignupForm).toHaveBeenCalledWith({
        userName: "Jane Doe",
        userEmail: "jane@example.com",
        organizationName: "Acme Corp",
        phoneNumber: "+31 20 123 4567",
        signUpData: {
          utmCampaign: "launch-week",
          featureUsage: "Evaluations",
          yourRole: "Engineer",
        },
      });
    });
  });

  describe("when sending the signup notification fails", () => {
    it("captures the error and still returns onboarding success", async () => {
      const error = new Error("Slack down");
      mockSendSlackSignupEvent.mockRejectedValue(error);
      const caller = createCaller();

      const result = await caller.initializeOrganization({
        orgName: "Acme Corp",
        projectName: "Acme Project",
      });

      expect(result.success).toBe(true);
      expect(mockCaptureException).toHaveBeenCalledWith(error);
    });
  });
});
