/**
 * The second place the Codex licence is enforced.
 *
 * Choosing a Codex model as a feature's default is refused by the resolver.
 * This is the other end: a model arriving at execution anyway — a value saved
 * before the restriction existed, or a row reached by id — and it has to be
 * refused there too, or the licence holds only for new configuration.
 *
 * The check runs twice on purpose. Once on the model reference before any
 * lookup, and once on the provider the reference resolved to, because a model
 * id that does not look like Codex can still resolve to the Codex provider.
 */

import { describe, expect, it } from "vitest";
import { ModelRestrictedForExecutionError } from "@langwatch/model-provider-contract";
import { ModelProviderExecutionService } from "../model-provider-execution.service";

function executionWith(providers: Record<string, unknown>, rowById?: unknown) {
  return ModelProviderExecutionService.create({
    query: {
      getExecutionProviders: async () => providers,
      tryGetByIdForProject: async () => rowById ?? null,
      tryFindRowServingModel: async () => null,
    },
    catalog: {
      prepareExecution: async ({ parameters }: { parameters: Record<string, unknown> }) =>
        parameters,
      tryGetExecutionDefinition: () => null,
      tryGetExecutionValue: () => null,
      tryGetStoredExecutionValue: () => null,
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

  describe("given an ordinary model on a configured provider", () => {
    it("prepares it", async () => {
      const service = executionWith({ openai });

      await expect(prepare(service, "openai/gpt-5-mini")).resolves.toMatchObject({
        model: expect.stringContaining("gpt-5-mini"),
      });
    });
  });
});
