// A provider save may name the project's default model; that default passes the same gate as
// the default-models settings, so no save route stores a model its key does not allow.

import {
  INSTANT_EVAL_JUDGE_MODEL_ID,
  INSTANT_EVAL_JUDGE_ONLY_MESSAGE,
} from "@langwatch/instant-eval-judge-contract";
import {
  CODEX_DEFAULT_MODEL,
  ModelDefaultValidationError,
  ModelProviderNotFoundError,
} from "@langwatch/model-provider-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import type { ManagedModelProviderGatewayService } from "../managed-model-provider-gateway.service.ts";
import { ModelProviderCommandService } from "../model-provider-command.service.ts";
import { ModelProviderKeysService } from "../model-provider-keys.service.ts";
import { RegistryModelProviderCatalogService } from "../registry-model-provider-catalog.service.ts";
import { UnavailableModelProviderCredentialProbeService } from "../unavailable-model-provider-credential-probe.service.ts";

function serviceWith() {
  const created: unknown[] = [];
  const defaults: unknown[] = [];
  const repository = {
    getById: async () => {
      throw new ModelProviderNotFoundError();
    },
    create: async (input: unknown) => {
      created.push(input);
      return input;
    },
  };
  const scopes = {
    getProjectScopes: async () => [{ scopeType: "PROJECT", scopeId: "project-1" }],
    getAnchorOrganizationId: async () => "organization-1",
    getOrganizationIdForScopes: async () => "organization-1",
    getOrganizationIdForScope: async () => "organization-1",
  };

  return {
    created,
    defaults,
    service: ModelProviderCommandService.create({
      repository,
      scopes,
      catalog: registryCatalog(),
      ids: { generate: () => "id-1" },
      onboardingDefaults: { seed: async () => {} },
      defaults: {
        set: async (input: unknown) => {
          defaults.push(input);
        },
      },
      credentialPolicy: ModelProviderKeysService.create(),
    } as never),
  };
}

function registryCatalog() {
  return RegistryModelProviderCatalogService.create({
    managed: createApiFixture<ManagedModelProviderGatewayService>(),
    probe: UnavailableModelProviderCredentialProbeService.create(),
    systemProviderEnvironment: {},
    isSaas: false,
  });
}

function saveProvider(defaultModel: string) {
  return {
    projectId: "project-1",
    provider: "openai",
    enabled: true,
    scopes: [{ scopeType: "PROJECT" as const, scopeId: "project-1" }],
    defaultModel,
  };
}

describe("ModelProviderCommandService.upsert with a project default model", () => {
  describe.each([
    ["Instant Evals", INSTANT_EVAL_JUDGE_MODEL_ID, INSTANT_EVAL_JUDGE_ONLY_MESSAGE],
    ["a coding-assistant model", CODEX_DEFAULT_MODEL, "serves the coding-assistant surfaces only"],
  ])("when the default names %s", (_name, model, wording) => {
    /** @scenario "A default-model save naming a model its key does not allow is refused" */
    it("refuses as a client error before storing the provider or the default", async () => {
      const { service, created, defaults } = serviceWith();
      const save = service.upsert(saveProvider(model));

      await expect(save).rejects.toBeInstanceOf(ModelDefaultValidationError);
      await expect(save).rejects.toThrow(wording);
      expect(created).toEqual([]);
      expect(defaults).toEqual([]);
    });
  });

  describe("when the default names a model the key allows", () => {
    it("stores it as the project's DEFAULT", async () => {
      const { service, defaults } = serviceWith();

      await service.upsert(saveProvider("openai/gpt-5-mini"));

      expect(defaults).toEqual([
        expect.objectContaining({
          scope: { scopeType: "PROJECT", scopeId: "project-1" },
          key: "DEFAULT",
          model: "openai/gpt-5-mini",
        }),
      ]);
    });
  });
});

describe("the default-models settings save", () => {
  /** @scenario "A default-model save naming a model its key does not allow is refused" */
  it.each(["DEFAULT", "scenarios.judge", "evaluator.create_default"])(
    "refuses Instant Evals as the %s default in plain words",
    (key) => {
      expect(() =>
        registryCatalog().sanitizeDefaultConfig({ [key]: INSTANT_EVAL_JUDGE_MODEL_ID }),
      ).toThrow(INSTANT_EVAL_JUDGE_ONLY_MESSAGE);
    },
  );
});
