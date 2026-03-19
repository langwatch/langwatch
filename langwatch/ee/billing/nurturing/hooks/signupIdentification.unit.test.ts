import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireSignupNurturingCalls } from "./signupIdentification";

// Suppress logger output
vi.mock("../../../../src/utils/logger/server", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));
vi.mock("../../../../src/utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
}));

const mockNurturing = {
  identifyUser: vi.fn().mockResolvedValue(undefined),
  trackEvent: vi.fn().mockResolvedValue(undefined),
  groupUser: vi.fn().mockResolvedValue(undefined),
  batch: vi.fn().mockResolvedValue(undefined),
};

let currentNurturing: typeof mockNurturing | undefined = mockNurturing;

vi.mock("../../../../src/server/app-layer/app", () => ({
  getApp: () => ({
    get nurturing() {
      return currentNurturing;
    },
  }),
}));

describe("Signup identification hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentNurturing = mockNurturing;
  });

  describe("when the onboarding flow completes", () => {
    const baseArgs = {
      userId: "user-123",
      email: "jane@example.com",
      name: "Jane Doe",
      organizationId: "org-456",
      organizationName: "Acme Corp",
      signUpData: {
        yourRole: "engineer",
        companySize: "11-50",
        usage: "monitoring",
        solution: "llm-ops",
        featureUsage: "evaluations",
        utmCampaign: "launch-week",
        howDidYouHearAboutUs: "twitter",
      },
    };

    it("identifies user in Customer.io with email, name, role, and company_size", () => {
      fireSignupNurturingCalls(baseArgs);

      expect(mockNurturing.identifyUser).toHaveBeenCalledWith({
        userId: "user-123",
        traits: expect.objectContaining({
          email: "jane@example.com",
          name: "Jane Doe",
          role: "engineer",
          company_size: "11-50",
        }),
      });
    });

    it("includes has_traces false and has_evaluations false in traits", () => {
      fireSignupNurturingCalls(baseArgs);

      expect(mockNurturing.identifyUser).toHaveBeenCalledWith({
        userId: "user-123",
        traits: expect.objectContaining({
          has_traces: false,
          has_evaluations: false,
        }),
      });
    });

    it("includes has_prompts false and has_simulations false in traits", () => {
      fireSignupNurturingCalls(baseArgs);

      expect(mockNurturing.identifyUser).toHaveBeenCalledWith({
        userId: "user-123",
        traits: expect.objectContaining({
          has_prompts: false,
          has_simulations: false,
        }),
      });
    });

    it("includes signup_usage, signup_solution, and signup_feature_usage in traits", () => {
      fireSignupNurturingCalls(baseArgs);

      expect(mockNurturing.identifyUser).toHaveBeenCalledWith({
        userId: "user-123",
        traits: expect.objectContaining({
          signup_usage: "monitoring",
          signup_solution: "llm-ops",
          signup_feature_usage: "evaluations",
        }),
      });
    });

    it("includes utm_campaign and how_heard when present", () => {
      fireSignupNurturingCalls(baseArgs);

      expect(mockNurturing.identifyUser).toHaveBeenCalledWith({
        userId: "user-123",
        traits: expect.objectContaining({
          utm_campaign: "launch-week",
          how_heard: "twitter",
        }),
      });
    });

    it("includes createdAt as an ISO 8601 timestamp", () => {
      fireSignupNurturingCalls(baseArgs);

      const args = mockNurturing.identifyUser.mock.calls[0]![0];
      expect(args.traits.createdAt).toBeDefined();
      expect(new Date(args.traits.createdAt).toISOString()).toBe(args.traits.createdAt);
    });

    it("associates user with organization via group call", () => {
      fireSignupNurturingCalls(baseArgs);

      expect(mockNurturing.groupUser).toHaveBeenCalledWith({
        userId: "user-123",
        groupId: "org-456",
        traits: expect.objectContaining({
          name: "Acme Corp",
          company_size: "11-50",
          plan: "free",
        }),
      });
    });

    it("tracks signed_up event with signup metadata", () => {
      fireSignupNurturingCalls(baseArgs);

      expect(mockNurturing.trackEvent).toHaveBeenCalledWith({
        userId: "user-123",
        event: "signed_up",
        properties: expect.objectContaining({
          yourRole: "engineer",
          companySize: "11-50",
        }),
      });
    });
  });

  describe("when signup data has no optional marketing fields", () => {
    it("omits utm_campaign and how_heard from traits", () => {
      fireSignupNurturingCalls({
        userId: "user-123",
        email: "jane@example.com",
        name: "Jane Doe",
        organizationId: "org-456",
        organizationName: "Acme Corp",
        signUpData: {
          yourRole: "engineer",
          companySize: "11-50",
        },
      });

      const args = mockNurturing.identifyUser.mock.calls[0]![0];
      expect(args.traits.utm_campaign).toBeUndefined();
      expect(args.traits.how_heard).toBeUndefined();
    });
  });

  describe("when Customer.io API is unavailable", () => {
    it("does not throw (fire-and-forget)", async () => {
      const { captureException } = await import(
        "../../../../src/utils/posthogErrorCapture"
      );
      mockNurturing.identifyUser.mockRejectedValueOnce(
        new Error("CIO unavailable"),
      );

      expect(() =>
        fireSignupNurturingCalls({
          userId: "user-123",
          email: "jane@example.com",
          name: "Jane Doe",
          organizationId: "org-456",
          organizationName: "Acme Corp",
        }),
      ).not.toThrow();

      // Wait for the rejected promise to be caught
      await vi.waitFor(() => {
        expect(captureException).toHaveBeenCalled();
      });
    });
  });

  describe("when nurturing is undefined (no Customer.io key)", () => {
    it("silently skips without calling any nurturing methods", () => {
      currentNurturing = undefined;

      fireSignupNurturingCalls({
        userId: "user-123",
        email: "jane@example.com",
        name: "Jane Doe",
        organizationId: "org-456",
        organizationName: "Acme Corp",
      });

      expect(mockNurturing.identifyUser).not.toHaveBeenCalled();
      expect(mockNurturing.groupUser).not.toHaveBeenCalled();
      expect(mockNurturing.trackEvent).not.toHaveBeenCalled();
    });
  });
});
