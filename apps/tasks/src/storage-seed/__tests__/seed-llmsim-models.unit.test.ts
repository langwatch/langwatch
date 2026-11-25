import { describe, expect, it } from "vitest";

import { llmsimCustomModels, llmsimProviderKeys, llmsimRowModels } from "../storage-seed.ts";

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

describe("given haven routes models at llmsim", () => {
  const environment = { HAVEN_SEED_LLMSIM_BASE_URL: "http://127.0.0.1:21651" };

  /** @scenario "haven seeds Gemini and Vertex providers at llmsim" */
  it("seeds a Gemini row and a Vertex row whose base_url is llmsim", () => {
    const gemini = llmsimProviderKeys({ provider: "gemini", environment });
    const vertex = llmsimProviderKeys({ provider: "vertex_ai", environment });

    expect(gemini).toMatchObject({ base_url: "http://127.0.0.1:21651" });
    expect(gemini?.GEMINI_API_KEY).toBeTruthy();
    expect(vertex).toMatchObject({
      base_url: "http://127.0.0.1:21651",
      VERTEXAI_PROJECT: expect.any(String),
      VERTEXAI_LOCATION: expect.any(String),
    });
    expect(() => JSON.parse(vertex?.GOOGLE_APPLICATION_CREDENTIALS ?? "")).not.toThrow();
  });

  /** @scenario "haven seeds Gemini and Vertex providers at llmsim" */
  it("seeds a Bedrock row whose base_url is llmsim unless real AWS keys are named", () => {
    expect(llmsimProviderKeys({ provider: "bedrock", environment })).toMatchObject({
      base_url: "http://127.0.0.1:21651",
      AWS_REGION_NAME: expect.any(String),
    });
    expect(
      llmsimProviderKeys({
        provider: "bedrock",
        environment: { ...environment, AWS_ACCESS_KEY_ID: "AKIAREAL" },
      }),
    ).toBeUndefined();
  });

  /** @scenario "haven seeds Gemini and Vertex providers at llmsim" */
  it("leaves a developer's own Gemini or Vertex account and every other provider alone", () => {
    expect(
      llmsimProviderKeys({
        provider: "gemini",
        environment: { ...environment, GEMINI_API_KEY: "real" },
      }),
    ).toBeUndefined();
    expect(
      llmsimProviderKeys({
        provider: "vertex_ai",
        environment: { ...environment, GOOGLE_APPLICATION_CREDENTIALS: "{}" },
      }),
    ).toBeUndefined();
    expect(llmsimProviderKeys({ provider: "openai", environment })).toBeUndefined();
    expect(llmsimProviderKeys({ provider: "gemini", environment: {} })).toBeUndefined();
  });
});

describe("given a seeded llmsim Vertex or Bedrock row", () => {
  /** @scenario "haven seeds Gemini and Vertex providers at llmsim" */
  it("offers a custom model, since the catalogue lists none for either", () => {
    expect(llmsimRowModels({ provider: "vertex_ai" })?.map((model) => model.modelId)).toEqual([
      "gemini-2.5-flash",
    ]);
    expect(llmsimRowModels({ provider: "bedrock" })?.map((model) => model.modelId)).toEqual([
      "anthropic.claude-3-5-sonnet-20240620-v1:0",
    ]);
    expect(llmsimRowModels({ provider: "gemini" })).toBeUndefined();
  });
});
