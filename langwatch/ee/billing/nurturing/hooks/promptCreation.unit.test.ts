import { describe, it, expect, vi, beforeEach } from "vitest";
import { firePromptCreatedNurturing } from "./promptCreation";

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

describe("firePromptCreatedNurturing()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentNurturing = mockNurturing;
  });

  describe("given an organization with no prompts", () => {
    describe("when a user creates their first prompt", () => {
      it("identifies user with has_prompts true and prompt_count 1", async () => {
        firePromptCreatedNurturing({
          userId: "user-1",
          projectId: "proj-1",
          orgPromptCount: 1,
        });

        expect(mockNurturing.identifyUser).toHaveBeenCalledWith({
          userId: "user-1",
          traits: { has_prompts: true, prompt_count: 1 },
        });
      });

      it("tracks first_prompt_created event with project_id", async () => {
        firePromptCreatedNurturing({
          userId: "user-1",
          projectId: "proj-1",
          orgPromptCount: 1,
        });

        expect(mockNurturing.trackEvent).toHaveBeenCalledWith({
          userId: "user-1",
          event: "first_prompt_created",
          properties: { project_id: "proj-1" },
        });
      });
    });
  });

  describe("given an organization that already has prompts", () => {
    describe("when a user creates another prompt", () => {
      it("identifies user with updated org-wide prompt_count", async () => {
        firePromptCreatedNurturing({
          userId: "user-1",
          projectId: "proj-1",
          orgPromptCount: 5,
        });

        expect(mockNurturing.identifyUser).toHaveBeenCalledWith({
          userId: "user-1",
          traits: { prompt_count: 5 },
        });
      });

      it("does not fire first_prompt_created event", async () => {
        firePromptCreatedNurturing({
          userId: "user-1",
          projectId: "proj-1",
          orgPromptCount: 5,
        });

        expect(mockNurturing.trackEvent).not.toHaveBeenCalled();
      });
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
        firePromptCreatedNurturing({
          userId: "user-1",
          projectId: "proj-1",
          orgPromptCount: 1,
        }),
      ).not.toThrow();

      await vi.waitFor(() => {
        expect(captureException).toHaveBeenCalled();
      });
    });
  });

  describe("when nurturing is undefined (no Customer.io key)", () => {
    it("silently skips without calling any nurturing methods", () => {
      currentNurturing = undefined;

      firePromptCreatedNurturing({
        userId: "user-1",
        projectId: "proj-1",
        orgPromptCount: 1,
      });

      expect(mockNurturing.identifyUser).not.toHaveBeenCalled();
      expect(mockNurturing.trackEvent).not.toHaveBeenCalled();
    });
  });
});
