/**
 * The evaluator create resolves a default model per role. Which roles it asks
 * the cascade for is read off the evaluator's settings schema, because that is
 * the only place a resolved model is ever written
 * (`getEvaluatorDefaultSettings` maps `model` and `embeddings_model` and
 * nothing else). Asking for a role the type does not carry is what refused a
 * `ragas/faithfulness` create on an organization with no embeddings default.
 */
import { describe, expect, it } from "vitest";

import {
  getEvaluatorDefinitions,
  getEvaluatorModelSettingFields,
} from "../getEvaluator";

describe("given an evaluator type", () => {
  describe("when its settings carry model but no embeddings_model", () => {
    /** @scenario A type whose settings carry no embeddings_model asks for no embeddings model */
    it("needs the default chat model only", () => {
      expect(
        getEvaluatorModelSettingFields(
          getEvaluatorDefinitions("ragas/faithfulness"),
        ),
      ).toEqual({ hasModel: true, hasEmbeddingsModel: false });
    });
  });

  describe("when its settings carry both model and embeddings_model", () => {
    /** @scenario A type whose settings carry embeddings_model asks for both */
    it("needs both", () => {
      expect(
        getEvaluatorModelSettingFields(
          getEvaluatorDefinitions("ragas/response_relevancy"),
        ),
      ).toEqual({ hasModel: true, hasEmbeddingsModel: true });
    });
  });

  describe("when its settings carry neither", () => {
    /** @scenario A type with neither field asks for no model at all */
    it("needs no model", () => {
      expect(
        getEvaluatorModelSettingFields(
          getEvaluatorDefinitions("langevals/exact_match"),
        ),
      ).toEqual({ hasModel: false, hasEmbeddingsModel: false });
    });
  });

  describe("when the definition carries no settings schema at all", () => {
    /** @scenario An unknown or custom evaluator asks for no model at all */
    it("needs no model", () => {
      expect(getEvaluatorModelSettingFields(undefined)).toEqual({
        hasModel: false,
        hasEmbeddingsModel: false,
      });
      expect(
        getEvaluatorModelSettingFields({
          name: "A workflow evaluator",
          requiredFields: ["input"],
        }),
      ).toEqual({ hasModel: false, hasEmbeddingsModel: false });
    });
  });
});
