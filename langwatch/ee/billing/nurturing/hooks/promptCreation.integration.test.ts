import { describe, it, expect, vi, beforeEach } from "vitest";
import { afterPromptCreated } from "./promptCreation";

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

const mockProjects = {
  resolveOrgAdmin: vi.fn().mockResolvedValue({
    userId: "admin-1",
    organizationId: "org-1",
    firstMessage: false,
  }),
};

vi.mock("../../../../src/server/app-layer/app", () => ({
  getApp: () => ({
    get nurturing() {
      return currentNurturing;
    },
    projects: mockProjects,
  }),
}));

function createMockPrisma({
  organizationId = "org-1",
  promptCount = 1,
}: {
  organizationId?: string;
  promptCount?: number;
} = {}) {
  return {
    project: {
      findUnique: vi.fn().mockResolvedValue({
        team: { organizationId },
      }),
    },
    llmPromptConfig: {
      count: vi.fn().mockResolvedValue(promptCount),
    },
  } as any;
}

describe("afterPromptCreated()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentNurturing = mockNurturing;
  });

  describe("given an organization with no prior prompts", () => {
    describe("when a user creates their first prompt via tRPC (userId provided)", () => {
      it("identifies user with has_prompts true and prompt_count 1", async () => {
        const prisma = createMockPrisma({ promptCount: 1 });

        afterPromptCreated({
          prisma,
          projectId: "proj-1",
          userId: "user-1",
        });

        await vi.waitFor(() => {
          expect(mockNurturing.identifyUser).toHaveBeenCalledWith({
            userId: "user-1",
            traits: { has_prompts: true, prompt_count: 1 },
          });
        });
      });

      it("tracks first_prompt_created event with project_id", async () => {
        const prisma = createMockPrisma({ promptCount: 1 });

        afterPromptCreated({
          prisma,
          projectId: "proj-1",
          userId: "user-1",
        });

        await vi.waitFor(() => {
          expect(mockNurturing.trackEvent).toHaveBeenCalledWith({
            userId: "user-1",
            event: "first_prompt_created",
            properties: { project_id: "proj-1" },
          });
        });
      });
    });
  });

  describe("given an organization that already has prompts", () => {
    describe("when a user creates another prompt", () => {
      it("identifies user with updated org-wide prompt_count", async () => {
        const prisma = createMockPrisma({ promptCount: 5 });

        afterPromptCreated({
          prisma,
          projectId: "proj-1",
          userId: "user-1",
        });

        await vi.waitFor(() => {
          expect(mockNurturing.identifyUser).toHaveBeenCalledWith({
            userId: "user-1",
            traits: { prompt_count: 5 },
          });
        });
      });

      it("does not fire first_prompt_created event", async () => {
        const prisma = createMockPrisma({ promptCount: 5 });

        afterPromptCreated({
          prisma,
          projectId: "proj-1",
          userId: "user-1",
        });

        await vi.waitFor(() => {
          expect(mockNurturing.identifyUser).toHaveBeenCalled();
        });

        expect(mockNurturing.trackEvent).not.toHaveBeenCalled();
      });
    });
  });

  describe("when created via REST API (no userId)", () => {
    it("resolves userId via resolveOrgAdmin", async () => {
      const prisma = createMockPrisma({ promptCount: 1 });
      mockProjects.resolveOrgAdmin.mockResolvedValueOnce({
        userId: "admin-1",
        organizationId: "org-1",
        firstMessage: false,
      });

      afterPromptCreated({
        prisma,
        projectId: "proj-1",
        // no userId provided
      });

      await vi.waitFor(() => {
        expect(mockProjects.resolveOrgAdmin).toHaveBeenCalledWith("proj-1");
      });

      await vi.waitFor(() => {
        expect(mockNurturing.identifyUser).toHaveBeenCalledWith({
          userId: "admin-1",
          traits: { has_prompts: true, prompt_count: 1 },
        });
      });
    });

    it("uses organizationId from resolveOrgAdmin for counting", async () => {
      const prisma = createMockPrisma({ promptCount: 3 });
      mockProjects.resolveOrgAdmin.mockResolvedValueOnce({
        userId: "admin-1",
        organizationId: "org-resolved",
        firstMessage: false,
      });

      afterPromptCreated({
        prisma,
        projectId: "proj-1",
      });

      await vi.waitFor(() => {
        expect(prisma.llmPromptConfig.count).toHaveBeenCalledWith({
          where: {
            organizationId: "org-resolved",
            deletedAt: null,
            versions: { some: {} },
          },
        });
      });
    });
  });

  describe("when Customer.io API is unavailable", () => {
    it("does not throw (fire-and-forget)", async () => {
      const { captureException } = await import(
        "../../../../src/utils/posthogErrorCapture"
      );
      const prisma = createMockPrisma({ promptCount: 1 });
      mockNurturing.identifyUser.mockRejectedValueOnce(
        new Error("CIO unavailable"),
      );

      expect(() =>
        afterPromptCreated({
          prisma,
          projectId: "proj-1",
          userId: "user-1",
        }),
      ).not.toThrow();

      await vi.waitFor(() => {
        expect(captureException).toHaveBeenCalled();
      });
    });
  });

  describe("when Prisma query fails", () => {
    it("captures the error and does not throw", async () => {
      const { captureException } = await import(
        "../../../../src/utils/posthogErrorCapture"
      );
      const prisma = createMockPrisma();
      prisma.project.findUnique.mockRejectedValueOnce(
        new Error("DB unavailable"),
      );

      expect(() =>
        afterPromptCreated({
          prisma,
          projectId: "proj-1",
          userId: "user-1",
        }),
      ).not.toThrow();

      await vi.waitFor(() => {
        expect(captureException).toHaveBeenCalled();
      });
    });
  });

  describe("when no admin user can be resolved", () => {
    it("skips nurturing calls without throwing", async () => {
      const prisma = createMockPrisma();
      mockProjects.resolveOrgAdmin.mockResolvedValueOnce({
        userId: null,
        organizationId: null,
        firstMessage: false,
      });

      afterPromptCreated({
        prisma,
        projectId: "proj-1",
        // no userId
      });

      // Give async code time to complete
      await new Promise((r) => setTimeout(r, 50));

      expect(mockNurturing.identifyUser).not.toHaveBeenCalled();
      expect(mockNurturing.trackEvent).not.toHaveBeenCalled();
    });
  });

  describe("when nurturing is undefined (no Customer.io key)", () => {
    it("silently skips without calling any nurturing methods", async () => {
      currentNurturing = undefined;
      const prisma = createMockPrisma({ promptCount: 1 });

      afterPromptCreated({
        prisma,
        projectId: "proj-1",
        userId: "user-1",
      });

      // Give async code time to complete
      await new Promise((r) => setTimeout(r, 50));

      expect(mockNurturing.identifyUser).not.toHaveBeenCalled();
      expect(mockNurturing.trackEvent).not.toHaveBeenCalled();
    });
  });
});
