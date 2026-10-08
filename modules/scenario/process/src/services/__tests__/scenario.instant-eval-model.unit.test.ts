/**
 * Instant Evals answers evaluator judges only, so a scenario write naming it as the judge or the
 * simulator is refused in the service, whichever door it came through, before anything is stored.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 * @vitest-environment node
 */
import {
  INSTANT_EVAL_JUDGE_MODEL_ID,
  InstantEvalJudgeOnlyModelError,
} from "@langwatch/instant-eval-judge-contract";
import type { Scenario, ScenarioVersionDetail } from "@langwatch/scenario-contract";
import { describe, expect, it, vi } from "vitest";

import { MemoryScenarioRepository } from "../../repositories/memory/memory.scenario.repository.ts";
import { ScenarioService, type ScenarioServiceOptions } from "../scenario.service.ts";

const projectId = "project_1";

function scenarios() {
  const repository = MemoryScenarioRepository.create();
  let counter = 0;
  const service = ScenarioService.create({
    repository,
    simulations: {} as ScenarioServiceOptions["simulations"],
    ids: { next: () => `scenario_${++counter}` },
    testSuiteIds: { next: () => `suite_${++counter}` },
    clock: {} as ScenarioServiceOptions["clock"],
  });

  return { service, repository };
}

function scenarioOn({ judgeModel = null, simulatorModel = null }: Partial<Scenario>) {
  return {
    projectId,
    name: "Refund request",
    situation: "The caller wants a refund.",
    criteria: ["Offers the refund policy"],
    labels: [],
    judgeModel,
    simulatorModel,
  };
}

/** A scenario row written straight to the store, as one saved before the rule would be. */
function storedScenario({
  repository,
  model,
}: {
  repository: MemoryScenarioRepository;
  model: string;
}) {
  return repository.create({
    ...scenarioOn({ judgeModel: model }),
    id: "scenario_stored",
    actor: { userId: null, label: "api" },
  });
}

function versionOn(model: string): ScenarioVersionDetail {
  return {
    version: 1,
    authorId: null,
    authorLabel: null,
    changeDescription: "Created",
    changedFields: [],
    createdAt: new Date(0),
    isSynthesized: false,
    schemaVersion: 1,
    fields: {
      name: "Refund request",
      situation: "The caller wants a refund.",
      criteria: [],
      labels: [],
      parameters: null,
      simulatorModel: model,
      judgeModel: null,
      maxTurns: null,
      minTurns: null,
    },
  };
}

describe("ScenarioService with Instant Evals as a scenario model", () => {
  describe.each([
    ["judge", { judgeModel: INSTANT_EVAL_JUDGE_MODEL_ID }],
    ["simulator", { simulatorModel: INSTANT_EVAL_JUDGE_MODEL_ID }],
  ] as const)("when a new scenario names it as the %s", (_role, models) => {
    /** @scenario "Saving Instant Evals as the model of anything but a judge is refused" */
    it("refuses as a client error and stores nothing", async () => {
      const { service, repository } = scenarios();

      await expect(service.create(scenarioOn(models))).rejects.toThrow(
        InstantEvalJudgeOnlyModelError,
      );
      expect(repository.rows.size).toBe(0);
    });
  });

  describe("when a scenario update names it", () => {
    /** @scenario "Saving Instant Evals as the model of anything but a judge is refused" */
    it("refuses as a client error and keeps the stored model", async () => {
      const { service, repository } = scenarios();
      const created = await service.create(scenarioOn({ judgeModel: "openai/gpt-5-mini" }));

      await expect(
        service.update({ id: created.id, projectId, simulatorModel: INSTANT_EVAL_JUDGE_MODEL_ID }),
      ).rejects.toThrow(InstantEvalJudgeOnlyModelError);
      expect(repository.rows.get(created.id)?.simulatorModel).toBeNull();
    });
  });

  describe("when a scenario stored with it before the rule is duplicated", () => {
    /** @scenario "Saving Instant Evals as the model of anything but a judge is refused" */
    it("refuses the duplicate and stores no copy", async () => {
      const { service, repository } = scenarios();
      await storedScenario({ repository, model: INSTANT_EVAL_JUDGE_MODEL_ID });

      await expect(service.duplicate({ scenarioId: "scenario_stored", projectId })).rejects.toThrow(
        InstantEvalJudgeOnlyModelError,
      );
      expect([...repository.rows.keys()]).toEqual(["scenario_stored"]);
    });

    /** @scenario "A prompt or an agent stored with Instant Evals before this rule still reads" */
    it("still takes an update that leaves its models alone", async () => {
      const { service, repository } = scenarios();
      await storedScenario({ repository, model: INSTANT_EVAL_JUDGE_MODEL_ID });

      const renamed = await service.update({ id: "scenario_stored", projectId, name: "Renamed" });

      expect(renamed.name).toBe("Renamed");
    });
  });

  describe("when a restored version names it", () => {
    /** @scenario "Saving Instant Evals as the model of anything but a judge is refused" */
    it("refuses as a client error and restores nothing", async () => {
      const { service, repository } = scenarios();
      await storedScenario({ repository, model: "openai/gpt-5-mini" });
      vi.spyOn(repository, "findVersion").mockResolvedValue(versionOn(INSTANT_EVAL_JUDGE_MODEL_ID));
      const restoreVersion = vi.spyOn(repository, "restoreVersion");

      await expect(
        service.restoreVersion({
          scenarioId: "scenario_stored",
          projectId,
          version: 1,
          actor: { userId: null, label: "api" },
        }),
      ).rejects.toThrow(InstantEvalJudgeOnlyModelError);
      expect(restoreVersion).not.toHaveBeenCalled();
    });
  });

  describe("when the scenario is on any other model", () => {
    /** @scenario "Copying, restoring or duplicating on any other model still saves" */
    it("stores the duplicate and restores the version", async () => {
      const { service, repository } = scenarios();
      await storedScenario({ repository, model: "openai/gpt-5-mini" });
      vi.spyOn(repository, "findVersion").mockResolvedValue(versionOn("openai/gpt-5-mini"));
      const restoreVersion = vi
        .spyOn(repository, "restoreVersion")
        .mockResolvedValue({} as Scenario);

      const copy = await service.duplicate({ scenarioId: "scenario_stored", projectId });
      await service.restoreVersion({
        scenarioId: "scenario_stored",
        projectId,
        version: 1,
        actor: { userId: null, label: "api" },
      });

      expect(copy.judgeModel).toBe("openai/gpt-5-mini");
      expect(restoreVersion).toHaveBeenCalledOnce();
    });
  });
});
