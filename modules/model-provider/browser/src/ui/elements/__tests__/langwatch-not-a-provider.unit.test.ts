/**
 * LangWatch draws a model mark for Instant Evals, which it serves itself; it is never a provider.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import { modelProviders } from "@langwatch/model-provider-contract";
import { describe, expect, it } from "vitest";

describe("model provider registry", () => {
  describe("given LangWatch has a model mark", () => {
    /** @scenario "The LangWatch mark names a model, never a provider to add" */
    it("does not list LangWatch as a provider to add or configure", () => {
      expect(Object.keys(modelProviders)).not.toContain("langwatch");
    });
  });
});
