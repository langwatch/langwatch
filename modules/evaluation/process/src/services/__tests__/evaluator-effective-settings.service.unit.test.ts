import { describe, expect, it } from "vitest";

import { EvaluatorEffectiveSettingsService } from "../evaluator-effective-settings.service.ts";
import { EvaluatorSettingsService } from "../evaluator-settings.service.ts";

function serviceWith(isDisabled: () => Promise<boolean>) {
  return EvaluatorEffectiveSettingsService.create({
    settings: EvaluatorSettingsService.create(),
    recovery: { isDisabled },
  });
}

const topLevelPrompt = { evaluatorType: "langevals/llm_boolean", prompt: "Is the reply polite?" };

describe("EvaluatorEffectiveSettingsService", () => {
  describe("when the evaluator has settings of its own", () => {
    it("answers them over the monitor's parameters", async () => {
      const answer = await serviceWith(async () => false).get({
        config: {
          evaluatorType: "langevals/competitor_blocklist",
          settings: { competitors: ["A"] },
        },
        parameters: { competitors: ["B"] },
        evaluatorRecordType: "evaluator",
      });

      expect(answer).toEqual({ settings: { competitors: ["A"] }, source: "config-settings" });
    });
  });

  describe("when the settings sit at the top of the config", () => {
    const query = {
      config: topLevelPrompt,
      parameters: { prompt: "Is the reply rude?" },
      evaluatorRecordType: "evaluator",
    };

    it("recovers them while the rollback switch is off", async () => {
      const answer = await serviceWith(async () => false).get(query);

      expect(answer).toEqual({
        settings: { prompt: "Is the reply polite?" },
        source: "top-level-recovery",
      });
    });

    it("answers the monitor's parameters once the operator has rolled the recovery back", async () => {
      const answer = await serviceWith(async () => true).get(query);

      expect(answer).toEqual({
        settings: { prompt: "Is the reply rude?" },
        source: "monitor-parameters",
      });
    });

    it("keeps the recovery active when the switch cannot be read", async () => {
      const answer = await serviceWith(async () => {
        throw new Error("flag store unreachable");
      }).get(query);

      expect(answer.source).toBe("top-level-recovery");
    });
  });
});
