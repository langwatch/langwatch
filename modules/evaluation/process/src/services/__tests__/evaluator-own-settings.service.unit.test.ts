import { evaluatorSchema, type Evaluator } from "@langwatch/evaluator-contract";
import { describe, expect, it } from "vitest";

import { EvaluatorOwnSettingsService } from "../evaluator-own-settings.service.ts";
import { EvaluatorSettingsService } from "../evaluator-settings.service.ts";

function evaluator(input: { type?: Evaluator["type"]; config: Evaluator["config"] }): Evaluator {
  return evaluatorSchema.parse({
    id: "evaluator-1",
    projectId: "project-1",
    name: "Judge",
    slug: "judge",
    type: input.type ?? "evaluator",
    config: input.config,
    workflowId: null,
    copiedFromEvaluatorId: null,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

function serviceOver(input: {
  evaluator: Evaluator;
  recoveryDisabled?: () => Promise<boolean>;
}): EvaluatorOwnSettingsService {
  return EvaluatorOwnSettingsService.create({
    evaluators: { getById: async () => input.evaluator },
    settings: EvaluatorSettingsService.create(),
    settingsRecovery: { isDisabled: input.recoveryDisabled ?? (async () => false) },
  });
}

const lookup = { projectId: "project-1", evaluatorId: "evaluator-1" };
const topLevelPrompt = { evaluatorType: "langevals/llm_boolean", prompt: "Is it polite?" };

describe("EvaluatorOwnSettingsService", () => {
  describe("when the evaluator saved its settings under config.settings", () => {
    it("answers those settings, which the run uses over any monitor parameters", async () => {
      const service = serviceOver({
        evaluator: evaluator({ config: { settings: { model: "openai/gpt-5" } } }),
      });

      await expect(service.find(lookup)).resolves.toEqual({
        kind: "own",
        settings: { model: "openai/gpt-5" },
      });
    });
  });

  describe("when the evaluator has no config", () => {
    it("answers none, so the monitor's parameters run", async () => {
      await expect(
        serviceOver({ evaluator: evaluator({ config: null }) }).find(lookup),
      ).resolves.toEqual({ kind: "none" });
    });
  });

  describe("when the settings sit at the top level of the config", () => {
    it("answers the recovered settings, as the runner recovers them", async () => {
      await expect(
        serviceOver({ evaluator: evaluator({ config: topLevelPrompt }) }).find(lookup),
      ).resolves.toEqual({ kind: "own", settings: { prompt: "Is it polite?" } });
    });

    it("answers none for an evaluator kind the runner does not recover", async () => {
      await expect(
        serviceOver({ evaluator: evaluator({ type: "workflow", config: topLevelPrompt }) }).find(
          lookup,
        ),
      ).resolves.toEqual({ kind: "none" });
    });

    it("answers none while the operator has rolled the recovery back", async () => {
      const service = serviceOver({
        evaluator: evaluator({ config: topLevelPrompt }),
        recoveryDisabled: async () => true,
      });

      await expect(service.find(lookup)).resolves.toEqual({ kind: "none" });
    });

    it("keeps the recovery active when the rollback flag cannot be read", async () => {
      const service = serviceOver({
        evaluator: evaluator({ config: topLevelPrompt }),
        recoveryDisabled: () => Promise.reject(new Error("flag store unreachable")),
      });

      await expect(service.find(lookup)).resolves.toEqual({
        kind: "own",
        settings: { prompt: "Is it polite?" },
      });
    });
  });
});
