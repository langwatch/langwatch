/**
 * Save-time Codex refusal: a new Codex value outside the licensed surfaces is
 * rejected; one already stored for a key stays savable when another key changes.
 *
 * @see specs/model-providers/codex-account-provider.feature
 * @see modules/topic/specs/model-resolution.feature
 */
import {
  CODEX_DEFAULT_MODEL,
  ModelDefaultValidationError,
} from "@langwatch/model-provider-contract";
import { beforeEach, describe, expect, it } from "vitest";

import { TestModelProviderCatalog } from "../../../../__tests__/support/model-provider-integration.support.ts";
import { MemoryModelDefaultRepository } from "../../../../repositories/memory/memory.model-default.repository.ts";
import { MemoryModelProviderDatabase } from "../../../../repositories/memory/memory.model-provider.database.ts";
import { ModelProviderDefaultsWriteService } from "../model-provider-defaults-write.service.ts";

const TOPIC_KEY = "analytics.topic_clustering_llm";
const OTHER_CODEX_MODEL = "openai_codex/gpt-5.6-other";
const SCOPE = { scopeType: "PROJECT", scopeId: "proj-1" } as const;

describe("ModelProviderDefaultsWriteService codex refusal", () => {
  let defaults: MemoryModelDefaultRepository;
  let writer: ModelProviderDefaultsWriteService;

  beforeEach(() => {
    defaults = MemoryModelDefaultRepository.create({
      database: MemoryModelProviderDatabase.create(),
    });
    writer = ModelProviderDefaultsWriteService.create({
      defaults,
      catalog: new TestModelProviderCatalog(),
      scopes: {
        getOrganizationIdForScope: async () => "org-1",
        getOrganizationIdForScopes: async () => "org-1",
      } as never,
      ids: { generate: () => "cfg-1" } as never,
      writeAuthorization: {} as never,
    });
  });

  describe("given a DEFAULT role default set to a codex model", () => {
    /** @scenario "The server refuses Codex outside the allowed surfaces" */
    it("refuses the write", async () => {
      await expect(
        writer.save({
          config: { DEFAULT: CODEX_DEFAULT_MODEL },
          scopes: [SCOPE],
        } as never),
      ).rejects.toThrow(/coding-assistant surfaces only/);
    });
  });

  describe("given a new config with a codex value for topic clustering", () => {
    /** @scenario "Saving a new Codex model for topic clustering is still rejected" */
    it("refuses the create", async () => {
      await expect(
        writer.save({ config: { [TOPIC_KEY]: CODEX_DEFAULT_MODEL }, scopes: [SCOPE] } as never),
      ).rejects.toBeInstanceOf(ModelDefaultValidationError);
    });
  });

  describe("given a config storing a codex value for topic clustering", () => {
    beforeEach(async () => {
      await defaults.save({
        id: "cfg-1",
        organizationId: "org-1",
        config: { [TOPIC_KEY]: CODEX_DEFAULT_MODEL },
        scopes: [SCOPE],
        authorId: null,
      });
    });

    describe("when the config is saved back with the stored value unchanged and another key added", () => {
      /** @scenario "A saved Codex clustering override does not block other default-model changes" */
      it("saves and keeps the stored codex value untouched", async () => {
        await writer.save({
          id: "cfg-1",
          config: { [TOPIC_KEY]: CODEX_DEFAULT_MODEL, FAST: "openai/gpt-5-mini" },
          scopes: [SCOPE],
        } as never);

        expect((await defaults.getById("cfg-1")).config).toEqual({
          [TOPIC_KEY]: CODEX_DEFAULT_MODEL,
          FAST: "openai/gpt-5-mini",
        });
      });
    });

    describe("when a different codex value is written for topic clustering", () => {
      /** @scenario "Saving a new Codex model for topic clustering is still rejected" */
      it("refuses the write and leaves the stored config unchanged", async () => {
        await expect(
          writer.save({
            id: "cfg-1",
            config: { [TOPIC_KEY]: OTHER_CODEX_MODEL },
            scopes: [SCOPE],
          } as never),
        ).rejects.toBeInstanceOf(ModelDefaultValidationError);

        expect((await defaults.getById("cfg-1")).config).toEqual({
          [TOPIC_KEY]: CODEX_DEFAULT_MODEL,
        });
      });
    });
  });
});
