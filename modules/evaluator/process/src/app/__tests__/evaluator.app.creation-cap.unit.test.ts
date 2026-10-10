import { describe, expect, it, vi } from "vitest";

import { MemoryEvaluatorRepository } from "../../repositories/memory/memory.evaluator.repository.ts";
import { createEvaluatorTestApp } from "./evaluator.fixture.ts";

/** The cloud Free caps (specs/licensing/cloud-free-creation-caps.feature). */
const CLOUD_FREE = { maxScenarios: 3, maxScenarioSets: 3, maxEvaluators: 3 };

async function organizationWithEvaluators(count: number): Promise<MemoryEvaluatorRepository> {
  const repository = MemoryEvaluatorRepository.create();
  for (let index = 0; index < count; index++) {
    await repository.create({
      id: `evaluator-${index}`,
      projectId: index % 2 === 0 ? "project-1" : "project-2",
      name: `Judge ${index}`,
      type: "evaluator",
      config: { evaluatorType: "ragas/faithfulness" },
    });
  }
  return repository;
}

describe("EvaluatorModule creation cap", () => {
  describe("given the organization is on the cloud Free plan with 3 custom evaluators", () => {
    /** @scenario Cloud Free refuses a fourth custom evaluator */
    /** @scenario Creating a fourth custom evaluator in the app is refused with the upgrade shape */
    it("refuses another evaluator with the limit shape", async () => {
      const repository = await organizationWithEvaluators(3);
      const { app } = createEvaluatorTestApp({ repository, plan: CLOUD_FREE });

      await expect(
        app.create({
          id: "evaluator-new",
          projectId: "project-1",
          name: "Fourth",
          type: "evaluator",
          config: { evaluatorType: "ragas/faithfulness" },
        }),
      ).rejects.toMatchObject({
        code: "resource_limit_exceeded",
        httpStatus: 403,
        meta: { limitType: "evaluators", current: 3, max: 3 },
      });
    });

    /** @scenario Creating a fourth custom evaluator through the API is refused with the limit shape */
    it("refuses the public API's create the same way", async () => {
      const repository = await organizationWithEvaluators(3);
      const { app } = createEvaluatorTestApp({ repository, plan: CLOUD_FREE });

      await expect(
        app.createWithResolvedDefaults({
          projectId: "project-1",
          name: "Fourth",
          config: { evaluatorType: "ragas/faithfulness" },
        }),
      ).rejects.toMatchObject({ meta: { limitType: "evaluators", current: 3, max: 3 } });
    });

    it("refuses a create against models the caller already resolved", async () => {
      const repository = await organizationWithEvaluators(3);
      const { app } = createEvaluatorTestApp({ repository, plan: CLOUD_FREE });

      await expect(
        app.createWithDefaults({
          id: "evaluator-new",
          projectId: "project-1",
          name: "Fourth",
          type: "evaluator",
          config: { evaluatorType: "ragas/faithfulness" },
        }),
      ).rejects.toMatchObject({ meta: { limitType: "evaluators", current: 3, max: 3 } });
    });

    /** @scenario Copying a custom evaluator past the cap is refused with the limit shape */
    it("refuses copying an evaluator into another project", async () => {
      const repository = await organizationWithEvaluators(3);
      const { app } = createEvaluatorTestApp({ repository, plan: CLOUD_FREE });

      await expect(
        app.copy({
          evaluatorId: "evaluator-0",
          projectId: "project-2",
          sourceProjectId: "project-1",
          newEvaluatorId: "evaluator-copy",
          actorId: "user-1",
        }),
      ).rejects.toMatchObject({ meta: { limitType: "evaluators", current: 3, max: 3 } });
    });

    /** @scenario Copying an online evaluation is not capped */
    it("lets an online evaluation's copy bring its evaluator along", async () => {
      const repository = await organizationWithEvaluators(3);
      const { app } = createEvaluatorTestApp({ repository, plan: CLOUD_FREE });

      const copied = await app.copy({
        evaluatorId: "evaluator-0",
        projectId: "project-2",
        sourceProjectId: "project-1",
        newEvaluatorId: "evaluator-copy",
        actorId: "user-1",
        shouldCheckEvaluatorCap: false,
      });

      expect(copied.id).toBe("evaluator-copy");
    });

    /** @scenario Saving a workflow as a fourth custom evaluator is refused with the limit shape */
    it("refuses saving a workflow as an evaluator before any flag changes", async () => {
      const repository = await organizationWithEvaluators(3);
      const setWorkflowFlags = vi.fn(async () => void 0);
      const { app } = createEvaluatorTestApp({
        repository,
        plan: CLOUD_FREE,
        workflows: {
          findWorkflowFlags: async () => ({ id: "workflow-9", name: "Judge flow" }) as never,
          setWorkflowFlags,
        },
      });

      await expect(
        app.toggleSaveAsEvaluator({
          workflowId: "workflow-9",
          projectId: "project-1",
          isEvaluator: true,
        }),
      ).rejects.toMatchObject({ meta: { limitType: "evaluators", current: 3, max: 3 } });
      expect(setWorkflowFlags).not.toHaveBeenCalled();
    });
  });

  describe("given the organization is on the cloud Free plan with 2 custom evaluators", () => {
    it("allows another evaluator", async () => {
      const repository = await organizationWithEvaluators(2);
      const { app } = createEvaluatorTestApp({ repository, plan: CLOUD_FREE });

      const created = await app.create({
        id: "evaluator-new",
        projectId: "project-1",
        name: "Third",
        type: "evaluator",
        config: { evaluatorType: "ragas/faithfulness" },
      });

      expect(created.id).toBe("evaluator-new");
    });
  });

  describe("given a plan that sets no evaluator cap", () => {
    it("never counts", async () => {
      const repository = await organizationWithEvaluators(10);
      const count = vi.spyOn(repository, "countActiveByProjects");
      const { app } = createEvaluatorTestApp({ repository });

      await app.create({
        id: "evaluator-new",
        projectId: "project-1",
        name: "Eleventh",
        type: "evaluator",
        config: { evaluatorType: "ragas/faithfulness" },
      });

      expect(count).not.toHaveBeenCalled();
    });
  });
});
