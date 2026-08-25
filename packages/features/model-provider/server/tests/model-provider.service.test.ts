import { describe, expect, it } from "vitest";
import {
  type ModelCost,
  type ModelDefaultConfig,
  type ModelProvider,
  type ModelProviderApiKeyValidation,
} from "@langwatch/model-provider-contract";
import { ProjectService, projectWithTeamSchema } from "@langwatch/project-contract";
import { ModelProviderService } from "../src/services/model-provider.service";
import {
  ManagedProviderService,
  ModelCostRepository,
  ModelDefaultRepository,
  ModelProviderCatalog,
  ModelProviderCredentialPolicy,
  ModelProviderOnboardingDefaults,
  ModelProviderRepository,
  ModelTranslationPort,
} from "../src/ports/model-provider.port";

const now = new Date();
function provider(overrides: Partial<ModelProvider> = {}): ModelProvider {
  return {
    id: "mp_1",
    organizationId: "org_1",
    provider: "openai",
    name: "OpenAI",
    enabled: true,
    routingHandle: null,
    scopes: [{ scopeType: "PROJECT", scopeId: "project_1" }],
    customKeys: { apiKey: "secret" },
    customModels: [],
    customEmbeddingsModels: [],
    extraHeaders: [],
    rateLimitRpm: null,
    rateLimitTpm: null,
    rateLimitRpd: null,
    fallbackPriorityGlobal: null,
    providerConfig: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

class Providers extends ModelProviderRepository {
  rows = [provider()];
  tryFindById(input: { id: string }): Promise<ModelProvider | null> {
    return Promise.resolve(this.rows.find((row) => row.id === input.id) ?? null);
  }
  tryFindByProviderForProject(input: {
    provider: string;
  }): Promise<ModelProvider | null> {
    return Promise.resolve(
      this.rows.find((row) => row.provider === input.provider) ?? null,
    );
  }
  listForProject(): Promise<ModelProvider[]> {
    return Promise.resolve(this.rows);
  }
  listForOrganization(): Promise<ModelProvider[]> {
    return Promise.resolve(this.rows);
  }
  create(input: ModelProvider): Promise<ModelProvider> {
    this.rows.push(input);
    return Promise.resolve(input);
  }
  update(input: ModelProvider): Promise<ModelProvider> {
    this.rows = this.rows.map((row) => (row.id === input.id ? input : row));
    return Promise.resolve(input);
  }
  delete(input: { id: string }): Promise<void> {
    this.rows = this.rows.filter((row) => row.id !== input.id);
    return Promise.resolve();
  }
  tryResolveOrganizationId(input: {
    projectId?: string;
    organizationId?: string;
  }): Promise<string | null> {
    return Promise.resolve(input.organizationId ?? "org_1");
  }
  resolveOrganizationIdForScopes(): Promise<string> {
    return Promise.resolve("org_1");
  }
  hasStoredCredentials(id: string): Promise<boolean> {
    return Promise.resolve(
      this.rows.some((row) => row.id === id && row.customKeys !== null),
    );
  }
}

const project = projectWithTeamSchema.parse({
  id: "project_1",
  name: "Project",
  slug: "project",
  apiKey: "api-key",
  lwqlKey: "lwql-key",
  teamId: "team_1",
  language: "typescript",
  framework: "langchain",
  kind: "application",
  firstMessage: false,
  integrated: true,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  userLinkTemplate: null,
  traceSharingEnabled: false,
  presenceEnabled: false,
  s3Endpoint: null,
  s3AccessKeyId: null,
  s3SecretAccessKey: null,
  s3Bucket: null,
  archivedAt: null,
  isPersonal: false,
  ownerUserId: null,
  personalFeatures: {},
  departmentId: null,
  langyEgressAllowlist: null,
  lastCodingAgentSessionAt: null,
  lastCodingAgentPullRequestAt: null,
  team: {
    id: "team_1",
    name: "Team",
    slug: "team",
    organizationId: "org_1",
    createdAt: new Date(0),
    updatedAt: new Date(0),
    archivedAt: null,
    isPersonal: false,
    ownerUserId: null,
    departmentId: null,
  },
});

class Projects extends ProjectService {
  private notUsed(): never {
    throw new Error("Project method is not used by this test");
  }

  tryFindInternal() {
    return this.notUsed();
  }

  ensureInternal() {
    return this.notUsed();
  }

  isPresenceEnabled() {
    return this.notUsed();
  }

  getById() {
    return this.notUsed();
  }

  getOrganizationId() {
    return this.notUsed();
  }

  tryGetById() {
    return this.notUsed();
  }

  tryGetSummaryById() {
    return this.notUsed();
  }

  getWithTeam() {
    return Promise.resolve(project);
  }

  tryGetWithTeam() {
    return this.notUsed();
  }

  create() {
    return this.notUsed();
  }

  update() {
    return this.notUsed();
  }

  archive() {
    return this.notUsed();
  }

  listByOrganization() {
    return this.notUsed();
  }

  listByTeam() {
    return this.notUsed();
  }

  listNamesByIds() {
    return this.notUsed();
  }

  listActiveByScopes() {
    return this.notUsed();
  }

  updateMetadata() {
    return this.notUsed();
  }

  touchCodingAgentSessionSeen() {
    return this.notUsed();
  }

  touchCodingAgentPullRequestSeen() {
    return this.notUsed();
  }

  searchByQuery() {
    return this.notUsed();
  }

  isFeatureEnabled() {
    return this.notUsed();
  }

  tryGetTraceSharingConfig() {
    return this.notUsed();
  }

  resolveOrgAdmin() {
    return this.notUsed();
  }
}
class Defaults extends ModelDefaultRepository {
  configs: ModelDefaultConfig[] = [];
  listForProject(): Promise<ModelDefaultConfig[]> {
    return Promise.resolve(this.configs);
  }
  tryGetById(id: string): Promise<ModelDefaultConfig | null> {
    return Promise.resolve(this.configs.find((config) => config.id === id) ?? null);
  }
  save(input: ModelDefaultConfig): Promise<ModelDefaultConfig> {
    this.configs.push(input);
    return Promise.resolve(input);
  }
  set(): Promise<void> {
    return Promise.resolve();
  }
  delete(): Promise<void> {
    return Promise.resolve();
  }
  tryResolve(): Promise<string | null> {
    return Promise.resolve("gpt-4o");
  }
}
class Costs extends ModelCostRepository {
  rows: ModelCost[] = [];
  listForProject(): Promise<ModelCost[]> {
    return Promise.resolve(this.rows);
  }
  tryFindById(id: string): Promise<ModelCost | null> {
    return Promise.resolve(this.rows.find((row) => row.id === id) ?? null);
  }
  save(input: ModelCost): Promise<ModelCost> {
    this.rows.push(input);
    return Promise.resolve(input);
  }
  delete(): Promise<void> {
    return Promise.resolve();
  }
  tryResolveOrganizationId(): Promise<string | null> {
    return Promise.resolve("org_1");
  }
}
class Catalog extends ModelProviderCatalog {
  exists(providerName: string): boolean {
    return providerName === "openai";
  }
  systemProviders(): Promise<[]> {
    return Promise.resolve([]);
  }
  validateApiKey(): Promise<ModelProviderApiKeyValidation> {
    return Promise.resolve({ valid: true });
  }
  testConnection(): Promise<{ connected: boolean }> {
    return Promise.resolve({ connected: true });
  }
  tryMaskCredentials(
    keys: Record<string, unknown> | null,
  ): Record<string, unknown> | null {
    return keys ? { apiKey: "••••" } : null;
  }
}
class PricingCatalog extends Catalog {
  staticCostRates() {
    return [
      {
        model: "test-model",
        regex: "^test-model$",
        inputCostPerToken: 0.000001,
        outputCostPerToken: 0.000002,
      },
    ];
  }
}
class Managed extends ManagedProviderService {
  isManagedProvider(): boolean {
    return false;
  }
}
class Translator extends ModelTranslationPort {
  translate(): Promise<string> {
    return Promise.resolve("translated");
  }
}
class CredentialPolicy extends ModelProviderCredentialPolicy {
  normalize(_provider: string, value: Record<string, unknown> | null) {
    return value;
  }
  merge(input: {
    incoming: Record<string, unknown> | null;
    stored: Record<string, unknown> | null;
  }) {
    return Object.fromEntries(
      Object.entries(input.incoming ?? {}).map(([key, value]) => [
        key,
        value === "••••" ? input.stored?.[key] : value,
      ]),
    );
  }
  mask(value: Record<string, unknown> | null) {
    return value ? { ...value, apiKey: "••••" } : null;
  }
  hasUsableReplacement(value: Record<string, unknown> | null): boolean {
    return Object.values(value ?? {}).some(
      (field) => typeof field === "string" && field.length > 0,
    );
  }
  mergeHeaders(input: {
    incoming: Array<{ key: string; value: string }>;
    stored: Array<{ key: string; value: string }>;
  }) {
    return input.incoming.length > 0 ? input.incoming : input.stored;
  }
  maskHeaders(value: Array<{ key: string; value: string }>) {
    return value.map(({ key }) => ({ key, value: "••••" }));
  }
}
class OnboardingDefaults extends ModelProviderOnboardingDefaults {
  seeded: Array<{ provider: string; scopes: ModelProvider["scopes"] }> = [];
  seed(input: { provider: string; scopes: ModelProvider["scopes"] }) {
    this.seeded.push(input);
    return Promise.resolve();
  }
}

function service(
  providers = new Providers(),
  catalog: ModelProviderCatalog = new Catalog(),
) {
  return ModelProviderService.create({
    repository: providers,
    projects: new Projects(),
    credentialPolicy: new CredentialPolicy(),
    defaults: new Defaults(),
    costs: new Costs(),
    catalog,
    managedProviders: new Managed(),
    translation: new Translator(),
    generateId: () => "generated",
  });
}

describe("ModelProviderService", () => {
  it("masks credentials in frontend summaries", async () => {
    const result = await service().listForProject({ projectId: "project_1" });
    expect(result[0]?.customKeys).toEqual({ apiKey: "••••" });
  });
  it("rejects unknown providers before persistence", async () => {
    await expect(
      service().upsert({ projectId: "project_1", provider: "unknown", enabled: true }),
    ).rejects.toMatchObject({ code: "model_provider_invalid" });
  });
  it("resolves translation through the default-model repository and port", async () => {
    await expect(
      service().translate({ projectId: "project_1", text: "hello" }),
    ).resolves.toEqual({ translation: "translated" });
  });
  it("uses the catalog-owned static rate cascade", () => {
    expect(
      service(undefined, new PricingCatalog()).estimateCost({
        attrs: { "gen_ai.request.model": "test-model" },
        promptTokens: 100,
        completionTokens: 50,
      }),
    ).toBeCloseTo(0.0002, 10);
  });
  it("preserves stored credentials when a masked write edits another field", async () => {
    const providers = new Providers();
    await service(providers).upsert({
      id: "mp_1",
      projectId: "project_1",
      provider: "openai",
      enabled: true,
      name: "Renamed",
      customKeys: { apiKey: "••••", publicBaseUrl: "https://example.test" },
    });

    expect(providers.rows[0]?.customKeys).toEqual({
      apiKey: "secret",
      publicBaseUrl: "https://example.test",
    });
  });
  it("returns safe Codex status without exposing the credential bag", async () => {
    const providers = new Providers();
    providers.rows = [
      provider({
        provider: "openai_codex",
        customKeys: { CODEX_ACCESS_TOKEN: "secret", CODEX_PLAN: "plus" },
      }),
    ];

    await expect(
      service(providers).getCodexStatus({ projectId: "project_1" }),
    ).resolves.toEqual({
      connected: true,
      providerId: "mp_1",
      plan: "plus",
    });
  });
  it("selects the narrowest enabled custom-model provider row", async () => {
    const providers = new Providers();
    providers.rows = [
      provider({
        id: "organization-row",
        scopes: [{ scopeType: "ORGANIZATION", scopeId: "org_1" }],
        customModels: [{ id: "deployment", label: "Deployment", type: "chat" }],
      }),
      provider({
        id: "project-row",
        scopes: [{ scopeType: "PROJECT", scopeId: "project_1" }],
        customModels: [{ id: "deployment", label: "Deployment", type: "chat" }],
      }),
    ];

    await expect(
      service(providers).tryFindRowServingModel({
        projectId: "project_1",
        provider: "openai",
        model: "deployment",
      }),
    ).resolves.toMatchObject({ id: "project-row" });
  });
  it("returns raw execution providers with registry model metadata", async () => {
    class ExecutionCatalog extends Catalog {
      metadata() {
        return {
          models: ["gpt-4o"],
          embeddingsModels: ["text-embedding-3-small"],
        };
      }
    }

    await expect(
      service(new Providers(), new ExecutionCatalog()).getExecutionProviders({
        projectId: "project_1",
      }),
    ).resolves.toMatchObject({
      openai: {
        customKeys: { apiKey: "secret" },
        models: ["gpt-4o"],
        embeddingsModels: ["text-embedding-3-small"],
        isSystem: false,
      },
    });
  });
  it("seeds onboarding defaults after creating a provider", async () => {
    const providers = new Providers();
    providers.rows = [];
    const onboardingDefaults = new OnboardingDefaults();
    const modelProviders = ModelProviderService.create({
      repository: providers,
      projects: new Projects(),
      credentialPolicy: new CredentialPolicy(),
      defaults: new Defaults(),
      costs: new Costs(),
      catalog: new Catalog(),
      onboardingDefaults,
      generateId: () => "generated",
    });

    await modelProviders.upsert({
      projectId: "project_1",
      provider: "openai",
      enabled: true,
    });

    expect(onboardingDefaults.seeded).toEqual([
      {
        provider: "openai",
        scopes: [{ scopeType: "PROJECT", scopeId: "project_1" }],
      },
    ]);
  });
});
