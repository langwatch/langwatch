// A provider switched on with no credential it can reach fails every call it serves, so the
// save itself is refused; a deployment's own settings and a managed provider still count.

import type { AuthzApi } from "@langwatch/authz-contract";
import type { ModelProvider, ModelProviderWriteRequest } from "@langwatch/model-provider-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { UnavailableModelProviderCredentialProbeService } from "../../features/credential-probe/services/unavailable-model-provider-credential-probe.service.ts";
import { MemoryModelProviderRepositories } from "../../repositories/memory/memory.model-provider.repositories.ts";
import { ManagedModelProviderGatewayService } from "../../services/managed-model-provider-gateway.service.ts";
import { RegistryModelProviderCatalogService } from "../../services/registry-model-provider-catalog.service.ts";
import { UnmanagedModelProviderGatewayService } from "../../services/unmanaged-model-provider-gateway.service.ts";
import {
  createModelProviderTestApp,
  createModelProviderTestManagedProviders,
  createModelProviderTestProjects,
} from "./model-provider.fixture.ts";

const ORGANIZATION_SCOPE = [{ scopeType: "ORGANIZATION" as const, scopeId: "organization-1" }];
const CALLER = { id: "user-1" };

function keyedRow(overrides: Partial<ModelProvider> = {}): ModelProvider {
  return {
    id: "provider-1",
    organizationId: "organization-1",
    provider: "openai",
    name: "OpenAI",
    enabled: true,
    routingHandle: null,
    scopes: ORGANIZATION_SCOPE,
    customKeys: { OPENAI_API_KEY: "sk-invented" },
    customModels: [],
    customEmbeddingsModels: [],
    extraHeaders: [],
    rateLimitRpm: null,
    rateLimitTpm: null,
    rateLimitRpd: null,
    fallbackPriorityGlobal: null,
    providerConfig: null,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    ...overrides,
  };
}

function catalogFor({
  environment = {},
  managedOrganizationIds = [],
}: {
  environment?: Record<string, string>;
  managedOrganizationIds?: string[];
}) {
  return RegistryModelProviderCatalogService.create({
    managed:
      managedOrganizationIds.length > 0
        ? ManagedModelProviderGatewayService.create({
            managed: createModelProviderTestManagedProviders(managedOrganizationIds),
            projects: createModelProviderTestProjects(),
          })
        : UnmanagedModelProviderGatewayService.create(),
    probe: UnavailableModelProviderCredentialProbeService.create(),
    systemProviderEnvironment: environment,
    isSaas: false,
  });
}

async function appWith({
  row,
  environment,
  managedOrganizationIds,
}: {
  row?: ModelProvider;
  environment?: Record<string, string>;
  managedOrganizationIds?: string[];
}) {
  const repositories = MemoryModelProviderRepositories.create();
  if (row) await repositories.providers.create(row);
  const app = createModelProviderTestApp({
    repositories,
    infrastructure: { catalog: catalogFor({ environment, managedOrganizationIds }) },
    dependencies: {
      permissions: createApiFixture<AuthzApi>({
        getDecision: async () => ({ permitted: true, organizationRole: null }),
      }),
    },
  });

  return { app, repositories };
}

async function codeOf(promise: Promise<unknown>): Promise<unknown> {
  const error: unknown = await promise.then(
    () => void 0,
    (caught: unknown) => caught,
  );
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}

function write(overrides: Partial<ModelProviderWriteRequest>): ModelProviderWriteRequest {
  return {
    organizationId: "organization-1",
    provider: "openai",
    enabled: true,
    scopes: ORGANIZATION_SCOPE,
    ...overrides,
  };
}

describe("ModelProviderModule.upsert, switching on a provider", () => {
  describe("given a deployment that supplies no OpenAI setting", () => {
    describe("when the provider is created enabled with no keys", () => {
      it("refuses with model_provider_credentials_required and stores nothing", async () => {
        const { app, repositories } = await appWith({});

        expect(await codeOf(app.upsert(write({}), CALLER))).toBe(
          "model_provider_credentials_required",
        );
        expect(await repositories.providers.findForOrganization("organization-1")).toEqual([]);
      });
    });

    describe("when a disabled keyless row is switched on", () => {
      it("refuses with model_provider_credentials_required", async () => {
        const { app } = await appWith({ row: keyedRow({ enabled: false, customKeys: null }) });

        expect(await codeOf(app.upsert(write({ id: "provider-1" }), CALLER))).toBe(
          "model_provider_credentials_required",
        );
      });
    });

    describe("when the provider is created enabled with its key", () => {
      it("saves it enabled", async () => {
        const { app } = await appWith({});

        const saved = await app.upsert(
          write({ customKeys: { OPENAI_API_KEY: "sk-invented" } }),
          CALLER,
        );

        expect(saved.enabled).toBe(true);
      });
    });

    describe("when the provider is created disabled with no keys", () => {
      it("saves it disabled", async () => {
        const { app } = await appWith({});

        const saved = await app.upsert(write({ enabled: false }), CALLER);

        expect(saved.enabled).toBe(false);
      });
    });

    describe("when a keyed row is edited without its key being sent again", () => {
      it("saves the edit and keeps the stored key", async () => {
        const { app, repositories } = await appWith({ row: keyedRow({ enabled: false }) });

        await app.upsert(write({ id: "provider-1", name: "Renamed" }), CALLER);

        const stored = await repositories.providers.getById({ id: "provider-1" });
        expect(stored).toMatchObject({
          enabled: true,
          name: "Renamed",
          customKeys: { OPENAI_API_KEY: "sk-invented" },
        });
      });
    });
  });

  describe("given a deployment that supplies the provider's setting itself", () => {
    describe("when the provider is created enabled with no keys", () => {
      it("saves it enabled, served by the deployment's value", async () => {
        const { app } = await appWith({
          environment: { OPENAI_BASE_URL: "https://inference.acme.internal/v1" },
        });

        const saved = await app.upsert(write({}), CALLER);

        expect(saved.enabled).toBe(true);
      });
    });

    describe("when the deployment holds the provider's key", () => {
      it("saves it enabled", async () => {
        const { app } = await appWith({ environment: { OPENAI_API_KEY: "sk-deployment" } });

        const saved = await app.upsert(write({}), CALLER);

        expect(saved.enabled).toBe(true);
      });
    });
  });

  describe("given an organization whose Bedrock credentials LangWatch manages", () => {
    describe("when Bedrock is created enabled with no keys", () => {
      it("saves it enabled", async () => {
        const { app } = await appWith({ managedOrganizationIds: ["organization-1"] });

        const saved = await app.upsert(write({ provider: "bedrock" }), CALLER);

        expect(saved.enabled).toBe(true);
      });
    });
  });

  describe("given a provider keyed with the managed marker", () => {
    describe("when it is created enabled", () => {
      it("saves it enabled", async () => {
        const { app } = await appWith({});

        const saved = await app.upsert(write({ customKeys: { MANAGED: "true" } }), CALLER);

        expect(saved.enabled).toBe(true);
      });
    });
  });

  describe("given Codex, which signs in rather than takes a key", () => {
    describe("when it is created enabled before any sign-in", () => {
      it("refuses with model_provider_credentials_required", async () => {
        const { app } = await appWith({});

        expect(await codeOf(app.upsert(write({ provider: "openai_codex" }), CALLER))).toBe(
          "model_provider_credentials_required",
        );
      });
    });
  });
});
