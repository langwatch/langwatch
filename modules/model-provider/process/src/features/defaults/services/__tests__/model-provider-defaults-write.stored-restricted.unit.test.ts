/**
 * Full-config default writes over a restricted model stored before the
 * restriction (specs/model-providers/codex-account-provider.feature).
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import type {
  ModelProviderApiKeyValidation,
  ModelProviderCredentialVerdict,
} from "@langwatch/model-provider-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { MemoryModelProviderRepositories } from "../../../../repositories/memory/memory.model-provider.repositories.ts";
import { ModelProviderAuthorizationService } from "../../../../services/model-provider-authorization.service.ts";
import { ModelProviderScopeService } from "../../../../services/model-provider-scope.service.ts";
import { ModelProviderWriteAuthorizationService } from "../../../../services/model-provider-write-authorization.service.ts";
import { PrefixedModelProviderIdService } from "../../../../services/prefixed-model-provider-id.service.ts";
import { ModelProviderCatalog } from "../../../../services/registry-model-provider-catalog.service.ts";
import { ModelProviderDefaultsWriteService } from "../model-provider-defaults-write.service.ts";

/** The real catalog rules; only the network-facing members are inert. */
class OfflineModelProviderCatalog extends ModelProviderCatalog {
  systemProviders(): Promise<never[]> {
    return Promise.resolve([]);
  }
  validateApiKey(): Promise<ModelProviderApiKeyValidation> {
    return Promise.resolve({ valid: true });
  }
  testConnection(): Promise<ModelProviderCredentialVerdict> {
    throw new Error("not reached by a defaults write");
  }
  assertEndpointAllowed(): Promise<void> {
    return Promise.resolve();
  }
  pickExecutionValue(): string | null {
    return null;
  }
}

const CODEX_MODEL = "openai_codex/gpt-5.6-terra";
const TOPIC_CLUSTERING = "analytics.topic_clustering_llm";
const ORGANIZATION = "organization-1";
const SCOPE = { scopeType: "ORGANIZATION" as const, scopeId: ORGANIZATION };
const CONFIG_ID = "config-1";

async function writerOver(stored: Record<string, string>) {
  const { defaults } = MemoryModelProviderRepositories.create();
  await defaults.save({
    id: CONFIG_ID,
    organizationId: ORGANIZATION,
    config: stored,
    scopes: [SCOPE],
    authorId: null,
  });
  const scopes = ModelProviderScopeService.create({
    projects: createApiFixture<ProjectApi>({}, "ProjectApi"),
    organizations: createApiFixture<OrganizationApi>(
      {
        getBillingProfile: async ({ organizationId }) => ({
          id: organizationId,
          name: organizationId,
          billingCustomerId: null,
        }),
      },
      "OrganizationApi",
    ),
  });
  const writer = ModelProviderDefaultsWriteService.create({
    defaults,
    catalog: new OfflineModelProviderCatalog(),
    writeAuthorization: ModelProviderWriteAuthorizationService.create(
      ModelProviderAuthorizationService.create(createApiFixture<AuthzApi>({}, "AuthzApi")),
    ),
    ids: PrefixedModelProviderIdService.create(),
    scopes,
  });
  return { writer, defaults };
}

describe("ModelProviderDefaultsWriteService.save", () => {
  describe("given a stored config holding a codex model for topic clustering", () => {
    const stored = {
      FAST: CODEX_MODEL,
      DEFAULT: "openai/gpt-5-mini",
      [TOPIC_CLUSTERING]: CODEX_MODEL,
    };

    describe("when the whole config is saved again with another model changed", () => {
      /** @scenario "Saving model defaults still works over a stored Codex clustering model" */
      it("saves and drops the codex model from topic clustering", async () => {
        const { writer, defaults } = await writerOver(stored);

        await writer.save({ id: CONFIG_ID, config: { ...stored, DEFAULT: "openai/gpt-5" } });

        await expect(defaults.getById(CONFIG_ID)).resolves.toMatchObject({
          config: { FAST: CODEX_MODEL, DEFAULT: "openai/gpt-5" },
        });
      });
    });
  });

  describe("given a stored config whose only model is a codex clustering model", () => {
    const stored = { [TOPIC_CLUSTERING]: CODEX_MODEL };

    describe("when the config is saved again without clearing it", () => {
      /** @scenario "Saving a config whose only model is a stored Codex clustering model is refused, not deleted" */
      it("refuses the save and deletes nothing", async () => {
        const { writer, defaults } = await writerOver(stored);

        await expect(
          writer.save({
            id: CONFIG_ID,
            scopes: [SCOPE, { scopeType: "PROJECT" as const, scopeId: "project-2" }],
          }),
        ).rejects.toMatchObject({ code: "validation_error" });
        await expect(defaults.getById(CONFIG_ID)).resolves.toMatchObject({
          config: stored,
          scopes: [SCOPE],
        });
      });
    });
  });

  describe("given a stored config holding only a retired feature key", () => {
    const stored = { "retired.feature": "openai/gpt-5-mini" };

    describe("when the config is saved again", () => {
      /** @scenario "A config left with only retired keys is removed on save, not refused" */
      it("removes the config instead of refusing it", async () => {
        const { writer, defaults } = await writerOver(stored);

        await writer.save({ id: CONFIG_ID, config: stored });

        await expect(defaults.getById(CONFIG_ID)).rejects.toMatchObject({
          code: "model_default_not_found",
        });
      });
    });
  });

  describe("given a stored config with no topic clustering model", () => {
    const stored = { DEFAULT: "openai/gpt-5-mini" };

    describe("when a codex model is picked for topic clustering", () => {
      /** @scenario "Newly picking a Codex model for topic clustering is still refused" */
      it("refuses the save with a validation error", async () => {
        const { writer, defaults } = await writerOver(stored);

        await expect(
          writer.save({ id: CONFIG_ID, config: { ...stored, [TOPIC_CLUSTERING]: CODEX_MODEL } }),
        ).rejects.toMatchObject({ code: "validation_error" });
        await expect(defaults.getById(CONFIG_ID)).resolves.toMatchObject({ config: stored });
      });
    });
  });
});
