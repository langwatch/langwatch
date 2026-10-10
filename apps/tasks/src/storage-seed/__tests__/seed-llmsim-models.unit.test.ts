import { describe, expect, it } from "vitest";

import { llmsimCustomModels } from "../storage-seed.ts";

describe("given the seed creates a model provider row", () => {
  /** @scenario "The seeded OpenAI provider offers llmsim's error models" */
  it("gives the OpenAI row llmsim's error models when haven marks llmsim", () => {
    const models = llmsimCustomModels({
      provider: "openai",
      environment: { HAVEN_SEED_LLMSIM_MODELS: "1" },
    });
    expect(models?.map((model) => model.modelId)).toEqual(["error-429", "error-500"]);
  });

  /** @scenario "The seeded OpenAI provider offers llmsim's error models" */
  it("adds nothing without the marker or to another provider", () => {
    expect(llmsimCustomModels({ provider: "openai", environment: {} })).toBeUndefined();
    expect(
      llmsimCustomModels({ provider: "anthropic", environment: { HAVEN_SEED_LLMSIM_MODELS: "1" } }),
    ).toBeUndefined();
  });
});
