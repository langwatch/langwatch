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
import type { ModelProviderRepositories } from "../../../../repositories/model-provider.repositories.ts";
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
  defaults = MemoryModelProviderRepositories.create().defaults,
  stored,
  storedScopes = [SCOPE],
  isOwnModelOn,
  isJudgePreviewOn = false,
  keyedScopes = [SCOPE],
}: {
  stored?: Record<string, string>;
  storedScopes?: ModelDefaultScope[];
  /** The own decision model flag. */
  isOwnModelOn: boolean;
  /** The LangWatch Judge (preview) release flag. */
  isJudgePreviewOn?: boolean;
  /** The scopes whose own chain holds an enabled Inception key. */
  keyedScopes?: ModelDefaultScope[];
  defaults?: ModelProviderRepositories["defaults"];
}) {
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
    isJudgePreviewAllowed: () => Promise.resolve(isJudgePreviewOn),
    isOwnModelAllowed: () => Promise.resolve(isOwnModelOn),
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

describe("ModelProviderDefaultsWriteService and LangWatch Judge (preview)", () => {
  describe("when the judge preview flag is on", () => {
    /** @scenario "Saving LangWatch Judge (preview) under another column is refused" */
    it.each(["DEFAULT", "FAST"])(
      "refuses it as the %s default, saying it can only be the Judge default",
      async (key) => {
        const writer = await writerOver({ isOwnModelOn: false, isJudgePreviewOn: true });

        await expect(
          writer.save({
            config: { [key]: "langwatch/judge-preview" },
            scopes: [SCOPE],
            authorId: null,
          }),
        ).rejects.toThrow("can only be the Judge default");
      },
    );

    /** @scenario "Saving LangWatch Judge (preview) under another column is refused" */
    it("refuses it as the Instant Evals default, which takes decision models only", async () => {
      const writer = await writerOver({ isOwnModelOn: false, isJudgePreviewOn: true });

      await expect(
        writer.save({
          config: { INSTANT_EVALS: "langwatch/judge-preview" },
          scopes: [SCOPE],
          authorId: null,
        }),
      ).rejects.toThrow("is not a decision model");
    });

    /** @scenario "Saving LangWatch Judge (preview) as the Judge default stores it as picked" */
    it("accepts it as the Judge default and stores it as picked", async () => {
      const { defaults } = MemoryModelProviderRepositories.create();
      const writer = await writerOver({ isOwnModelOn: false, isJudgePreviewOn: true, defaults });

      const saved = await writer.save({
        config: { JUDGE: "langwatch/judge-preview" },
        scopes: [SCOPE],
        authorId: null,
      });

      const [stored] = await defaults.findForOrganization(ORGANIZATION);
      expect(saved.config).toEqual({ JUDGE: "langwatch/judge-preview" });
      expect(stored?.config).toEqual({ JUDGE: "langwatch/judge-preview" });
    });
  });

  describe("when the judge preview flag is off", () => {
    /** @scenario "Saving LangWatch Judge (preview) is refused where its flag is off" */
    it("refuses it as the Judge default", async () => {
      const writer = await writerOver({ isOwnModelOn: true, isJudgePreviewOn: false });

      await expect(
        writer.save({
          config: { JUDGE: "langwatch/judge-preview" },
          scopes: [SCOPE],
          authorId: null,
        }),
      ).rejects.toThrow("not available for this organization yet");
    });
  });
});

describe("ModelProviderDefaultsWriteService and the Instant Evals column", () => {
  describe("when the flag is off", () => {
    /** @scenario "Picking an own decision model is refused without the flag" */
    it("refuses a newly picked own decision model", async () => {
      const writer = await writerOver({ isOwnModelOn: false });

      await expect(
        writer.save({ config: { INSTANT_EVALS: MERCURY }, scopes: [SCOPE], authorId: null }),
      ).rejects.toMatchObject({ code: "validation_error" });
    });

    /** @scenario "Keeping an already stored own decision model is not refused" */
    it("accepts a change to another column of a config that already stores one", async () => {
      const writer = await writerOver({ isOwnModelOn: false, stored: { INSTANT_EVALS: MERCURY } });

      const saved = await writer.save({
        id: CONFIG_ID,
        config: { INSTANT_EVALS: MERCURY, FAST: "openai/gpt-5.4-mini" },
        authorId: null,
      });

      expect(saved.config).toEqual({ INSTANT_EVALS: MERCURY, FAST: "openai/gpt-5.4-mini" });
    });

    /** @scenario "Saving a config stores LangWatch's model under the id the previous release reads" */
    it.each(["langwatch/instant-preview", "langwatch/instant-evals"])(
      "stores %s as langwatch/instant-evals",
      async (sent) => {
        const writer = await writerOver({ isOwnModelOn: false });

        const saved = await writer.save({
          config: { INSTANT_EVALS: sent },
          scopes: [SCOPE],
          authorId: null,
        });

        expect(saved.config).toEqual({ INSTANT_EVALS: "langwatch/instant-evals" });
      },
    );

    /** @scenario "Saving a config stores LangWatch's model under the id the previous release reads" */
    it("stores LangWatch Instant (preview) set as one default under the earlier id", async () => {
      const { defaults } = MemoryModelProviderRepositories.create();
      const writer = await writerOver({ isOwnModelOn: false, defaults });

      await writer.set({
        scope: SCOPE,
        key: "INSTANT_EVALS",
        model: "langwatch/instant-preview",
        authorId: null,
      });

      const [stored] = await defaults.findForOrganization(ORGANIZATION);
      expect(stored?.config).toEqual({ INSTANT_EVALS: "langwatch/instant-evals" });
    });

    /** @scenario "The Instant Evals column refuses LangWatch Evals (preview)" */
    it("refuses LangWatch Evals (preview) in the column on a save and on a single set", async () => {
      const writer = await writerOver({ isOwnModelOn: false });

      await expect(
        writer.save({
          config: { INSTANT_EVALS: "langwatch/evals-preview" },
          scopes: [SCOPE],
          authorId: null,
        }),
      ).rejects.toMatchObject({ code: "validation_error" });
      await expect(
        writer.set({
          scope: SCOPE,
          key: "INSTANT_EVALS",
          model: "langwatch/evals-preview",
          authorId: null,
        }),
      ).rejects.toHaveProperty("code");
    });
  });

  describe("when the flag is on", () => {
    it("accepts an own decision model", async () => {
      const writer = await writerOver({ isOwnModelOn: true });

      const saved = await writer.save({
        config: { INSTANT_EVALS: MERCURY },
        scopes: [SCOPE],
        authorId: null,
      });

      expect(saved.config).toEqual({ INSTANT_EVALS: MERCURY });
    });

    /** @scenario "Picking an own decision model for a scope with no key for it is refused" */
    it("refuses an organization config when only one project holds the key", async () => {
      const writer = await writerOver({ isOwnModelOn: true, keyedScopes: [PROJECT_A] });

      await expect(
        writer.save({ config: { INSTANT_EVALS: MERCURY }, scopes: [SCOPE], authorId: null }),
      ).rejects.toMatchObject({
        code: "validation_error",
        message: expect.stringContaining("can't run for every scope"),
      });
    });

    it("accepts a project config whose project holds the key", async () => {
      const writer = await writerOver({ isOwnModelOn: true, keyedScopes: [PROJECT_A] });

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
        isOwnModelOn: true,
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
        isOwnModelOn: true,
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
    const writer = await writerOver({ isOwnModelOn: true });

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
    const writer = await writerOver({ isOwnModelOn: true });

    await expect(
      writer.save({
        config: { DEFAULT: "openai/decisions:gpt-6-luna" },
        scopes: [SCOPE],
        authorId: null,
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
  });
});
