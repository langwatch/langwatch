import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInnerTRPCContext } from "../../trpc";

const {
  mockCreateAndAssign,
  mockCreateProject,
  mockCaptureException,
  mockSendSlackSignupEvent,
  mockSendHubspotSignupForm,
  mockIdentifyUser,
  mockTrackEvent,
  mockGroupUser,
  mockBatch,
} = vi.hoisted(() => ({
  mockCreateAndAssign: vi.fn(),
  mockCreateProject: vi.fn(),
  mockCaptureException: vi.fn(),
  mockSendSlackSignupEvent: vi.fn(),
  mockSendHubspotSignupForm: vi.fn(),
  mockIdentifyUser: vi.fn().mockResolvedValue(undefined),
  mockTrackEvent: vi.fn().mockResolvedValue(undefined),
  mockGroupUser: vi.fn().mockResolvedValue(undefined),
  mockBatch: vi.fn().mockResolvedValue(undefined),
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
      identifyUser: mockIdentifyUser,
      trackEvent: mockTrackEvent,
      groupUser: mockGroupUser,
      batch: mockBatch,
    },
  }),
}));

vi.mock("~/utils/posthogErrorCapture", () => ({
  captureException: mockCaptureException,
  toError: vi.fn((e) => e instanceof Error ? e : new Error(String(e))),
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

  describe("when the caller declares a primary intent (ADR-038)", () => {
    it("forwards the intent to organization creation as a sibling of signUpData", async () => {
      const caller = createCaller();

      await caller.initializeOrganization({
        orgName: "Acme Corp",
        primaryIntent: "AGENT_GOVERNANCE",
        signUpData: { terms: true },
        projectName: "Acme Project",
      });

      expect(mockCreateAndAssign).toHaveBeenCalledWith({
        orgName: "Acme Corp",
        phoneNumber: undefined,
        signUpData: { terms: true },
        primaryIntent: "AGENT_GOVERNANCE",
      });
    });

    /** @scenario "Governance signup creates organization and team, but no project" */
    it("skips project creation and returns a null projectSlug", async () => {
      const caller = createCaller();

      const result = await caller.initializeOrganization({
        orgName: "Acme Corp",
        primaryIntent: "AGENT_GOVERNANCE",
        projectName: "Acme Project",
      });

      expect(mockCreateProject).not.toHaveBeenCalled();
      expect(result.projectSlug).toBeNull();
      expect(result.success).toBe(true);
      expect(result.organizationId).toBe("org_1");
    });

    /** @scenario "LLMOps signup still creates the default project" */
    it("still creates a project for LLMOps signups", async () => {
      const caller = createCaller();

      const result = await caller.initializeOrganization({
        orgName: "Acme Corp",
        primaryIntent: "LLM_OPS",
        projectName: "Acme Project",
      });

      expect(mockCreateProject).toHaveBeenCalledOnce();
      expect(result.projectSlug).toBe("acme-project");
    });

    it("still creates a project when no intent is given (legacy callers)", async () => {
      const caller = createCaller();

      await caller.initializeOrganization({
        orgName: "Acme Corp",
        projectName: "Acme Project",
      });

      expect(mockCreateProject).toHaveBeenCalledOnce();
    });

    /** @scenario "Nurturing receives the intent as an explicit trait" */
    it("passes the intent to nurturing as an explicit trait", async () => {
      const caller = createCaller();

      await caller.initializeOrganization({
        orgName: "Acme Corp",
        primaryIntent: "AGENT_GOVERNANCE",
        projectName: "Acme Project",
      });

      expect(mockIdentifyUser).toHaveBeenCalledWith(
        expect.objectContaining({
          traits: expect.objectContaining({
            primary_intent: "agent_governance",
          }),
        }),
      );
      expect(mockTrackEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          properties: expect.objectContaining({
            primary_intent: "agent_governance",
          }),
        }),
      );
    });
  });

  describe("when the caller declares the LLMOps intent", () => {
    /** @scenario "LLMOps signup produces the same marketing data as today" */
    it("keeps the signUpData payload byte-identical to today — intent never leaks into it", async () => {
      const caller = createCaller();
      const llmOpsSignUpData = {
        usage: "For my company",
        solution: "SaaS",
        terms: true,
        companySize: "11_to_50",
        yourRole: "Engineer",
        featureUsage: "Evaluations",
        utmCampaign: "launch-week",
      };

      await caller.initializeOrganization({
        orgName: "Acme Corp",
        phoneNumber: "+31 20 123 4567",
        primaryIntent: "LLM_OPS",
        signUpData: llmOpsSignUpData,
        projectName: "Acme Project",
      });

      // I2 snapshot: the exact object today's flow sends, with intent as a
      // SIBLING field only — any drift here breaks Customer.io/HubSpot
      // segmentation (C2).
      expect(mockCreateAndAssign).toHaveBeenCalledWith({
        orgName: "Acme Corp",
        phoneNumber: "+31 20 123 4567",
        signUpData: llmOpsSignUpData,
        primaryIntent: "LLM_OPS",
      });
    });
  });

  describe("when no intent is provided (legacy callers)", () => {
    it("forwards undefined so the organization persists NULL", async () => {
      const caller = createCaller();

      await caller.initializeOrganization({
        orgName: "Acme Corp",
        projectName: "Acme Project",
      });

      expect(mockCreateAndAssign).toHaveBeenCalledWith(
        expect.objectContaining({ primaryIntent: undefined }),
      );
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
