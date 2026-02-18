import { describe, it, expect, vi } from "vitest";
import { createSuiteRunDependencies, getOrganizationIdForProject } from "../suite-run-dependencies";
import type { PrismaClient } from "@prisma/client";

function makeMockPrisma(overrides: {
  scenarioFindFirst?: ReturnType<typeof vi.fn>;
  llmPromptConfigFindFirst?: ReturnType<typeof vi.fn>;
  agentFindFirst?: ReturnType<typeof vi.fn>;
  projectFindUnique?: ReturnType<typeof vi.fn>;
} = {}) {
  return {
    scenario: {
      findFirst: overrides.scenarioFindFirst ?? vi.fn(() => Promise.resolve(null)),
    },
    llmPromptConfig: {
      findFirst: overrides.llmPromptConfigFindFirst ?? vi.fn(() => Promise.resolve(null)),
    },
    agent: {
      findFirst: overrides.agentFindFirst ?? vi.fn(() => Promise.resolve(null)),
    },
    project: {
      findUnique: overrides.projectFindUnique ?? vi.fn(() => Promise.resolve(null)),
    },
  } as unknown as PrismaClient;
}

describe("createSuiteRunDependencies()", () => {
  describe("validateScenarioExists", () => {
    describe("when scenario exists", () => {
      it("returns true", async () => {
        const prisma = makeMockPrisma({
          scenarioFindFirst: vi.fn(() =>
            Promise.resolve({ id: "scen_1" }),
          ),
        });
        const deps = createSuiteRunDependencies({ prisma });

        const result = await deps.validateScenarioExists({
          id: "scen_1",
          projectId: "proj_1",
        });

        expect(result).toBe(true);
      });

      it("queries with archivedAt: null", async () => {
        const findFirst = vi.fn(() => Promise.resolve({ id: "scen_1" }));
        const prisma = makeMockPrisma({ scenarioFindFirst: findFirst });
        const deps = createSuiteRunDependencies({ prisma });

        await deps.validateScenarioExists({
          id: "scen_1",
          projectId: "proj_1",
        });

        expect(findFirst).toHaveBeenCalledWith({
          where: { id: "scen_1", projectId: "proj_1", archivedAt: null },
        });
      });
    });

    describe("when scenario does not exist", () => {
      it("returns false", async () => {
        const prisma = makeMockPrisma();
        const deps = createSuiteRunDependencies({ prisma });

        const result = await deps.validateScenarioExists({
          id: "scen_missing",
          projectId: "proj_1",
        });

        expect(result).toBe(false);
      });
    });
  });

  describe("validateTargetExists", () => {
    describe("when type is 'prompt'", () => {
      describe("when prompt exists in same project", () => {
        it("returns true", async () => {
          const prisma = makeMockPrisma({
            llmPromptConfigFindFirst: vi.fn(() =>
              Promise.resolve({ id: "prompt_1" }),
            ),
          });
          const deps = createSuiteRunDependencies({ prisma });

          const result = await deps.validateTargetExists({
            referenceId: "prompt_1",
            type: "prompt",
            projectId: "proj_1",
            organizationId: "org_1",
          });

          expect(result).toBe(true);
        });
      });

      describe("when prompt is org-scoped from another project", () => {
        it("queries with OR pattern including org scope", async () => {
          const findFirst = vi.fn(() => Promise.resolve({ id: "prompt_org" }));
          const prisma = makeMockPrisma({ llmPromptConfigFindFirst: findFirst });
          const deps = createSuiteRunDependencies({ prisma });

          await deps.validateTargetExists({
            referenceId: "prompt_org",
            type: "prompt",
            projectId: "proj_1",
            organizationId: "org_1",
          });

          expect(findFirst).toHaveBeenCalledWith({
            where: {
              id: "prompt_org",
              deletedAt: null,
              OR: [
                { projectId: "proj_1" },
                { organizationId: "org_1", scope: "ORGANIZATION" },
              ],
            },
          });
        });

        it("returns true", async () => {
          const prisma = makeMockPrisma({
            llmPromptConfigFindFirst: vi.fn(() =>
              Promise.resolve({ id: "prompt_org" }),
            ),
          });
          const deps = createSuiteRunDependencies({ prisma });

          const result = await deps.validateTargetExists({
            referenceId: "prompt_org",
            type: "prompt",
            projectId: "proj_1",
            organizationId: "org_1",
          });

          expect(result).toBe(true);
        });
      });

      describe("when prompt does not exist", () => {
        it("returns false", async () => {
          const prisma = makeMockPrisma();
          const deps = createSuiteRunDependencies({ prisma });

          const result = await deps.validateTargetExists({
            referenceId: "prompt_missing",
            type: "prompt",
            projectId: "proj_1",
            organizationId: "org_1",
          });

          expect(result).toBe(false);
        });
      });

      describe("when prompt is soft-deleted", () => {
        it("returns false", async () => {
          // findFirst returns null because deletedAt filter excludes it
          const prisma = makeMockPrisma({
            llmPromptConfigFindFirst: vi.fn(() => Promise.resolve(null)),
          });
          const deps = createSuiteRunDependencies({ prisma });

          const result = await deps.validateTargetExists({
            referenceId: "prompt_deleted",
            type: "prompt",
            projectId: "proj_1",
            organizationId: "org_1",
          });

          expect(result).toBe(false);
        });

        it("queries with deletedAt: null to exclude soft-deleted prompts", async () => {
          const findFirst = vi.fn(() => Promise.resolve(null));
          const prisma = makeMockPrisma({ llmPromptConfigFindFirst: findFirst });
          const deps = createSuiteRunDependencies({ prisma });

          await deps.validateTargetExists({
            referenceId: "prompt_deleted",
            type: "prompt",
            projectId: "proj_1",
            organizationId: "org_1",
          });

          expect(findFirst).toHaveBeenCalledWith(
            expect.objectContaining({
              where: expect.objectContaining({ deletedAt: null }),
            }),
          );
        });
      });

      describe("when prompt belongs to a different organization", () => {
        it("returns false for org-scoped prompt from org_B accessed via org_A", async () => {
          // The mock returns null because the query filters by organizationId: "org_A"
          // but the prompt belongs to org_B
          const findFirst = vi.fn(() => Promise.resolve(null));
          const prisma = makeMockPrisma({ llmPromptConfigFindFirst: findFirst });
          const deps = createSuiteRunDependencies({ prisma });

          const result = await deps.validateTargetExists({
            referenceId: "prompt_org_b",
            type: "prompt",
            projectId: "proj_a",
            organizationId: "org_A",
          });

          expect(result).toBe(false);
          // Verify the query only allows access to prompts in org_A, not org_B
          expect(findFirst).toHaveBeenCalledWith({
            where: {
              id: "prompt_org_b",
              deletedAt: null,
              OR: [
                { projectId: "proj_a" },
                { organizationId: "org_A", scope: "ORGANIZATION" },
              ],
            },
          });
        });
      });
    });

    describe("when type is 'http'", () => {
      describe("when agent exists", () => {
        it("returns true", async () => {
          const prisma = makeMockPrisma({
            agentFindFirst: vi.fn(() =>
              Promise.resolve({ id: "agent_1" }),
            ),
          });
          const deps = createSuiteRunDependencies({ prisma });

          const result = await deps.validateTargetExists({
            referenceId: "agent_1",
            type: "http",
            projectId: "proj_1",
            organizationId: "org_1",
          });

          expect(result).toBe(true);
        });

        it("queries with archivedAt: null", async () => {
          const findFirst = vi.fn(() => Promise.resolve({ id: "agent_1" }));
          const prisma = makeMockPrisma({ agentFindFirst: findFirst });
          const deps = createSuiteRunDependencies({ prisma });

          await deps.validateTargetExists({
            referenceId: "agent_1",
            type: "http",
            projectId: "proj_1",
            organizationId: "org_1",
          });

          expect(findFirst).toHaveBeenCalledWith({
            where: { id: "agent_1", projectId: "proj_1", archivedAt: null },
          });
        });
      });

      describe("when agent does not exist", () => {
        it("returns false", async () => {
          const prisma = makeMockPrisma();
          const deps = createSuiteRunDependencies({ prisma });

          const result = await deps.validateTargetExists({
            referenceId: "agent_missing",
            type: "http",
            projectId: "proj_1",
            organizationId: "org_1",
          });

          expect(result).toBe(false);
        });
      });
    });

    describe("when type is unknown", () => {
      it("returns false", async () => {
        const prisma = makeMockPrisma();
        const deps = createSuiteRunDependencies({ prisma });

        const result = await deps.validateTargetExists({
          referenceId: "unknown_1",
          type: "unknown",
          projectId: "proj_1",
          organizationId: "org_1",
        });

        expect(result).toBe(false);
      });
    });
  });

  describe("getOrganizationIdForProject", () => {
    describe("when project has an organization", () => {
      it("returns the organizationId", async () => {
        const prisma = makeMockPrisma({
          projectFindUnique: vi.fn(() =>
            Promise.resolve({
              id: "proj_1",
              team: { organizationId: "org_1", organization: { id: "org_1" } },
            }),
          ),
        });

        const result = await getOrganizationIdForProject({ prisma, projectId: "proj_1" });

        expect(result).toBe("org_1");
      });
    });

    describe("when project does not exist", () => {
      it("returns null", async () => {
        const prisma = makeMockPrisma({
          projectFindUnique: vi.fn(() => Promise.resolve(null)),
        });

        const result = await getOrganizationIdForProject({ prisma, projectId: "proj_missing" });

        expect(result).toBeNull();
      });
    });

    describe("when project has no organizationId", () => {
      it("returns null", async () => {
        const prisma = makeMockPrisma({
          projectFindUnique: vi.fn(() =>
            Promise.resolve({
              id: "proj_1",
              team: { organizationId: null, organization: null },
            }),
          ),
        });

        const result = await getOrganizationIdForProject({ prisma, projectId: "proj_1" });

        expect(result).toBeNull();
      });
    });
  });
});
