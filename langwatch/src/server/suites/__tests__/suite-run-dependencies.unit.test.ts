import { describe, it, expect, vi } from "vitest";
import { createSuiteRunDependencies } from "../suite-run-dependencies";
import type { PrismaClient } from "@prisma/client";

function makeMockPrisma(overrides: {
  scenarioFindFirst?: ReturnType<typeof vi.fn>;
  llmPromptConfigFindFirst?: ReturnType<typeof vi.fn>;
  agentFindFirst?: ReturnType<typeof vi.fn>;
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
      describe("when prompt exists", () => {
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
          });

          expect(result).toBe(false);
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
        });

        expect(result).toBe(false);
      });
    });
  });
});
