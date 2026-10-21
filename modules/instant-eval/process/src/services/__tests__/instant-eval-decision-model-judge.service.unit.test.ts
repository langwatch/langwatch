/**
 * Which judge a project's texts go to: the deployment's, or the leaf with the project's own
 * decision model, never LangWatch's in place of a broken own one (ADR-182).
 * @see specs/model-providers/instant-evals-decision-model.feature
 */

import type {
  InstantEvalClassification,
  InstantEvalJudgeApi,
  InstantEvalJudgement,
} from "@langwatch/instant-eval-judge-contract";
import type { DecisionModelResolution, ModelProviderApi } from "@langwatch/model-provider-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { DeterministicInstantEvalJudgeChannel } from "../../channels/memory/memory.instant-eval-judging.channel.ts";
import { InstantEvalDecisionModelJudgeService } from "../instant-eval-decision-model-judge.service.ts";

const OWN: DecisionModelResolution = {
  kind: "own",
  model: "inception/decisions:mercury-decide",
  wire: "jev",
  providerModel: "mercury-decide",
  endpoint: "https://api.inceptionlabs.ai/v1/decisions",
  apiKey: "customer-key",
};

const REQUEST = {
  projectId: "proj_1",
  text: "I am fed up",
  questions: [{ id: "annoyed", kind: "boolean" as const, instructions: "Annoyed?" }],
};

function harness(resolution: DecisionModelResolution) {
  const hostedCalls: string[] = [];
  const ownCalls: InstantEvalClassification[] = [];
  const resolutions: string[] = [];
  const deterministic = DeterministicInstantEvalJudgeChannel.create();
  const hosted = {
    limits: deterministic.limits,
    pricing: deterministic.pricing,
    classify: async (request: Parameters<typeof deterministic.classify>[0]) => {
      hostedCalls.push(request.projectId);
      return deterministic.classify(request);
    },
  };
  const judge = InstantEvalDecisionModelJudgeService.create({
    hosted,
    own: createApiFixture<InstantEvalJudgeApi>(
      {
        classify: async (input): Promise<InstantEvalJudgement> => {
          ownCalls.push(input);
          return { verdicts: [], inputTokens: 0, isTextTruncated: false };
        },
      },
      "InstantEvalJudgeApi",
    ),
    decisionModels: createApiFixture<ModelProviderApi>(
      {
        resolveDecisionModel: async ({ projectId }) => {
          resolutions.push(projectId);
          return resolution;
        },
      },
      "ModelProviderApi",
    ),
    now: () => Temporal.Instant.fromEpochMilliseconds(0),
  });
  return { judge, hostedCalls, ownCalls, resolutions };
}

describe("InstantEvalDecisionModelJudgeService", () => {
  describe("when the project runs on LangWatch Instant Preview", () => {
    it("classifies with the deployment's judge", async () => {
      const { judge, hostedCalls, ownCalls } = harness({ kind: "langwatch" });

      await judge.classify(REQUEST);

      expect(hostedCalls).toEqual(["proj_1"]);
      expect(ownCalls).toEqual([]);
      expect(await judge.isOwnDecisionModel({ projectId: "proj_1" })).toBe(false);
    });
  });

  describe("when the project runs on its own decision model", () => {
    /** @scenario "Instant Evals on an own decision model go to the judge with the key" */
    it("sends the text to the leaf with the own model and never to LangWatch's", async () => {
      const { judge, hostedCalls, ownCalls } = harness(OWN);

      await judge.classify(REQUEST);

      expect(hostedCalls).toEqual([]);
      expect(ownCalls).toHaveLength(1);
      expect(ownCalls[0]?.decisionModel).toMatchObject({
        model: "inception/decisions:mercury-decide",
        apiKey: "customer-key",
      });
      expect(await judge.isOwnDecisionModel({ projectId: "proj_1" })).toBe(true);
    });

    it("asks model provider once for a page of texts", async () => {
      const { judge, resolutions } = harness(OWN);

      await judge.classify(REQUEST);
      await judge.classify(REQUEST);

      expect(resolutions).toEqual(["proj_1"]);
    });
  });

  describe("when the project's own decision model cannot run", () => {
    /** @scenario "Instant Evals on an unavailable own decision model never fall back" */
    it("skips as classifier_key_invalid and calls no classifier", async () => {
      const { judge, hostedCalls, ownCalls } = harness({
        kind: "own_unavailable",
        model: OWN.kind === "own" ? OWN.model : "",
        reason: "key_missing",
      });

      const judgement = await judge.classify(REQUEST);

      expect(judgement.skippedReason).toBe("classifier_key_invalid");
      expect(hostedCalls).toEqual([]);
      expect(ownCalls).toEqual([]);
    });
  });

  describe("when the flag was switched off after the column was set", () => {
    /** @scenario "With the flag off an own decision model is not run and not moved onto the billed model" */
    it("skips as not configured and calls no classifier", async () => {
      const { judge, hostedCalls } = harness({
        kind: "own_unavailable",
        model: "openai/decisions:gpt-6-luna",
        reason: "not_enabled",
      });

      const judgement = await judge.classify(REQUEST);

      expect(judgement.skippedReason).toBe("classifier_not_configured");
      expect(hostedCalls).toEqual([]);
    });
  });
});
