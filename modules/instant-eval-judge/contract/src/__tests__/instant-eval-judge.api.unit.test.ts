/**
 * How every caller of the judge reads a project's own decision model (ADR-182 decisions 6 and 9).
 * @see specs/model-providers/instant-evals-decision-model.feature
 */

import { describe, expect, it } from "vitest";

import {
  instantEvalOwnDecisionModelOf,
  instantEvalUnavailableDecisionModelSkipOf,
  type InstantEvalOwnDecisionModel,
} from "../instant-eval-judge.api.ts";

describe("given a resolved own decision model", () => {
  describe("when it is handed to the judge", () => {
    it("carries only the fields the judge calls with", () => {
      const resolved: InstantEvalOwnDecisionModel & { kind: "own" } = {
        kind: "own",
        model: "openai/decisions:gpt-5-decision",
        wire: "openai_decisions",
        providerModel: "gpt-5-decision",
        endpoint: "https://api.openai.com/v1/decisions",
        apiKey: "sk-test",
      };

      expect(instantEvalOwnDecisionModelOf(resolved)).toEqual({
        model: "openai/decisions:gpt-5-decision",
        wire: "openai_decisions",
        providerModel: "gpt-5-decision",
        endpoint: "https://api.openai.com/v1/decisions",
        apiKey: "sk-test",
      });
    });
  });
});

describe("given an own decision model that cannot run", () => {
  describe("when the flag is off", () => {
    it("skips as not configured", () => {
      expect(instantEvalUnavailableDecisionModelSkipOf({ reason: "not_enabled" })).toBe(
        "classifier_not_configured",
      );
    });
  });

  describe.each(["provider_missing", "provider_disabled", "key_missing"])(
    "when its provider is unusable (%s)",
    (reason) => {
      it("skips as a key the project must fix", () => {
        expect(instantEvalUnavailableDecisionModelSkipOf({ reason })).toBe(
          "classifier_key_invalid",
        );
      });
    },
  );
});
