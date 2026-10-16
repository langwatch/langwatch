/**
 * The second place the Codex licence is enforced.
 */

import {
  expandLatestAlias,
  findModelProviderDefinition,
  ModelProviderNotFoundError,
  ModelRestrictedForExecutionError,
} from "@langwatch/model-provider-contract";
import { describe, expect, it } from "vitest";

import { ModelProviderExecutionService } from "../model-provider-execution.service.ts";

function executionWith(providers: Record<string, unknown>, rowById?: unknown) {
  return ModelProviderExecutionService.create({
    query: {
      getExecutionProviders: async () => providers,
      getByIdForProject: async () => {
        if (!rowById) throw new ModelProviderNotFoundError();
        return rowById;
      },
      findRowServingModel: async () => null,
    },
    catalog: {
      prepareExecution: async ({ parameters }: { parameters: Record<string, unknown> }) =>
        parameters,
      pickExecutionDefinition: () => null,
      pickExecutionValue: () => null,
      pickStoredExecutionValue: () => null,
    },
  } as never);
}

const openai = {
  provider: "openai",
  enabled: true,
  models: ["gpt-5-mini"],
  customKeys: { OPENAI_API_KEY: "key" },
};

const prepare = (service: ModelProviderExecutionService, model: string) =>
  service.prepare({ projectId: "project-1", model });

