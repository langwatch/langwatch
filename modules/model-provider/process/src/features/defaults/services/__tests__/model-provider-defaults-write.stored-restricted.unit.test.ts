/**
 * Full-config default writes over a restricted model stored before the
 * restriction (specs/model-providers/codex-account-provider.feature).
 */
import type { ModelDefaultConfig } from "@langwatch/model-provider-contract";
import { describe, expect, it } from "vitest";

import {
  idService,
  TestModelProviderCatalog,
} from "../../../../__tests__/support/model-provider-integration.support.ts";
import type { ModelDefaultRepository } from "../../../../repositories/model-default.repository.ts";
import type { ModelProviderScopeService } from "../../../../services/model-provider-scope.service.ts";
import { ModelProviderDefaultsWriteService } from "../model-provider-defaults-write.service.ts";

const CODEX_MODEL = "openai_codex/gpt-5.6-terra";
const TOPIC_CLUSTERING = "analytics.topic_clustering_llm";
const SCOPE = { scopeType: "PROJECT" as const, scopeId: "project-1" };

function writerOver(existing: ModelDefaultConfig) {
  const saved: Record<string, string>[] = [];
  const defaults = {
    getById: async () => existing,
    save: async (input: { config: Record<string, string> }) => {
      saved.push(input.config);
      return { ...existing, config: input.config };
    },
  } as unknown as ModelDefaultRepository;
  const scopes = {
    getOrganizationIdForScopes: async () => "organization-1",
  } as unknown as ModelProviderScopeService;
  const writer = ModelProviderDefaultsWriteService.create({
    defaults,
    catalog: new TestModelProviderCatalog(),
    writeAuthorization: {} as never,
    ids: idService,
    scopes,
  });
  return { writer, saved };
}

function storedConfig(config: Record<string, string>): ModelDefaultConfig {
  return { id: "config-1", config, scopes: [SCOPE], authorId: null, createdAt: new Date() };
}

describe("ModelProviderDefaultsWriteService.save", () => {
  describe("given a stored config holding a codex model for topic clustering", () => {
    const existing = storedConfig({
      FAST: CODEX_MODEL,
      DEFAULT: "openai/gpt-5-mini",
      [TOPIC_CLUSTERING]: CODEX_MODEL,
    });

    describe("when the whole config is saved again with another model changed", () => {
      /** @scenario "Saving model defaults still works over a stored Codex clustering model" */
      it("saves and drops the codex model from topic clustering", async () => {
        const { writer, saved } = writerOver(existing);

        await writer.save({
          id: existing.id,
          config: { ...existing.config, DEFAULT: "openai/gpt-5" },
        });

        expect(saved).toEqual([{ FAST: CODEX_MODEL, DEFAULT: "openai/gpt-5" }]);
      });
    });
  });

  describe("given a stored config with no topic clustering model", () => {
    const existing = storedConfig({ DEFAULT: "openai/gpt-5-mini" });

    describe("when a codex model is picked for topic clustering", () => {
      /** @scenario "Newly picking a Codex model for topic clustering is still refused" */
      it("refuses the save with a validation error", async () => {
        const { writer, saved } = writerOver(existing);

        await expect(
          writer.save({
            id: existing.id,
            config: { ...existing.config, [TOPIC_CLUSTERING]: CODEX_MODEL },
          }),
        ).rejects.toMatchObject({ code: "validation_error" });
        expect(saved).toEqual([]);
      });
    });
  });
});
