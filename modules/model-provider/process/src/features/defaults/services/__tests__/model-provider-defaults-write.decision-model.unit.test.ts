/**
 * Default writes of the Instant Evals column: decision models only, and an own one only with
 * the flag (specs/model-providers/instant-evals-decision-model.feature).
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import type {
  ModelDefaultScope,
  ModelProvider,
  ModelProviderApiKeyValidation,
  ModelProviderCredentialVerdict,
} from "@langwatch/model-provider-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { createModelProviderTestProjects } from "../../../../app/__tests__/model-provider.fixture.ts";
import { MemoryModelProviderRepositories } from "../../../../repositories/memory/memory.model-provider.repositories.ts";
import { ModelProviderAuthorizationService } from "../../../../services/model-provider-authorization.service.ts";
import { ModelProviderDecisionModelService } from "../../../../services/model-provider-decision-model.service.ts";
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

const ORGANIZATION = "organization-1";
const SCOPE = { scopeType: "ORGANIZATION" as const, scopeId: ORGANIZATION };
const CONFIG_ID = "config-1";
const MERCURY = "inception/decisions:mercury-decide";
const PROJECT_A = { scopeType: "PROJECT" as const, scopeId: "project-a" };
const PROJECT_B = { scopeType: "PROJECT" as const, scopeId: "project-b" };

function inceptionRow(): ModelProvider {
  const at = new Date(0);
  return {
    id: "mp_inception",
    organizationId: ORGANIZATION,
    provider: "inception",
    name: "Inception",
    enabled: true,
    routingHandle: null,
    scopes: [],
    customKeys: { INCEPTION_API_KEY: "customer-key" },
    customModels: [],
    customEmbeddingsModels: [],
    extraHeaders: [],
    rateLimitRpm: null,
    rateLimitTpm: null,
    rateLimitRpd: null,
    fallbackPriorityGlobal: null,
    providerConfig: null,
    createdAt: at,
    updatedAt: at,
  };
}

const scopeKey = (scope: ModelDefaultScope) => `${scope.scopeType}:${scope.scopeId}`;

function unused(member: string) {
  return (): never => {
    throw new Error(`${member} is not reached by a defaults write`);
  };
}

async function writerOver({
  stored,
  storedScopes = [SCOPE],
  isFlagOn,
  keyedScopes = [SCOPE],
}: {
  stored?: Record<string, string>;
  storedScopes?: ModelDefaultScope[];
  isFlagOn: boolean;
  /** The scopes whose own chain holds an enabled Inception key. */
  keyedScopes?: ModelDefaultScope[];
}) {
  const { defaults } = MemoryModelProviderRepositories.create();
  if (stored) {
    await defaults.save({
      id: CONFIG_ID,
      organizationId: ORGANIZATION,
      config: stored,
      scopes: storedScopes,
      authorId: null,
    });
  }
  const scopes = ModelProviderScopeService.create({
    projects: createModelProviderTestProjects(),
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
  const keyed = new Set(keyedScopes.map(scopeKey));
  const decisionModels = ModelProviderDecisionModelService.create({
    resolution: { resolve: unused("resolve") },
    scopes,
    findProviderForProject: unused("findProviderForProject"),
    findProviderForScope: ({ scope, provider }) =>
      Promise.resolve(
        provider === "inception" && keyed.has(scopeKey(scope)) ? inceptionRow() : null,
      ),
    isOwnModelAllowed: () => Promise.resolve(isFlagOn),
  });
  return ModelProviderDefaultsWriteService.create({
    decisionModels,
    defaults,
    catalog: new OfflineModelProviderCatalog(),
    writeAuthorization: ModelProviderWriteAuthorizationService.create(
      ModelProviderAuthorizationService.create(createApiFixture<AuthzApi>({}, "AuthzApi")),
    ),
    ids: PrefixedModelProviderIdService.create(),
    scopes,
  });
}

describe("ModelProviderDefaultsWriteService and the Instant Evals column", () => {
  describe("when the flag is off", () => {
    /** @scenario "Picking an own decision model is refused without the flag" */
    it("refuses a newly picked own decision model", async () => {
      const writer = await writerOver({ isFlagOn: false });

      await expect(
        writer.save({ config: { INSTANT_EVALS: MERCURY }, scopes: [SCOPE], authorId: null }),
      ).rejects.toMatchObject({ code: "validation_error" });
    });

    /** @scenario "Keeping an already stored own decision model is not refused" */
    it("accepts a change to another column of a config that already stores one", async () => {
      const writer = await writerOver({ isFlagOn: false, stored: { INSTANT_EVALS: MERCURY } });

      const saved = await writer.save({
        id: CONFIG_ID,
        config: { INSTANT_EVALS: MERCURY, FAST: "openai/gpt-5.4-mini" },
        authorId: null,
      });

      expect(saved.config).toEqual({ INSTANT_EVALS: MERCURY, FAST: "openai/gpt-5.4-mini" });
    });

    it("accepts LangWatch Evals Preview", async () => {
      const writer = await writerOver({ isFlagOn: false });

      const saved = await writer.save({
        config: { INSTANT_EVALS: "langwatch/instant-evals" },
        scopes: [SCOPE],
        authorId: null,
      });

      expect(saved.config).toEqual({ INSTANT_EVALS: "langwatch/instant-evals" });
    });
  });

  describe("when the flag is on", () => {
    it("accepts an own decision model", async () => {
      const writer = await writerOver({ isFlagOn: true });

      const saved = await writer.save({
        config: { INSTANT_EVALS: MERCURY },
        scopes: [SCOPE],
        authorId: null,
      });

      expect(saved.config).toEqual({ INSTANT_EVALS: MERCURY });
    });

    /** @scenario "Picking an own decision model for a scope with no key for it is refused" */
    it("refuses an organization config when only one project holds the key", async () => {
      const writer = await writerOver({ isFlagOn: true, keyedScopes: [PROJECT_A] });

      await expect(
        writer.save({ config: { INSTANT_EVALS: MERCURY }, scopes: [SCOPE], authorId: null }),
      ).rejects.toMatchObject({
        code: "validation_error",
        message: expect.stringContaining("can't run for every scope"),
      });
    });

    it("accepts a project config whose project holds the key", async () => {
      const writer = await writerOver({ isFlagOn: true, keyedScopes: [PROJECT_A] });

      const saved = await writer.save({
        config: { INSTANT_EVALS: MERCURY },
        scopes: [PROJECT_A],
        authorId: null,
      });

      expect(saved.scopes).toEqual([PROJECT_A]);
    });

    /** @scenario "A kept own decision model is checked only on the scopes it gains" */
    it("refuses adding a scope with no key to a config that keeps its model", async () => {
      const writer = await writerOver({
        isFlagOn: true,
        stored: { INSTANT_EVALS: MERCURY },
        storedScopes: [PROJECT_A],
        keyedScopes: [PROJECT_A],
      });

      await expect(
        writer.save({ id: CONFIG_ID, scopes: [PROJECT_A, PROJECT_B], authorId: null }),
      ).rejects.toMatchObject({ code: "validation_error" });
    });

    it("does not recheck a kept model on the scopes it already had", async () => {
      const writer = await writerOver({
        isFlagOn: true,
        stored: { INSTANT_EVALS: MERCURY },
        storedScopes: [PROJECT_A],
        keyedScopes: [],
      });

      const saved = await writer.save({
        id: CONFIG_ID,
        config: { INSTANT_EVALS: MERCURY, FAST: "openai/gpt-5.4-mini" },
        authorId: null,
      });

      expect(saved.config).toEqual({ INSTANT_EVALS: MERCURY, FAST: "openai/gpt-5.4-mini" });
    });
  });

  /** @scenario "The column only takes decision models" */
  it("refuses a chat model in the Instant Evals column", async () => {
    const writer = await writerOver({ isFlagOn: true });

    await expect(
      writer.save({
        config: { INSTANT_EVALS: "openai/gpt-5.4-mini" },
        scopes: [SCOPE],
        authorId: null,
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
  });

  /** @scenario "A decision model cannot be another role's default" */
  it("refuses a decision model as the Default role", async () => {
    const writer = await writerOver({ isFlagOn: true });

    await expect(
      writer.save({
        config: { DEFAULT: "openai/decisions:gpt-6-luna" },
        scopes: [SCOPE],
        authorId: null,
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
  });
});
