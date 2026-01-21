/**
 * @vitest-environment node
 *
 * Unit tests for adapter factories.
 *
 * Tests the OCP-compliant factory pattern for creating adapters.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { TargetAdapterRegistry } from "../adapters/adapter.registry";
import type { AdapterCreationContext, TargetAdapterFactory } from "../adapters/adapter.types";
import { HttpAdapterFactory, type AgentLookup } from "../adapters/http.adapter.factory";
import {
  PromptAdapterFactory,
  type ModelParamsProvider,
  type PromptLookup,
} from "../adapters/prompt.adapter.factory";

describe("TargetAdapterRegistry", () => {
  it("delegates to matching factory", async () => {
    // Given: a registry with a prompt factory
    const fakePromptFactory: TargetAdapterFactory = {
      supports: (type) => type === "prompt",
      create: async () => ({
        success: true as const,
        adapter: { name: "PromptAdapter" } as any,
      }),
    };
    const registry = new TargetAdapterRegistry([fakePromptFactory]);

    // When: creating a prompt adapter
    const result = await registry.create({
      projectId: "proj_123",
      target: { type: "prompt", referenceId: "prompt_123" },
      modelParams: { api_key: "key", model: "gpt-4" },
      nlpServiceUrl: "http://localhost",
    });

    // Then: returns the adapter
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.adapter.name).toBe("PromptAdapter");
    }
  });

  it("returns error for unknown target type", async () => {
    // Given: a registry with no factories
    const registry = new TargetAdapterRegistry([]);

    // When: creating an adapter for unknown type
    const result = await registry.create({
      projectId: "proj_123",
      target: { type: "unknown" as any, referenceId: "ref_123" },
      modelParams: { api_key: "key", model: "gpt-4" },
      nlpServiceUrl: "http://localhost",
    });

    // Then: returns failure
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("Unknown target type");
    }
  });

  it("uses first matching factory when multiple could match", async () => {
    // Given: two factories that both support "prompt"
    const factory1: TargetAdapterFactory = {
      supports: (type) => type === "prompt",
      create: async () => ({ success: true as const, adapter: { name: "First" } as any }),
    };
    const factory2: TargetAdapterFactory = {
      supports: (type) => type === "prompt",
      create: async () => ({ success: true as const, adapter: { name: "Second" } as any }),
    };
    const registry = new TargetAdapterRegistry([factory1, factory2]);

    // When: creating
    const result = await registry.create({
      projectId: "proj_123",
      target: { type: "prompt", referenceId: "prompt_123" },
      modelParams: { api_key: "key", model: "gpt-4" },
      nlpServiceUrl: "http://localhost",
    });

    // Then: uses first factory
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.adapter.name).toBe("First");
    }
  });
});

describe("PromptAdapterFactory", () => {
  const defaultPrompt = {
    id: "prompt_123",
    prompt: "You are helpful",
    messages: [],
    model: "openai/gpt-4",
    temperature: 0.7,
    maxTokens: 100,
  };

  const defaultParams = { api_key: "key", model: "gpt-4" };

  function createFactory(overrides?: {
    promptLookup?: Partial<PromptLookup>;
    modelParamsProvider?: Partial<ModelParamsProvider>;
  }): PromptAdapterFactory {
    const promptLookup: PromptLookup = {
      getPromptByIdOrHandle: async () => defaultPrompt,
      ...overrides?.promptLookup,
    };
    const modelParamsProvider: ModelParamsProvider = {
      prepare: async () => defaultParams,
      ...overrides?.modelParamsProvider,
    };
    return new PromptAdapterFactory(promptLookup, modelParamsProvider);
  }

  it("supports prompt type", () => {
    const factory = createFactory();
    expect(factory.supports("prompt")).toBe(true);
    expect(factory.supports("http")).toBe(false);
  });

  it("returns success when prompt exists", async () => {
    // Given: prompt exists
    const factory = createFactory();

    // When: creating adapter
    const result = await factory.create({
      projectId: "proj_123",
      target: { type: "prompt", referenceId: "prompt_123" },
      modelParams: defaultParams,
      nlpServiceUrl: "http://localhost",
    });

    // Then: returns success with adapter
    expect(result.success).toBe(true);
  });

  it("returns failure when prompt not found", async () => {
    // Given: prompt doesn't exist
    const factory = createFactory({
      promptLookup: { getPromptByIdOrHandle: async () => null },
    });

    // When: creating adapter
    const result = await factory.create({
      projectId: "proj_123",
      target: { type: "prompt", referenceId: "nonexistent" },
      modelParams: defaultParams,
      nlpServiceUrl: "http://localhost",
    });

    // Then: returns failure
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("not found");
    }
  });

  it("returns failure when model params cannot be prepared", async () => {
    // Given: model params provider fails
    const factory = createFactory({
      modelParamsProvider: { prepare: async () => null },
    });

    // When: creating adapter
    const result = await factory.create({
      projectId: "proj_123",
      target: { type: "prompt", referenceId: "prompt_123" },
      modelParams: defaultParams,
      nlpServiceUrl: "http://localhost",
    });

    // Then: returns failure
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("model params");
    }
  });
});

describe("HttpAdapterFactory", () => {
  const defaultAgent = {
    id: "agent_123",
    type: "http",
    config: {
      url: "https://api.example.com",
      method: "POST",
      headers: [],
    },
  };

  function createFactory(overrides?: {
    agentLookup?: Partial<AgentLookup>;
  }): HttpAdapterFactory {
    const agentLookup: AgentLookup = {
      findById: async () => defaultAgent,
      ...overrides?.agentLookup,
    };
    return new HttpAdapterFactory(agentLookup);
  }

  it("supports http type", () => {
    const factory = createFactory();
    expect(factory.supports("http")).toBe(true);
    expect(factory.supports("prompt")).toBe(false);
  });

  it("returns success when agent exists", async () => {
    // Given: agent exists
    const factory = createFactory();

    // When: creating adapter
    const result = await factory.create({
      projectId: "proj_123",
      target: { type: "http", referenceId: "agent_123" },
      modelParams: { api_key: "key", model: "gpt-4" },
      nlpServiceUrl: "http://localhost",
    });

    // Then: returns success
    expect(result.success).toBe(true);
  });

  it("returns failure when agent not found", async () => {
    // Given: agent doesn't exist
    const factory = createFactory({
      agentLookup: { findById: async () => null },
    });

    // When: creating adapter
    const result = await factory.create({
      projectId: "proj_123",
      target: { type: "http", referenceId: "nonexistent" },
      modelParams: { api_key: "key", model: "gpt-4" },
      nlpServiceUrl: "http://localhost",
    });

    // Then: returns failure
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("not found");
    }
  });

  it("returns failure when agent is wrong type", async () => {
    // Given: agent exists but is not HTTP type
    const factory = createFactory({
      agentLookup: {
        findById: async () => ({
          ...defaultAgent,
          type: "llm",
        }),
      },
    });

    // When: creating adapter
    const result = await factory.create({
      projectId: "proj_123",
      target: { type: "http", referenceId: "agent_123" },
      modelParams: { api_key: "key", model: "gpt-4" },
      nlpServiceUrl: "http://localhost",
    });

    // Then: returns failure
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("not an HTTP agent");
    }
  });
});
