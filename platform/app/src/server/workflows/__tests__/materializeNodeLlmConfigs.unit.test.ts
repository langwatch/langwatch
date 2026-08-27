/**
 * @vitest-environment node
 *
 * @see specs/workflows/workflow-node-owned-llm.feature
 *
 * The persistence chokepoint that guarantees every persisted llm
 * parameter carries a model — with an empty model-config cascade
 * (fresh install, env-key-only providers) it must still fill one in.
 * Seeding defaults is never a precondition for creating workflows.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ModelNotConfiguredError,
  type ModelProviderResolution,
} from "@langwatch/model-provider-contract";
import { TestModelProviderService } from "../../modelProviders/__tests__/model-provider-services.test-support";
import { DEFAULT_MODEL } from "../../../utils/constants";
import { materializeNodeLlmConfigs } from "../materializeNodeLlmConfigs";

const dslWith = (llmValue: unknown, extra?: Record<string, unknown>) => ({
  ...extra,
  nodes: [
    {
      data: {
        parameters: [
          { identifier: "llm", type: "llm", value: llmValue },
          { identifier: "instructions", type: "str", value: "hi" },
        ],
      },
    },
  ],
});

const workflowResolution: ModelProviderResolution = {
  model: "anthropic/claude-haiku-4-5-20251001",
  source: "role_default",
  scope: "project",
  feature: {
    key: "workflows.create_default",
    role: "DEFAULT",
    displayName: "New workflow model",
    description: "Starts new workflows with a ready-to-use model.",
  },
};

describe("materializeNodeLlmConfigs", () => {
  const modelProviders = new TestModelProviderService();
  const resolveModel = vi.spyOn(modelProviders, "resolveModelForFeature");

  beforeEach(() => {
    resolveModel.mockReset();
  });

  it("fills a modelless llm parameter from the cascade-resolved default", async () => {
    resolveModel.mockResolvedValue(workflowResolution);
    const dsl = dslWith(undefined);

    await materializeNodeLlmConfigs({ projectId: "p1", dsl, modelProviders });

    expect(resolveModel).toHaveBeenCalledWith({
      projectId: "p1",
      featureKey: "workflows.create_default",
    });
    expect(dsl.nodes[0]!.data.parameters[0]!.value).toEqual({
      model: "anthropic/claude-haiku-4-5-20251001",
    });
  });

  it("falls back to DEFAULT_MODEL when nothing is configured at any scope", async () => {
    resolveModel.mockRejectedValue(
      new ModelNotConfiguredError(
        "workflows.create_default",
        "DEFAULT",
        "New workflow model",
        "p1",
      ),
    );
    const dsl = dslWith({ model: "", temperature: 0.2 });

    await materializeNodeLlmConfigs({ projectId: "p1", dsl, modelProviders });

    expect(dsl.nodes[0]!.data.parameters[0]!.value).toEqual({
      model: DEFAULT_MODEL,
      temperature: 0.2,
    });
  });

  it("propagates unexpected resolver failures instead of pinning a model", async () => {
    resolveModel.mockRejectedValue(new Error("database is down"));
    const dsl = dslWith(undefined);

    await expect(
      materializeNodeLlmConfigs({ projectId: "p1", dsl, modelProviders }),
    ).rejects.toThrow("database is down");
    expect(dsl.nodes[0]!.data.parameters[0]!.value).toBeUndefined();
  });

  it("prefers the payload's legacy default_llm over the cascade and drops the field", async () => {
    const dsl = dslWith(undefined, {
      default_llm: { model: "openai/gpt-5-mini", max_tokens: 256 },
    });

    await materializeNodeLlmConfigs({ projectId: "p1", dsl, modelProviders });

    expect(resolveModel).not.toHaveBeenCalled();
    expect(dsl.nodes[0]!.data.parameters[0]!.value).toEqual({
      model: "openai/gpt-5-mini",
      max_tokens: 256,
    });
    expect("default_llm" in dsl).toBe(false);
  });

  it("leaves node-owned models untouched and skips the resolver entirely", async () => {
    const dsl = dslWith(
      { model: "gemini/gemini-2.5-flash" },
      { default_llm: { model: "openai/gpt-5-mini" } },
    );

    await materializeNodeLlmConfigs({ projectId: "p1", dsl, modelProviders });

    expect(resolveModel).not.toHaveBeenCalled();
    expect(dsl.nodes[0]!.data.parameters[0]!.value).toEqual({
      model: "gemini/gemini-2.5-flash",
    });
    expect("default_llm" in dsl).toBe(false);
  });
});
