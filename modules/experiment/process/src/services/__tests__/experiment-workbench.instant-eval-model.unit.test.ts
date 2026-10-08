/**
 * Instant Evals answers evaluator judges only: a workbench save, a new workbench and a version
 * restore refuse a target that calls a model on it, before anything is stored.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */

import type { WorkbenchStateView } from "@langwatch/experiment-contract";
import { INSTANT_EVAL_JUDGE_MODEL_ID } from "@langwatch/instant-eval-judge-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import type { ExperimentRepository } from "../../repositories/experiment.repository.ts";
import { ExperimentWorkbenchService } from "../experiment-workbench.service.ts";

const promptTarget = (model: string) => ({
  id: "target_1",
  type: "prompt",
  localPromptConfig: { llm: { model }, messages: [], inputs: [], outputs: [] },
  mappings: {},
});

const judgeColumn = {
  id: "judge",
  evaluatorType: "langevals/llm_boolean",
  inputs: [],
  mappings: {},
  dbEvaluatorId: "evaluator_1",
  localEvaluatorConfig: { name: "Judge", settings: { model: INSTANT_EVAL_JUDGE_MODEL_ID } },
};

const state = (targets: unknown[]) => ({
  name: "My evaluation",
  datasets: [],
  activeDatasetId: "dataset_1",
  evaluators: [judgeColumn],
  targets,
});

const current: WorkbenchStateView = {
  experimentId: "experiment_1",
  slug: "my-evaluation",
  name: "My evaluation",
  state: state([promptTarget("openai/gpt-5-mini")]) as WorkbenchStateView["state"],
  version: 3,
  updatedAt: new Date("2026-09-24T10:00:00.000Z"),
};

const actor = { label: "user" } as const;
const refused = {
  code: "instant_eval_judge_only_model",
  httpStatus: 422,
  meta: { places: ["target 1"] },
};

function build({
  saveTarget,
  restorable = state([promptTarget(INSTANT_EVAL_JUDGE_MODEL_ID)]),
}: {
  saveTarget: "create" | "update";
  restorable?: unknown;
}) {
  const written: unknown[] = [];
  const repository = createApiFixture<ExperimentRepository>({
    findWorkbenchState: async () => current,
    resolveWorkbenchSaveTarget: async () =>
      saveTarget === "create" ? { kind: "create" } : { kind: "update", state: current },
    findWorkbenchVersion: async () => ({ autoSaved: false, state: restorable }),
    writeWorkbenchState: async (input) => {
      written.push(input);
      return {
        kind: "saved" as const,
        experimentId: "experiment_1",
        slug: "my-evaluation",
        version: 4,
      };
    },
    createWorkbenchState: async (input) => {
      written.push(input);
      return { id: input.id, slug: input.slug };
    },
  });
  const service = ExperimentWorkbenchService.create({
    repository,
    newId: () => "experiment_2",
    updates: { publish: async () => undefined } as never,
    slugs: { generateUnique: async ({ baseSlug }: { baseSlug: string }) => baseSlug } as never,
    references: { assertAllExist: async () => undefined } as never,
    draftNames: { findNextDraftName: async () => "Draft 1" },
  });
  return { service, written };
}

describe("ExperimentWorkbenchService and Instant Evals", () => {
  describe("given a prompt target whose unsaved prompt draft is on Instant Evals", () => {
    /** @scenario "A workflow or a workbench naming Instant Evals outside a judge is refused where it sits" */
    it("refuses the save, naming the target, and writes nothing", async () => {
      const { service, written } = build({ saveTarget: "update" });

      await expect(
        service.saveWorkbenchState({
          projectId: "project_1",
          id: "experiment_1",
          state: state([promptTarget(INSTANT_EVAL_JUDGE_MODEL_ID)]),
          actor,
        }),
      ).rejects.toMatchObject(refused);
      expect(written).toEqual([]);
    });

    /** @scenario "A workflow or a workbench naming Instant Evals outside a judge is refused where it sits" */
    it("refuses a new workbench and creates nothing", async () => {
      const { service, written } = build({ saveTarget: "create" });

      await expect(
        service.createEvaluationsV3({
          projectId: "project_1",
          state: state([promptTarget(INSTANT_EVAL_JUDGE_MODEL_ID)]),
          actor,
        }),
      ).rejects.toMatchObject(refused);
      expect(written).toEqual([]);
    });

    /** @scenario "A workflow or a workbench naming Instant Evals outside a judge is refused where it sits" */
    it("refuses to restore a version that holds it", async () => {
      const { service, written } = build({ saveTarget: "update" });

      await expect(
        service.restoreWorkbenchVersion({
          projectId: "project_1",
          id: "experiment_1",
          version: 2,
          actor,
        }),
      ).rejects.toMatchObject(refused);
      expect(written).toEqual([]);
    });
  });

  describe("given Instant Evals only on an evaluator column", () => {
    /** @scenario "A workbench whose evaluators judge on Instant Evals still saves" */
    it("saves", async () => {
      const { service, written } = build({ saveTarget: "update" });

      await service.saveWorkbenchState({
        projectId: "project_1",
        id: "experiment_1",
        state: state([promptTarget("openai/gpt-5-mini")]),
        actor,
      });

      expect(written).toHaveLength(1);
    });
  });
});