describe("ModelProviderExecutionService.prepare", () => {
  describe("given a Codex model", () => {
    it("refuses it before looking anything up", async () => {
      // No provider is configured at all here: the refusal cannot be coming
      // from the lookup, so it is the model reference itself being checked.
      const service = executionWith({});

      await expect(prepare(service, "openai_codex/gpt-5.6-terra")).rejects.toBeInstanceOf(
        ModelRestrictedForExecutionError,
      );
    });

    it("refuses with a code, so a caller need not read the sentence", async () => {
      const service = executionWith({});

      await expect(prepare(service, "openai_codex/gpt-5.6-terra")).rejects.toMatchObject({
        code: "model_restricted_for_execution",
      });
    });

    it("names the model it refused", async () => {
      const service = executionWith({});

      await expect(prepare(service, "openai_codex/gpt-5.6-terra")).rejects.toMatchObject({
        meta: expect.objectContaining({ model: "openai_codex/gpt-5.6-terra" }),
      });
    });

    it("still says the surfaces it is licensed for, which downstream readers match on", async () => {
      // The scenario error classifier turns thrown infra errors into customer
      // copy by looking for this phrase. Keeping it means adding the code did
      // not quietly change what that classifier sees.
      const service = executionWith({});

      await expect(prepare(service, "openai_codex/gpt-5.6-terra")).rejects.toThrow(
        /serves the coding-assistant surfaces only/,
      );
    });
  });

  describe("given a model whose id looks ordinary but resolves to the Codex provider", () => {
    it("refuses it on the second check", async () => {
      // This is why the gate runs twice. A row reached by id carries its own
      // provider, and the reference said nothing about Codex.
      const service = executionWith({}, { provider: "openai_codex", enabled: true, models: [] });

      await expect(prepare(service, "mp_abc123/gpt-5-mini")).rejects.toBeInstanceOf(
        ModelRestrictedForExecutionError,
      );
    });
  });

  describe("given a stored row addressed by id", () => {
    /** @scenario "A chat provider is proven by a generation, not by a listing" */
    it("prepares that row although its id carries no mp_ prefix", async () => {
      const row = { ...openai, provider: "openai", customKeys: { OPENAI_API_KEY: "row" } };
      const service = executionWith({}, row);

      await expect(
        service.prepareRow({ id: "provider_2abc", model: "gpt-5-mini", projectId: "project-1" }),
      ).resolves.toMatchObject({ model: "openai/gpt-5-mini" });
    });

    it("still refuses a row that resolves to the Codex provider", async () => {
      const service = executionWith({}, { provider: "openai_codex", enabled: true, models: [] });

      await expect(
        service.prepareRow({ id: "provider_2abc", model: "gpt-5-mini", projectId: "project-1" }),
      ).rejects.toBeInstanceOf(ModelRestrictedForExecutionError);
    });
  });

  describe("given an ordinary model on a configured provider", () => {
    it("prepares it", async () => {
      const service = executionWith({ openai });

      await expect(prepare(service, "openai/gpt-5-mini")).resolves.toMatchObject({
        model: expect.stringContaining("gpt-5-mini"),
      });
    });
  });

  describe("given a latest alias on a configured provider", () => {
    /** @scenario "The LiteLLM params carry the concrete model for an alias" */
    // @scenario An explicit alias handed to the model factory resolves before the provider lookup
    it("names the model the alias currently resolves to", async () => {
      // The catalog decides what the alias means today, so the expectation
      // reads the same resolver instead of pinning a model id that retires.
      const resolved = expandLatestAlias("openai/latest-mini");
      expect(resolved).not.toBe("openai/latest-mini");

      const service = executionWith({
        openai: { ...openai, models: [resolved.split("/")[1]] },
      });

      const prepared = await prepare(service, "openai/latest-mini");
      expect(prepared.model).toBe(resolved);
      expect(prepared.model).not.toContain("latest");
    });

    /** @scenario "A concrete model id is not rewritten" */
    it("passes a concrete model id through unchanged", async () => {
      const service = executionWith({ openai });

      const prepared = await prepare(service, "openai/gpt-5-mini");
      expect(prepared.model).toBe("openai/gpt-5-mini");
    });
  });

  describe("given a Gemini row whose stored keys carry a generic base_url", () => {
    /** @scenario "A Gemini or Vertex provider with a base URL reaches that host instead of Google's" */
    it("sends it as api_base, as the gateway wire does", async () => {
      const gemini = {
        provider: "gemini",
        enabled: true,
        models: ["gemini-2.5-flash"],
        customKeys: { GEMINI_API_KEY: "llmsim", base_url: "http://127.0.0.1:21651" },
      };
      const service = ModelProviderExecutionService.create({
        query: {
          getExecutionProviders: async () => ({ gemini }),
          getByIdForProject: async () => {
            throw new ModelProviderNotFoundError();
          },
          findRowServingModel: async () => null,
        },
        catalog: {
          prepareExecution: async ({ parameters }: { parameters: Record<string, unknown> }) =>
            parameters,
          pickExecutionDefinition: () => ({ apiKey: "GEMINI_API_KEY" }),
          pickExecutionValue: ({ key }: { key: string }) =>
            (gemini.customKeys as Record<string, string>)[key] ?? null,
          pickStoredExecutionValue: ({ key }: { key: string }) =>
            (gemini.customKeys as Record<string, string>)[key] ?? null,
        },
      } as never);

      const prepared = await prepare(service, "gemini/gemini-2.5-flash");

      expect(prepared).toMatchObject({ api_base: "http://127.0.0.1:21651" });
    });
  });

  describe("given a Vertex AI row with a stored service account", () => {
    const serviceAccount = '{"type":"service_account","project_id":"acme-ai"}';
    const vertex = {
      provider: "vertex_ai",
      enabled: true,
      models: ["gemini-2.5-flash"],
      customKeys: {
        GOOGLE_APPLICATION_CREDENTIALS: serviceAccount,
        VERTEXAI_PROJECT: "acme-ai",
        VERTEXAI_LOCATION: "us-central1",
      },
    };
    // The definition comes from the real registry, so the test fails if the
    // key the service reads drifts from the key the provider is stored under.
    const service = ModelProviderExecutionService.create({
      query: {
        getExecutionProviders: async () => ({ vertex_ai: vertex }),
        getByIdForProject: async () => {
          throw new ModelProviderNotFoundError();
        },
        findRowServingModel: async () => null,
      },
      catalog: {
        prepareExecution: async ({ parameters }: { parameters: Record<string, unknown> }) =>
          parameters,
        pickExecutionDefinition: ({ provider }: { provider: string }) => {
          const definition = findModelProviderDefinition(provider);
          return definition ? { apiKey: definition.apiKey, endpointKey: null } : null;
        },
        pickExecutionValue: ({ key }: { key: string }) =>
          (vertex.customKeys as Record<string, string>)[key] ?? null,
        pickStoredExecutionValue: ({ key }: { key: string }) =>
          (vertex.customKeys as Record<string, string>)[key] ?? null,
      },
    } as never);

    /** @scenario "A Vertex AI call carries the service account stored on the provider" */
    it("sends the stored service account as vertex_credentials, never as api_key", async () => {
      const prepared = await prepare(service, "vertex_ai/gemini-2.5-flash");

      expect(prepared).toMatchObject({
        vertex_credentials: serviceAccount,
        vertex_project: "acme-ai",
        vertex_location: "us-central1",
      });
      expect(prepared).not.toHaveProperty("api_key");
    });
  });
});
