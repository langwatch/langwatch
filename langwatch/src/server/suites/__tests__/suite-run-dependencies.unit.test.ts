import { describe, it, expect, vi } from "vitest";
import { createSuiteRunDependencies, getOrganizationIdForProject } from "../suite-run-dependencies";
import type { PrismaClient } from "@prisma/client";

function makeMockPrisma(overrides: {
  scenarioFindMany?: ReturnType<typeof vi.fn>;
  llmPromptConfigFindMany?: ReturnType<typeof vi.fn>;
  agentFindMany?: ReturnType<typeof vi.fn>;
  projectFindUnique?: ReturnType<typeof vi.fn>;
} = {}) {
  return {
    scenario: {
      findMany: overrides.scenarioFindMany ?? vi.fn(() => Promise.resolve([])),
    },
    llmPromptConfig: {
      findMany: overrides.llmPromptConfigFindMany ?? vi.fn(() => Promise.resolve([])),
    },
    agent: {
      findMany: overrides.agentFindMany ?? vi.fn(() => Promise.resolve([])),
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
        const prisma = makeMockPrisma({
          scenarioFindMany: vi.fn(() => Promise.resolve([
            { id: "scen_1", archivedAt: null },
            { id: "scen_2", archivedAt: null },
          ])),
        });
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
        const prisma = makeMockPrisma({
          scenarioFindMany: vi.fn(() => Promise.resolve([
            { id: "scen_1", archivedAt: null },
            { id: "scen_2", archivedAt: new Date() },
          ])),
        });
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
        const prisma = makeMockPrisma({
          scenarioFindMany: vi.fn(() => Promise.resolve([
            { id: "scen_1", archivedAt: null },
          ])),
        });
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
        const prisma = makeMockPrisma({
          scenarioFindMany: vi.fn(() => Promise.resolve([
            { id: "scen_1", archivedAt: new Date() },
            { id: "scen_2", archivedAt: new Date() },
          ])),
        });
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

    it("uses a batched findMany query with in-clause", async () => {
      const findMany = vi.fn(() => Promise.resolve([
        { id: "scen_1", archivedAt: null },
      ]));
      const prisma = makeMockPrisma({ scenarioFindMany: findMany });
      const deps = createSuiteRunDependencies({ prisma });

      await deps.resolveScenarioReferences({
        ids: ["scen_1", "scen_2"],
        projectId: "proj_1",
      });

      expect(findMany).toHaveBeenCalledTimes(1);
      expect(findMany).toHaveBeenCalledWith({
        where: { id: { in: ["scen_1", "scen_2"] }, projectId: "proj_1" },
        select: { id: true, archivedAt: true },
      });
    });
  });

  describe("resolveTargetReferences", () => {
    describe("when type is 'prompt'", () => {
      describe("when prompt exists", () => {
        it("places it in the active list", async () => {
          const prisma = makeMockPrisma({
            llmPromptConfigFindMany: vi.fn(() => Promise.resolve([
              { id: "prompt_1" },
            ])),
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
        const findMany = vi.fn(() => Promise.resolve([{ id: "prompt_1" }]));
        const prisma = makeMockPrisma({ llmPromptConfigFindMany: findMany });
        const deps = createSuiteRunDependencies({ prisma });

        await deps.resolveTargetReferences({
          targets: [{ type: "prompt", referenceId: "prompt_1" }],
          projectId: "proj_1",
          organizationId: "org_1",
        });

        expect(findMany).toHaveBeenCalledWith({
          where: {
            id: { in: ["prompt_1"] },
            deletedAt: null,
            OR: [
              { projectId: "proj_1" },
              { organizationId: "org_1", scope: "ORGANIZATION" },
            ],
          },
          select: { id: true },
        });
      });
    });

    describe("when type is 'http'", () => {
      describe("when agent is active", () => {
        it("places it in the active list", async () => {
          const prisma = makeMockPrisma({
            agentFindMany: vi.fn(() => Promise.resolve([
              { id: "agent_1", archivedAt: null },
            ])),
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
            agentFindMany: vi.fn(() => Promise.resolve([
              { id: "agent_1", archivedAt: new Date() },
            ])),
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

      it("uses a batched findMany query with in-clause", async () => {
        const findMany = vi.fn(() => Promise.resolve([
          { id: "agent_1", archivedAt: null },
        ]));
        const prisma = makeMockPrisma({ agentFindMany: findMany });
        const deps = createSuiteRunDependencies({ prisma });

        await deps.resolveTargetReferences({
          targets: [{ type: "http", referenceId: "agent_1" }],
          projectId: "proj_1",
          organizationId: "org_1",
        });

        expect(findMany).toHaveBeenCalledTimes(1);
        expect(findMany).toHaveBeenCalledWith({
          where: { id: { in: ["agent_1"] }, projectId: "proj_1" },
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

    describe("when targets include both prompts and agents", () => {
      it("batches queries by type and resolves correctly", async () => {
        const llmPromptConfigFindMany = vi.fn(() => Promise.resolve([
          { id: "prompt_1" },
        ]));
        const agentFindMany = vi.fn(() => Promise.resolve([
          { id: "agent_1", archivedAt: null },
        ]));
        const prisma = makeMockPrisma({
          llmPromptConfigFindMany,
          agentFindMany,
        });
        const deps = createSuiteRunDependencies({ prisma });

        const result = await deps.resolveTargetReferences({
          targets: [
            { type: "prompt", referenceId: "prompt_1" },
            { type: "http", referenceId: "agent_1" },
          ],
          projectId: "proj_1",
          organizationId: "org_1",
        });

        expect(result.active).toEqual(["prompt_1", "agent_1"]);
        expect(result.archived).toEqual([]);
        expect(result.missing).toEqual([]);

        expect(llmPromptConfigFindMany).toHaveBeenCalledTimes(1);
        expect(llmPromptConfigFindMany).toHaveBeenCalledWith({
          where: {
            id: { in: ["prompt_1"] },
            deletedAt: null,
            OR: [
              { projectId: "proj_1" },
              { organizationId: "org_1", scope: "ORGANIZATION" },
            ],
          },
          select: { id: true },
        });

        expect(agentFindMany).toHaveBeenCalledTimes(1);
        expect(agentFindMany).toHaveBeenCalledWith({
          where: { id: { in: ["agent_1"] }, projectId: "proj_1" },
          select: { id: true, archivedAt: true },
        });
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
