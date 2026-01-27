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
  describe("create", () => {
    describe("given a registry with a prompt factory", () => {
      const fakePromptFactory: TargetAdapterFactory = {
        supports: (type) => type === "prompt",
        create: async () => ({
          success: true as const,
          adapter: { name: "PromptAdapter" } as any,
        }),
      };
      let registry: TargetAdapterRegistry;

      beforeEach(() => {
        registry = new TargetAdapterRegistry([fakePromptFactory]);
      });

      describe("when creating a prompt adapter", () => {
        it("delegates to matching factory and returns adapter", async () => {
          const result = await registry.create({
            projectId: "proj_123",
            target: { type: "prompt", referenceId: "prompt_123" },
            modelParams: { api_key: "key", model: "gpt-4" },
            nlpServiceUrl: "http://localhost",
          });

          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.adapter.name).toBe("PromptAdapter");
          }
        });
      });
    });

    describe("given a registry with no factories", () => {
      let registry: TargetAdapterRegistry;

      beforeEach(() => {
        registry = new TargetAdapterRegistry([]);
      });

      describe("when creating an adapter for unknown type", () => {
        it("returns error with unknown target type message", async () => {
          const result = await registry.create({
            projectId: "proj_123",
            target: { type: "unknown" as any, referenceId: "ref_123" },
            modelParams: { api_key: "key", model: "gpt-4" },
            nlpServiceUrl: "http://localhost",
          });

          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.error).toContain("Unknown target type");
          }
        });
      });
    });

    describe("given multiple factories that support the same type", () => {
      const factory1: TargetAdapterFactory = {
        supports: (type) => type === "prompt",
        create: async () => ({ success: true as const, adapter: { name: "First" } as any }),
      };
      const factory2: TargetAdapterFactory = {
        supports: (type) => type === "prompt",
        create: async () => ({ success: true as const, adapter: { name: "Second" } as any }),
      };
      let registry: TargetAdapterRegistry;

      beforeEach(() => {
        registry = new TargetAdapterRegistry([factory1, factory2]);
      });

      describe("when creating an adapter", () => {
        it("uses first matching factory", async () => {
          const result = await registry.create({
            projectId: "proj_123",
            target: { type: "prompt", referenceId: "prompt_123" },
            modelParams: { api_key: "key", model: "gpt-4" },
            nlpServiceUrl: "http://localhost",
          });

          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.adapter.name).toBe("First");
          }
        });
      });
    });
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

  describe("supports", () => {
    it("returns true for prompt type", () => {
      const factory = createFactory();
      expect(factory.supports("prompt")).toBe(true);
    });

    it("returns false for http type", () => {
      const factory = createFactory();
      expect(factory.supports("http")).toBe(false);
    });
  });

  describe("create", () => {
    describe("given prompt exists with model configured", () => {
      describe("when creating adapter", () => {
        it("returns success with adapter", async () => {
          const factory = createFactory();

          const result = await factory.create({
            projectId: "proj_123",
            target: { type: "prompt", referenceId: "prompt_123" },
            modelParams: defaultParams,
            nlpServiceUrl: "http://localhost",
          });

          expect(result.success).toBe(true);
        });
      });
    });

    describe("given prompt does not exist", () => {
      describe("when creating adapter", () => {
        it("returns failure with not found error", async () => {
          const factory = createFactory({
            promptLookup: { getPromptByIdOrHandle: async () => null },
          });

          const result = await factory.create({
            projectId: "proj_123",
            target: { type: "prompt", referenceId: "nonexistent" },
            modelParams: defaultParams,
            nlpServiceUrl: "http://localhost",
          });

          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.error).toContain("not found");
          }
        });
      });
    });

    describe("given prompt has no model configured", () => {
      const promptWithoutModel = {
        id: "prompt_123",
        prompt: "You are helpful",
        messages: [],
        model: undefined,
        temperature: 0.7,
        maxTokens: 100,
      };

      describe("when creating adapter", () => {
        it("returns failure with clear error message", async () => {
          const factory = createFactory({
            promptLookup: { getPromptByIdOrHandle: async () => promptWithoutModel },
          });

          const result = await factory.create({
            projectId: "proj_123",
            target: { type: "prompt", referenceId: "prompt_123" },
            modelParams: defaultParams,
            nlpServiceUrl: "http://localhost",
          });

          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.error).toBe("Prompt prompt_123 does not have a model configured");
          }
        });
      });
    });

    describe("given model params preparation fails", () => {
      describe("when creating adapter", () => {
        it("returns failure with model params error", async () => {
          const factory = createFactory({
            modelParamsProvider: { prepare: async () => null },
          });

          const result = await factory.create({
            projectId: "proj_123",
            target: { type: "prompt", referenceId: "prompt_123" },
            modelParams: defaultParams,
            nlpServiceUrl: "http://localhost",
          });

          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.error).toContain("model params");
          }
        });
      });
    });
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

  describe("supports", () => {
    it("returns true for http type", () => {
      const factory = createFactory();
      expect(factory.supports("http")).toBe(true);
    });

    it("returns false for prompt type", () => {
      const factory = createFactory();
      expect(factory.supports("prompt")).toBe(false);
    });
  });

  describe("create", () => {
    describe("given HTTP agent exists", () => {
      describe("when creating adapter", () => {
        it("returns success with adapter", async () => {
          const factory = createFactory();

          const result = await factory.create({
            projectId: "proj_123",
            target: { type: "http", referenceId: "agent_123" },
            modelParams: { api_key: "key", model: "gpt-4" },
            nlpServiceUrl: "http://localhost",
          });

          expect(result.success).toBe(true);
        });
      });
    });

    describe("given agent does not exist", () => {
      describe("when creating adapter", () => {
        it("returns failure with not found error", async () => {
          const factory = createFactory({
            agentLookup: { findById: async () => null },
          });

          const result = await factory.create({
            projectId: "proj_123",
            target: { type: "http", referenceId: "nonexistent" },
            modelParams: { api_key: "key", model: "gpt-4" },
            nlpServiceUrl: "http://localhost",
          });

          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.error).toContain("not found");
          }
        });
      });
    });

    describe("given agent is wrong type", () => {
      describe("when creating adapter", () => {
        it("returns failure with not an HTTP agent error", async () => {
          const factory = createFactory({
            agentLookup: {
              findById: async () => ({
                ...defaultAgent,
                type: "llm",
              }),
            },
          });

          const result = await factory.create({
            projectId: "proj_123",
            target: { type: "http", referenceId: "agent_123" },
            modelParams: { api_key: "key", model: "gpt-4" },
            nlpServiceUrl: "http://localhost",
          });

          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.error).toContain("not an HTTP agent");
          }
        });
      });
    });
  });
});
