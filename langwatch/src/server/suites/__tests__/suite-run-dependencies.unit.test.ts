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
  describe("resolveScenarioReferences", () => {
    describe("when all scenarios are active", () => {
      it("returns all IDs in the active list", async () => {
        const findFirst = vi.fn()
          .mockResolvedValueOnce({ id: "scen_1", archivedAt: null })
          .mockResolvedValueOnce({ id: "scen_2", archivedAt: null });
        const prisma = makeMockPrisma({ scenarioFindFirst: findFirst });
        const deps = createSuiteRunDependencies({ prisma });

        const result = await deps.resolveScenarioReferences({
          ids: ["scen_1", "scen_2"],
          projectId: "proj_1",
        });

        expect(result).toEqual({
          active: ["scen_1", "scen_2"],
          archived: [],
          missing: [],
        });
      });
    });

    describe("when a scenario is archived", () => {
      it("places it in the archived list", async () => {
        const findFirst = vi.fn()
          .mockResolvedValueOnce({ id: "scen_1", archivedAt: null })
          .mockResolvedValueOnce({ id: "scen_2", archivedAt: new Date() });
        const prisma = makeMockPrisma({ scenarioFindFirst: findFirst });
        const deps = createSuiteRunDependencies({ prisma });

        const result = await deps.resolveScenarioReferences({
          ids: ["scen_1", "scen_2"],
          projectId: "proj_1",
        });

        expect(result).toEqual({
          active: ["scen_1"],
          archived: ["scen_2"],
          missing: [],
        });
      });
    });

    describe("when a scenario does not exist", () => {
      it("places it in the missing list", async () => {
        const findFirst = vi.fn()
          .mockResolvedValueOnce({ id: "scen_1", archivedAt: null })
          .mockResolvedValueOnce(null);
        const prisma = makeMockPrisma({ scenarioFindFirst: findFirst });
        const deps = createSuiteRunDependencies({ prisma });

        const result = await deps.resolveScenarioReferences({
          ids: ["scen_1", "scen_missing"],
          projectId: "proj_1",
        });

        expect(result).toEqual({
          active: ["scen_1"],
          archived: [],
          missing: ["scen_missing"],
        });
      });
    });

    describe("when all scenarios are archived", () => {
      it("returns an empty active list", async () => {
        const findFirst = vi.fn()
          .mockResolvedValueOnce({ id: "scen_1", archivedAt: new Date() })
          .mockResolvedValueOnce({ id: "scen_2", archivedAt: new Date() });
        const prisma = makeMockPrisma({ scenarioFindFirst: findFirst });
        const deps = createSuiteRunDependencies({ prisma });

        const result = await deps.resolveScenarioReferences({
          ids: ["scen_1", "scen_2"],
          projectId: "proj_1",
        });

        expect(result).toEqual({
          active: [],
          archived: ["scen_1", "scen_2"],
          missing: [],
        });
      });
    });

    it("queries without archivedAt filter to detect both active and archived", async () => {
      const findFirst = vi.fn(() => Promise.resolve({ id: "scen_1", archivedAt: null }));
      const prisma = makeMockPrisma({ scenarioFindFirst: findFirst });
      const deps = createSuiteRunDependencies({ prisma });

      await deps.resolveScenarioReferences({
        ids: ["scen_1"],
        projectId: "proj_1",
      });

      expect(findFirst).toHaveBeenCalledWith({
        where: { id: "scen_1", projectId: "proj_1" },
        select: { id: true, archivedAt: true },
      });
    });
  });

  describe("resolveTargetReferences", () => {
    describe("when type is 'prompt'", () => {
      describe("when prompt exists", () => {
        it("places it in the active list", async () => {
          const prisma = makeMockPrisma({
            llmPromptConfigFindFirst: vi.fn(() =>
              Promise.resolve({ id: "prompt_1" }),
            ),
          });
          const deps = createSuiteRunDependencies({ prisma });

          const result = await deps.resolveTargetReferences({
            targets: [{ type: "prompt", referenceId: "prompt_1" }],
            projectId: "proj_1",
            organizationId: "org_1",
          });

          expect(result.active).toEqual(["prompt_1"]);
          expect(result.archived).toEqual([]);
          expect(result.missing).toEqual([]);
        });
      });

      describe("when prompt does not exist", () => {
        it("places it in the missing list", async () => {
          const prisma = makeMockPrisma();
          const deps = createSuiteRunDependencies({ prisma });

          const result = await deps.resolveTargetReferences({
            targets: [{ type: "prompt", referenceId: "prompt_missing" }],
            projectId: "proj_1",
            organizationId: "org_1",
          });

          expect(result.missing).toEqual(["prompt_missing"]);
        });
      });

      it("queries with OR pattern including org scope", async () => {
        const findFirst = vi.fn(() => Promise.resolve({ id: "prompt_1" }));
        const prisma = makeMockPrisma({ llmPromptConfigFindFirst: findFirst });
        const deps = createSuiteRunDependencies({ prisma });

        await deps.resolveTargetReferences({
          targets: [{ type: "prompt", referenceId: "prompt_1" }],
          projectId: "proj_1",
          organizationId: "org_1",
        });

        expect(findFirst).toHaveBeenCalledWith({
          where: {
            id: "prompt_1",
            deletedAt: null,
            OR: [
              { projectId: "proj_1" },
              { organizationId: "org_1", scope: "ORGANIZATION" },
            ],
          },
        });
      });
    });

    describe("when type is 'http'", () => {
      describe("when agent is active", () => {
        it("places it in the active list", async () => {
          const prisma = makeMockPrisma({
            agentFindFirst: vi.fn(() =>
              Promise.resolve({ id: "agent_1", archivedAt: null }),
            ),
          });
          const deps = createSuiteRunDependencies({ prisma });

          const result = await deps.resolveTargetReferences({
            targets: [{ type: "http", referenceId: "agent_1" }],
            projectId: "proj_1",
            organizationId: "org_1",
          });

          expect(result.active).toEqual(["agent_1"]);
        });
      });

      describe("when agent is archived", () => {
        it("places it in the archived list", async () => {
          const prisma = makeMockPrisma({
            agentFindFirst: vi.fn(() =>
              Promise.resolve({ id: "agent_1", archivedAt: new Date() }),
            ),
          });
          const deps = createSuiteRunDependencies({ prisma });

          const result = await deps.resolveTargetReferences({
            targets: [{ type: "http", referenceId: "agent_1" }],
            projectId: "proj_1",
            organizationId: "org_1",
          });

          expect(result.archived).toEqual(["agent_1"]);
          expect(result.active).toEqual([]);
        });
      });

      describe("when agent does not exist", () => {
        it("places it in the missing list", async () => {
          const prisma = makeMockPrisma();
          const deps = createSuiteRunDependencies({ prisma });

          const result = await deps.resolveTargetReferences({
            targets: [{ type: "http", referenceId: "agent_missing" }],
            projectId: "proj_1",
            organizationId: "org_1",
          });

          expect(result.missing).toEqual(["agent_missing"]);
        });
      });

      it("queries without archivedAt filter to detect both active and archived", async () => {
        const findFirst = vi.fn(() => Promise.resolve({ id: "agent_1", archivedAt: null }));
        const prisma = makeMockPrisma({ agentFindFirst: findFirst });
        const deps = createSuiteRunDependencies({ prisma });

        await deps.resolveTargetReferences({
          targets: [{ type: "http", referenceId: "agent_1" }],
          projectId: "proj_1",
          organizationId: "org_1",
        });

        expect(findFirst).toHaveBeenCalledWith({
          where: { id: "agent_1", projectId: "proj_1" },
          select: { id: true, archivedAt: true },
        });
      });
    });

    describe("when type is unknown", () => {
      it("places it in the missing list", async () => {
        const prisma = makeMockPrisma();
        const deps = createSuiteRunDependencies({ prisma });

        const result = await deps.resolveTargetReferences({
          targets: [{ type: "unknown" as "http", referenceId: "unknown_1" }],
          projectId: "proj_1",
          organizationId: "org_1",
        });

        expect(result.missing).toEqual(["unknown_1"]);
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
