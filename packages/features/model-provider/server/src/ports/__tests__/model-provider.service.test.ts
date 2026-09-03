import { describe, expect, it } from "vitest";
import {
  type ModelCost,
  type ModelDefaultConfig,
  type ModelProvider,
  type ModelProviderApiKeyValidation,
  type ModelProviderCredentialVerdict,
  type CodexTokenKeys,
  CODEX_DEFAULT_MODEL,
  DEFAULT_AZURE_API_VERSION,
  expandLatestAlias,
  ModelProviderCredentialsUnreadableError,
} from "@langwatch/model-provider-contract";
import { ProjectService, projectWithTeamSchema } from "@langwatch/project-contract";
import { OrganizationService } from "@langwatch/organization-contract";
import { AuthzService } from "@langwatch/authz-contract";
import { ModelProviderService } from "../../services/model-provider.service";
import {
  ModelCostRepository,
  ModelDefaultRepository,
  ModelProviderCatalog,
  ModelProviderCredentialPolicy,
  CodexTokenRefresher,
  ModelProviderConnectionRateLimiter,
  ModelProviderIdService,
  ModelProviderRepository,
  ModelTranslationPort,
  type ModelDefaultConfigSaveInput,
} from "../model-provider.port";

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
  created: ModelProvider[] = [];
  deleted: string[] = [];
  storedCredentialIds = new Set<string>();
  updates: ModelProvider[] = [];
  tryFindById(input: { id: string; organizationId?: string }): Promise<ModelProvider | null> {
    return Promise.resolve(
      this.rows.find(
        (row) =>
          row.id === input.id &&
          (!input.organizationId || row.organizationId === input.organizationId),
      ) ?? null,
    );
  }
  tryFindByProviderForProject(input: { provider: string }): Promise<ModelProvider | null> {
    return Promise.resolve(this.rows.find((row) => row.provider === input.provider) ?? null);
  }
  listForProject(): Promise<ModelProvider[]> {
    return Promise.resolve(this.rows);
  }
  listForOrganization(): Promise<ModelProvider[]> {
    return Promise.resolve(this.rows);
  }
  create(input: ModelProvider): Promise<ModelProvider> {
    this.rows.push(input);
    this.created.push(input);
    return Promise.resolve(input);
  }
  update(input: ModelProvider): Promise<ModelProvider> {
    this.rows = this.rows.map((row) => (row.id === input.id ? input : row));
    this.updates.push(input);
    return Promise.resolve(input);
  }
  delete(input: { id: string }): Promise<void> {
    this.rows = this.rows.filter((row) => row.id !== input.id);
    this.deleted.push(input.id);
    return Promise.resolve();
  }
  hasStoredCredentials(id: string): Promise<boolean> {
    return Promise.resolve(
      this.storedCredentialIds.has(id) ||
        this.rows.some((row) => row.id === id && row.customKeys !== null),
    );
  }
}

class CodexRefresher extends CodexTokenRefresher {
  calls = 0;
  failure: Error | null = null;
  result: { status: "refreshed"; tokens: CodexTokenKeys } | { status: "session_expired" } = {
    status: "session_expired",
  };

  refresh(): Promise<
    { status: "refreshed"; tokens: CodexTokenKeys } | { status: "session_expired" }
  > {
    this.calls += 1;
    if (this.failure) return Promise.reject(this.failure);
    return Promise.resolve(this.result);
  }
}
class ConnectionRateLimiter extends ModelProviderConnectionRateLimiter {
  calls = 0;
  error: Error | null = null;

  assertAvailable(): Promise<void> {
    this.calls += 1;
    if (this.error) {
      return Promise.reject(this.error);
    }
    return Promise.resolve();
  }
}
class Authorization extends AuthzService {
  canWriteResult = true;
  writes: Array<{ actorId: string; scopeType: string; scopeId: string }> = [];

  check(): Promise<never> {
    return this.notUsed();
  }

  checkDetailed(): Promise<never> {
    return this.notUsed();
  }

  can(): Promise<never> {
    return this.notUsed();
  }

  authorize(): Promise<never> {
    return this.notUsed();
  }

  effectivePermissions(): Promise<never> {
    return this.notUsed();
  }

  checkByIds(): Promise<never> {
    return this.notUsed();
  }

  canAnyByIds(): Promise<never> {
    return this.notUsed();
  }

  canBatchByIds(): Promise<never> {
    return this.notUsed();
  }

  tryResolveScope(): Promise<never> {
    return this.notUsed();
  }

  checkScopeLineage(): Promise<never> {
    return this.notUsed();
  }

  explainDecision(): Promise<never> {
    return this.notUsed();
  }

  getDecision(input: { userId: string; scope: { tier: string; id: string } }): Promise<{
    permitted: boolean;
    organizationRole: null;
  }> {
    this.writes.push({
      actorId: input.userId,
      scopeType: input.scope.tier.toUpperCase(),
      scopeId: input.scope.id,
    });
    return Promise.resolve({ permitted: this.canWriteResult, organizationRole: null });
  }

  getProjectAnyDecision(): Promise<never> {
    return this.notUsed();
  }

  hasPermission(): Promise<never> {
    return this.notUsed();
  }

  authorizePermission(): Promise<never> {
    return this.notUsed();
  }

  authorizeProjectPermission(): Promise<never> {
    return this.notUsed();
  }

  hasApiKeyPermission(): Promise<never> {
    return this.notUsed();
  }

  getApiKeyProjectDecision(): Promise<never> {
    return this.notUsed();
  }

  listUserBindings(): Promise<never> {
    return this.notUsed();
  }

  listOrganizationBindings(): Promise<never> {
    return this.notUsed();
  }

  listUserAndGroupBindings(): Promise<never> {
    return this.notUsed();
  }

  listScopeBindings(): Promise<never> {
    return this.notUsed();
  }

  listGroupBindings(): Promise<never> {
    return this.notUsed();
  }

  listTeamMemberBindings(): Promise<never> {
    return this.notUsed();
  }

  listBindingsForSynthesis(): Promise<never> {
    return this.notUsed();
  }

  listUserCreatedRoles(): Promise<never> {
    return this.notUsed();
  }

  wouldFirstBindingDisableLegacyAccess(): Promise<never> {
    return this.notUsed();
  }

  listManagedBindingsForUser(): Promise<never> {
    return this.notUsed();
  }

  listManagedBindingsForOrganization(): Promise<never> {
    return this.notUsed();
  }

  getAccessBreakdown(): Promise<never> {
    return this.notUsed();
  }

  isOnEngine(): Promise<never> {
    return this.notUsed();
  }

  tryGetEngineCutoverAt(): Promise<never> {
    return this.notUsed();
  }

  private notUsed(): never {
    throw new Error("This AuthzService test-double method is not used by this test.");
  }
}

class Ids extends ModelProviderIdService {
  generate(): string {
    return "generated";
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

  tryGetOrganizationId() {
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

  tryGetIdentity() {
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
    return Promise.resolve(project);
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
    return Promise.resolve([
      {
        id: project.id,
        name: project.name,
        slug: project.slug,
        teamId: project.teamId,
        organizationId: project.team.organizationId,
        // Part of the identity `listNamesByIds` answers with. Omitting them
        // made this fake describe a project that cannot be personal, which is
        // a distinction the model-provider paths do draw.
        isPersonal: false,
        ownerUserId: null,
      },
    ]);
  }

  listIdsByOrganization() {
    return Promise.resolve([project.id]);
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

  tryGetTraceSharingConfig() {
    return this.notUsed();
  }

  resolveOrgAdmin() {
    return this.notUsed();
  }

  resolveTraceDestination() {
    return this.notUsed();
  }

  tryGetTraceDestination() {
    return this.notUsed();
  }

  listTraceDestinations() {
    return this.notUsed();
  }
}

class Organizations extends OrganizationService {
  private notUsed(): never {
    throw new Error("Organization method is not used by this test");
  }

  getSettings() {
    return this.notUsed();
  }

  updateSettings() {
    return this.notUsed();
  }

  tryGetOrganizationIdByTeamId() {
    return this.notUsed();
  }

  getBillingProfile() {
    return Promise.resolve({
      id: "org_1",
      name: "Organization",
      billingCustomerId: null,
    });
  }

  getTeamById() {
    return Promise.resolve(project.team);
  }

  listTeams() {
    return Promise.resolve({
      data: [project.team],
      pagination: { page: 1, limit: 1_000, total: 1 },
    });
  }

  getOrganizationMembers() {
    return this.notUsed();
  }
  isMember() {
    return this.notUsed();
  }
  getOldestTeamId() {
    return this.notUsed();
  }
  claimBillingCustomerId() {
    return this.notUsed();
  }
  ensurePersonalWorkspace() {
    return this.notUsed();
  }
  tryFindPersonalWorkspace() {
    return this.notUsed();
  }
  getPersonalWorkspaceFeatures() {
    return this.notUsed();
  }
  enableAllPersonalWorkspaceFeatures() {
    return this.notUsed();
  }
  disableAllPersonalWorkspaceFeatures() {
    return this.notUsed();
  }
  getTeam() {
    return this.notUsed();
  }
  createTeam() {
    return this.notUsed();
  }
  updateTeam() {
    return this.notUsed();
  }
  archiveTeam() {
    return this.notUsed();
  }
  addTeamMember() {
    return this.notUsed();
  }
  removeTeamMember() {
    return this.notUsed();
  }
  getTeamBySlugForMember() {
    return this.notUsed();
  }
  getTeamWithMembers() {
    return this.notUsed();
  }
  listTeamsWithMembers() {
    return this.notUsed();
  }
  createTeamWithMembers() {
    return this.notUsed();
  }
  updateTeamWithMembers() {
    return this.notUsed();
  }
  listTeamAccess() {
    return this.notUsed();
  }
  getGroup() {
    return this.notUsed();
  }
  listGroups() {
    return this.notUsed();
  }
  listGroupsForMember() {
    return this.notUsed();
  }
  createGroup() {
    return this.notUsed();
  }
  renameGroup() {
    return this.notUsed();
  }
  deleteGroup() {
    return this.notUsed();
  }
  addGroupMember() {
    return this.notUsed();
  }
  removeGroupMember() {
    return this.notUsed();
  }
  listGroupBindings() {
    return this.notUsed();
  }
  addGroupBinding() {
    return this.notUsed();
  }
  removeGroupBinding() {
    return this.notUsed();
  }
  applyGroupEdits() {
    return this.notUsed();
  }
}

class Defaults extends ModelDefaultRepository {
  configs: ModelDefaultConfig[] = [];
  listForProject(): Promise<ModelDefaultConfig[]> {
    return Promise.resolve(this.configs);
  }
  listForOrganization(): Promise<ModelDefaultConfig[]> {
    return Promise.resolve(this.configs);
  }
  tryGetById(id: string): Promise<ModelDefaultConfig | null> {
    return Promise.resolve(this.configs.find((config) => config.id === id) ?? null);
  }
  tryFindByScope(scope: ModelDefaultConfig["scopes"][number]): Promise<ModelDefaultConfig | null> {
    return Promise.resolve(
      this.configs.find((config) =>
        config.scopes.some(
          (item) => item.scopeType === scope.scopeType && item.scopeId === scope.scopeId,
        ),
      ) ?? null,
    );
  }
  save(input: ModelDefaultConfigSaveInput): Promise<ModelDefaultConfig> {
    const saved = {
      ...input,
      createdAt: input.createdAt ?? now,
      updatedAt: input.createdAt ?? now,
    };
    this.configs.push(saved);
    return Promise.resolve(saved);
  }
  set(_input: { id: string }): Promise<void> {
    return Promise.resolve();
  }
  delete(): Promise<void> {
    return Promise.resolve();
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
}
class Catalog extends ModelProviderCatalog {
  connectionChecks: Array<{ provider: string; customKeys: Record<string, unknown> }> = [];
  exists(providerName: string): boolean {
    return providerName === "openai";
  }
  systemProviders(): Promise<[]> {
    return Promise.resolve([]);
  }
  validateApiKey(): Promise<ModelProviderApiKeyValidation> {
    return Promise.resolve({ valid: true });
  }
  testConnection(
    provider: string,
    customKeys: Record<string, unknown>,
  ): Promise<ModelProviderCredentialVerdict> {
    this.connectionChecks.push({ provider, customKeys });
    return Promise.resolve({ outcome: "verified", valid: true });
  }
  tryGetExecutionValue(input: {
    customKeys: Record<string, unknown> | null;
    key: string;
  }): string | null {
    const value = input.customKeys?.[input.key];
    return typeof value === "string" ? value : null;
  }
  tryGetStoredExecutionValue(input: {
    customKeys: Record<string, unknown> | null;
    key: string;
  }): string | null {
    const value = input.customKeys?.[input.key];
    return typeof value === "string" ? value : null;
  }
  tryGetExecutionDefinition(_input: {
    provider: string;
  }): { apiKey: string; endpointKey: string | null } | null {
    return { apiKey: "OPENAI_API_KEY", endpointKey: "OPENAI_BASE_URL" };
  }
}
class DeprecatedCatalog extends Catalog {
  exists(providerName: string): boolean {
    return providerName === "gemini" || providerName === "google_agent_platform";
  }

  tryGetProviderDeprecation(providerName: string): { replacement?: string } | null {
    return providerName === "google_agent_platform" ? { replacement: "gemini" } : null;
  }
}
class RoutingCatalog extends Catalog {
  tryNormalizeRoutingHandle(input: string | null): string | null {
    return input?.trim().toLowerCase() || null;
  }

  tryGetRoutingHandleProblem(handle: string | null): "shape" | "reserved" | null {
    return handle === "openai" ? "reserved" : null;
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
class ExecutionCatalog extends Catalog {
  constructor(private readonly environment: Record<string, string> = {}) {
    super();
  }

  tryGetExecutionValue(input: {
    customKeys: Record<string, unknown> | null;
    key: string;
  }): string | null {
    return this.tryGetStoredExecutionValue(input) ?? this.environment[input.key] ?? null;
  }

  tryGetExecutionDefinition(input: {
    provider: string;
  }): { apiKey: string; endpointKey: string | null } | null {
    const definitions: Record<string, { apiKey: string; endpointKey: string | null }> = {
      anthropic: { apiKey: "ANTHROPIC_API_KEY", endpointKey: "ANTHROPIC_BASE_URL" },
      azure: { apiKey: "AZURE_OPENAI_API_KEY", endpointKey: "AZURE_OPENAI_ENDPOINT" },
      bedrock: { apiKey: "AWS_ACCESS_KEY_ID", endpointKey: null },
      gemini: { apiKey: "GEMINI_API_KEY", endpointKey: null },
      openai: { apiKey: "OPENAI_API_KEY", endpointKey: "OPENAI_BASE_URL" },
      vertex_ai: { apiKey: "VERTEXAI_API_KEY", endpointKey: null },
    };
    return definitions[input.provider] ?? null;
  }
}
class ManagedCatalog extends Catalog {
  input: {
    parameters: Record<string, string>;
    projectId: string;
    model: string;
    provider: string;
  } | null = null;

  prepareExecution(input: {
    parameters: Record<string, string>;
    projectId: string;
    model: string;
    provider: string;
  }): Promise<Record<string, string>> {
    this.input = input;
    return Promise.resolve(input.parameters);
  }
}
class Translator extends ModelTranslationPort {
  model: string | null = null;
  translate(input: { model: string }): Promise<string> {
    this.model = input.model;
    return Promise.resolve("translated");
  }
}
class CredentialPolicy extends ModelProviderCredentialPolicy {
  tryNormalize(_provider: string, value: Record<string, unknown> | null) {
    return value;
  }
  merge(input: {
    incoming: Record<string, unknown> | null;
    stored: Record<string, unknown> | null;
  }) {
    const edited = Object.fromEntries(
      Object.entries(input.incoming ?? {}).map(([key, value]) => [
        key,
        value === "••••" ? input.stored?.[key] : value,
      ]),
    );
    const preserved = Object.entries(input.stored ?? {}).filter(
      ([key]) => key === "apiKey" && !(key in edited),
    );

    return { ...edited, ...Object.fromEntries(preserved) };
  }
  tryMask(value: Record<string, unknown> | null) {
    return value ? { ...value, apiKey: "••••" } : null;
  }
  hasUsableReplacement(value: Record<string, unknown> | null): boolean {
    return Object.values(value ?? {}).some(
      (field) => typeof field === "string" && field.length > 0 && field !== "••••",
    );
  }
  assertCredentialsCanBeSaved(input: {
    storedCredentialsUnreadable: boolean;
    incoming: Record<string, unknown> | null;
  }): void {
    if (input.storedCredentialsUnreadable && !this.hasUsableReplacement(input.incoming)) {
      throw new ModelProviderCredentialsUnreadableError("openai");
    }
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
class HeaderCredentialPolicy extends CredentialPolicy {
  mergeHeaders(input: {
    incoming: Array<{ key: string; value: string }>;
    stored: Array<{ key: string; value: string }>;
  }): Array<{ key: string; value: string }> {
    const incomingKeys = new Set(input.incoming.map(({ key }) => key));
    return input.incoming.flatMap((header, index) => {
      if (header.value !== "••••") return [header];

      const storedByKey = input.stored.find(({ key }) => key === header.key);
      if (storedByKey) return [{ key: header.key, value: storedByKey.value }];

      const storedAtPosition = input.stored[index];
      const canReusePosition =
        storedAtPosition !== undefined && !incomingKeys.has(storedAtPosition.key);
      return canReusePosition ? [{ key: header.key, value: storedAtPosition.value }] : [];
    });
  }
}
function service(
  providers = new Providers(),
  catalog: ModelProviderCatalog = new Catalog(),
  codexTokenRefresher = new CodexRefresher(),
  authorization: AuthzService = new Authorization(),
  connectionRateLimiter = new ConnectionRateLimiter(),
  credentialPolicy: ModelProviderCredentialPolicy = new CredentialPolicy(),
  defaults = new Defaults(),
) {
  return ModelProviderService.create({
    repository: providers,
    projects: new Projects(),
    organizations: new Organizations(),
    credentialPolicy,
    codexTokenRefresher,
    connectionRateLimiter,
    defaults,
    costs: new Costs(),
    catalog,
    authorization,
    translation: new Translator(),
    ids: new Ids(),
  });
}

function serviceWithDefaults(defaults: Defaults): ModelProviderService {
  return service(
    new Providers(),
    new Catalog(),
    new CodexRefresher(),
    new Authorization(),
    new ConnectionRateLimiter(),
    new CredentialPolicy(),
    defaults,
  );
}

describe("ModelProviderService", () => {
  it("resolves the newest feature default through the project scope chain", async () => {
    const defaults = new Defaults();
    defaults.configs = [
      {
        id: "team-default",
        config: { DEFAULT: "openai/gpt-5-mini" },
        scopes: [{ scopeType: "TEAM", scopeId: "team_1" }],
        authorId: null,
        createdAt: new Date(1),
      },
    ];

    await expect(
      service(
        new Providers(),
        new Catalog(),
        new CodexRefresher(),
        new Authorization(),
        new ConnectionRateLimiter(),
        new CredentialPolicy(),
        defaults,
      ).resolveModelForFeature({
        projectId: "project_1",
        featureKey: "prompt.create_default",
      }),
    ).resolves.toMatchObject({
      model: "openai/gpt-5-mini",
      source: "role_default",
      scope: "team",
    });
  });

  it("prefers the narrowest scope and a feature override within that scope", async () => {
    const defaults = new Defaults();
    defaults.configs = [
      {
        id: "organization-default",
        config: { FAST: "openai/gpt-5-mini" },
        scopes: [{ scopeType: "ORGANIZATION", scopeId: "org_1" }],
        authorId: null,
        createdAt: new Date(2),
      },
      {
        id: "project-default",
        config: {
          FAST: "openai/gpt-5-mini",
          "traces.ai_search": "anthropic/claude-sonnet-4-6",
        },
        scopes: [{ scopeType: "PROJECT", scopeId: "project_1" }],
        authorId: null,
        createdAt: new Date(1),
      },
    ];

    await expect(
      serviceWithDefaults(defaults).resolveModelForFeature({
        projectId: "project_1",
        featureKey: "traces.ai_search",
      }),
    ).resolves.toMatchObject({
      model: "anthropic/claude-sonnet-4-6",
      source: "feature_override",
      scope: "project",
    });
  });

  it("uses the newest config when duplicate rows exist at one scope", async () => {
    const defaults = new Defaults();
    defaults.configs = [
      {
        id: "old",
        config: { DEFAULT: "openai/gpt-5-mini" },
        scopes: [{ scopeType: "PROJECT", scopeId: "project_1" }],
        authorId: null,
        createdAt: new Date(1),
      },
      {
        id: "new",
        config: { DEFAULT: "openai/gpt-5.5" },
        scopes: [{ scopeType: "PROJECT", scopeId: "project_1" }],
        authorId: null,
        createdAt: new Date(2),
      },
    ];

    await expect(
      serviceWithDefaults(defaults).resolveModelForFeature({
        projectId: "project_1",
        featureKey: "prompt.create_default",
      }),
    ).resolves.toMatchObject({ model: "openai/gpt-5.5", scope: "project" });
  });

  it("skips restricted defaults and reports restricted-only exhaustion", async () => {
    const defaults = new Defaults();
    const restricted = {
      id: "restricted-project",
      config: { DEFAULT: CODEX_DEFAULT_MODEL },
      scopes: [{ scopeType: "PROJECT" as const, scopeId: "project_1" }],
      authorId: null,
      createdAt: new Date(2),
    };
    defaults.configs = [
      restricted,
      {
        id: "organization-default",
        config: { DEFAULT: "openai/gpt-5-mini" },
        scopes: [{ scopeType: "ORGANIZATION", scopeId: "org_1" }],
        authorId: null,
        createdAt: new Date(1),
      },
    ];

    await expect(
      serviceWithDefaults(defaults).resolveModelForFeature({
        projectId: "project_1",
        featureKey: "prompt.create_default",
      }),
    ).resolves.toMatchObject({ model: "openai/gpt-5-mini", scope: "organization" });

    defaults.configs = [restricted];
    await expect(
      serviceWithDefaults(defaults).resolveModelForFeature({
        projectId: "project_1",
        featureKey: "prompt.create_default",
      }),
    ).rejects.toMatchObject({
      code: "model_restricted_for_feature",
      meta: { restrictedModels: [CODEX_DEFAULT_MODEL] },
    });
  });

  it("distinguishes unknown features from an empty configured cascade", async () => {
    const modelProviders = service();

    await expect(
      modelProviders.resolveModelForFeature({
        projectId: "project_1",
        featureKey: "not-a-feature",
      }),
    ).rejects.toMatchObject({ code: "model_provider_invalid" });
    await expect(
      modelProviders.resolveModelForFeature({
        projectId: "project_1",
        featureKey: "prompt.create_default",
      }),
    ).rejects.toMatchObject({ code: "model_not_configured" });
  });

  it("expands latest aliases before returning a resolution", async () => {
    const defaults = new Defaults();
    defaults.configs = [
      {
        id: "alias",
        config: { DEFAULT: "openai/latest" },
        scopes: [{ scopeType: "PROJECT", scopeId: "project_1" }],
        authorId: null,
        createdAt: new Date(1),
      },
    ];

    await expect(
      serviceWithDefaults(defaults).resolveModelForFeature({
        projectId: "project_1",
        featureKey: "prompt.create_default",
      }),
    ).resolves.toMatchObject({ model: expandLatestAlias("openai/latest") });
  });

  it("falls back from Langy to the prompt default", async () => {
    const defaults = new Defaults();
    defaults.configs = [
      {
        id: "prompt-default",
        config: { DEFAULT: "openai/gpt-5-mini" },
        scopes: [{ scopeType: "PROJECT", scopeId: "project_1" }],
        authorId: null,
        createdAt: new Date(1),
      },
    ];

    await expect(
      serviceWithDefaults(defaults).resolveModelForFeature({
        projectId: "project_1",
        featureKey: "langy.chat",
      }),
    ).resolves.toMatchObject({ model: "openai/gpt-5-mini", source: "role_default" });
  });

  it("finds the next wider configured scope below a resolved project default", async () => {
    const defaults = new Defaults();
    defaults.configs = [
      {
        id: "project-default",
        config: { DEFAULT: "openai/gpt-5.5" },
        scopes: [{ scopeType: "PROJECT", scopeId: "project_1" }],
        authorId: null,
        createdAt: new Date(2),
      },
      {
        id: "organization-default",
        config: { DEFAULT: "anthropic/claude-sonnet-4-6" },
        scopes: [{ scopeType: "ORGANIZATION", scopeId: "org_1" }],
        authorId: null,
        createdAt: new Date(1),
      },
    ];

    await expect(
      serviceWithDefaults(defaults).findAlternateModel({
        projectId: "project_1",
        featureKey: "prompt.create_default",
        skipFromScope: "project",
      }),
    ).resolves.toMatchObject({
      model: "anthropic/claude-sonnet-4-6",
      scope: "organization",
    });
  });

  it("throws the handled missing-model error when no wider alternate exists", async () => {
    const defaults = new Defaults();
    defaults.configs = [
      {
        id: "project-default",
        config: { DEFAULT: "openai/gpt-5.5" },
        scopes: [{ scopeType: "PROJECT", scopeId: "project_1" }],
        authorId: null,
        createdAt: new Date(1),
      },
    ];

    await expect(
      serviceWithDefaults(defaults).findAlternateModel({
        projectId: "project_1",
        featureKey: "prompt.create_default",
        skipFromScope: "project",
      }),
    ).rejects.toMatchObject({
      code: "model_not_configured",
      meta: {
        featureKey: "prompt.create_default",
        role: "DEFAULT",
        projectId: "project_1",
      },
    });
  });

  /** @scenario "provider summaries never expose credentials" */
  it("masks credentials in frontend summaries", async () => {
    const result = await service().listForProject({ projectId: "project_1" });
    expect(result[0]?.customKeys).toEqual({ apiKey: "••••" });
  });
  /** @scenario "an unknown provider cannot be persisted" */
  it("rejects unknown providers before persistence", async () => {
    const providers = new Providers();

    await expect(
      service(providers).upsert({ projectId: "project_1", provider: "unknown", enabled: true }),
    ).rejects.toMatchObject({ code: "model_provider_invalid" });
    expect(providers.created).toHaveLength(0);
    expect(providers.updates).toHaveLength(0);
  });
  it("refuses a new row for a deprecated provider but keeps stored rows editable", async () => {
    const providers = new Providers();
    providers.rows = [];
    const modelProviders = service(providers, new DeprecatedCatalog());

    await expect(
      modelProviders.upsert({
        projectId: "project_1",
        provider: "google_agent_platform",
        enabled: true,
      }),
    ).rejects.toMatchObject({
      code: "model_provider_deprecated",
      meta: { provider: "google_agent_platform", replacement: "gemini" },
    });
    expect(providers.rows).toEqual([]);

    providers.rows = [provider({ provider: "google_agent_platform" })];
    await expect(
      modelProviders.upsert({
        id: "mp_1",
        projectId: "project_1",
        provider: "google_agent_platform",
        enabled: false,
      }),
    ).resolves.toMatchObject({ id: "mp_1", enabled: false });
  });
  it("allows a new row for the provider that replaces a deprecated provider", async () => {
    const providers = new Providers();
    providers.rows = [];

    await expect(
      service(providers, new DeprecatedCatalog()).upsert({
        projectId: "project_1",
        provider: "gemini",
        enabled: true,
      }),
    ).resolves.toMatchObject({ provider: "gemini" });
    expect(providers.created).toHaveLength(1);
  });
  it("normalizes routing handles before persistence and rejects reserved names", async () => {
    const providers = new Providers();
    const modelProviders = service(providers, new RoutingCatalog());

    await expect(
      modelProviders.upsert({
        id: "mp_1",
        projectId: "project_1",
        provider: "openai",
        enabled: true,
        routingHandle: "  Eu-West  ",
      }),
    ).resolves.toMatchObject({ routingHandle: "eu-west" });

    await expect(
      modelProviders.upsert({
        id: "mp_1",
        projectId: "project_1",
        provider: "openai",
        enabled: true,
        routingHandle: "openai",
      }),
    ).rejects.toMatchObject({
      code: "model_provider_routing_handle_invalid",
      meta: { handle: "openai", problem: "reserved" },
    });
  });
  it("tests only a stored, authorized provider and applies the connection-test budget", async () => {
    const providers = new Providers();
    const authorization = new Authorization();
    const limiter = new ConnectionRateLimiter();
    const modelProviders = service(
      providers,
      new Catalog(),
      new CodexRefresher(),
      authorization,
      limiter,
    );

    await expect(
      modelProviders.testConnection({
        modelProviderId: "mp_1",
        organizationId: "org_1",
        actorId: "user_1",
      }),
    ).resolves.toEqual({ outcome: "verified", valid: true });
    expect(limiter.calls).toBe(1);

    authorization.canWriteResult = false;
    await expect(
      modelProviders.testConnection({
        modelProviderId: "mp_1",
        organizationId: "org_1",
        actorId: "user_1",
      }),
    ).rejects.toMatchObject({ code: "model_provider_scope_forbidden" });
    expect(limiter.calls).toBe(1);

    authorization.canWriteResult = true;
    limiter.error = new Error("rate limited");
    await expect(
      modelProviders.testConnection({
        modelProviderId: "mp_1",
        organizationId: "org_1",
        actorId: "user_1",
      }),
    ).rejects.toThrow("rate limited");
  });
  /** @scenario "translation uses the configured feature default" */
  it("resolves translation through the default-model repository and port", async () => {
    const defaults = new Defaults();
    defaults.configs = [
      {
        id: "translation-default",
        config: { FAST: "openai/gpt-5-mini" },
        scopes: [{ scopeType: "PROJECT", scopeId: "project_1" }],
        authorId: null,
        createdAt: now,
      },
    ];
    const catalog = new Catalog();
    const translation = new Translator();
    catalog.defaultFeatures = () => [
      {
        key: "translate.text",
        role: "FAST",
        displayName: "Inline translation",
        description: "Translates user-supplied text into English.",
      },
    ];
    const modelProviders = ModelProviderService.create({
      repository: new Providers(),
      projects: new Projects(),
      organizations: new Organizations(),
      credentialPolicy: new CredentialPolicy(),
      codexTokenRefresher: new CodexRefresher(),
      connectionRateLimiter: new ConnectionRateLimiter(),
      defaults,
      costs: new Costs(),
      catalog,
      authorization: new Authorization(),
      translation,
      ids: new Ids(),
    });

    await expect(
      modelProviders.translate({ projectId: "project_1", text: "hello" }),
    ).resolves.toEqual({ translation: "translated" });
    expect(translation.model).toBe("openai/gpt-5-mini");
  });
  it("prepares model execution through the canonical service and managed seam", async () => {
    const providers = new Providers();
    providers.rows = [
      provider({
        customKeys: {
          OPENAI_API_KEY: "stored-openai-key",
          OPENAI_BASE_URL: "https://models.example.test/v1",
        },
      }),
    ];
    const managed = new ManagedCatalog();
    const modelProviders = ModelProviderService.create({
      repository: providers,
      projects: new Projects(),
      organizations: new Organizations(),
      credentialPolicy: new CredentialPolicy(),
      codexTokenRefresher: new CodexRefresher(),
      connectionRateLimiter: new ConnectionRateLimiter(),
      defaults: new Defaults(),
      costs: new Costs(),
      catalog: managed,
      authorization: new Authorization(),
      translation: new Translator(),
      ids: new Ids(),
    });

    await expect(
      modelProviders.prepareExecution({
        projectId: "project_1",
        model: "openai/gpt-4o",
      }),
    ).resolves.toEqual({
      model: "openai/gpt-4o",
      api_key: "stored-openai-key",
      api_base: "https://models.example.test/v1",
    });
    expect(managed.input).toMatchObject({
      projectId: "project_1",
      model: "openai/gpt-4o",
      provider: "openai",
    });
  });
  it("keeps the Codex execution refusal byte-for-byte", async () => {
    await expect(
      service().prepareExecution({
        projectId: "project_1",
        model: "openai_codex/gpt-5.6-terra",
      }),
    ).rejects.toThrow(
      '"openai_codex/gpt-5.6-terra" serves the coding-assistant surfaces only and cannot run workflows, evaluations or the playground.',
    );
  });
  it("uses the canonical Azure endpoint, version, deployment, and headers", async () => {
    const providers = new Providers();
    providers.rows = [
      provider({
        provider: "azure",
        customKeys: {
          AZURE_OPENAI_API_KEY: "azure-key",
          AZURE_OPENAI_ENDPOINT: "https://acme.openai.azure.com",
          AZURE_OPENAI_API_VERSION: "2025-01-01-preview",
        },
        customModels: [{ id: "gpt-5.4", label: "GPT 5.4", type: "chat" }],
        deploymentMapping: { "azure/gpt-5.4": "acme-gpt-5" },
        extraHeaders: [{ key: "X-Customer", value: "acme" }],
      }),
    ];

    await expect(
      service(providers, new ExecutionCatalog()).prepareExecution({
        projectId: "project_1",
        model: "azure/gpt-5.4",
      }),
    ).resolves.toEqual({
      model: "azure/gpt-5.4",
      api_key: "azure-key",
      api_base: "https://acme.openai.azure.com",
      api_version: "2025-01-01-preview",
      deployment: "acme-gpt-5",
      extra_headers: '{"X-Customer":"acme"}',
    });
  });
  it("uses the direct Azure version default when no override is configured", async () => {
    const providers = new Providers();
    providers.rows = [
      provider({
        provider: "azure",
        customKeys: { AZURE_OPENAI_API_KEY: "azure-key" },
        customModels: [{ id: "gpt-5.4", label: "GPT 5.4", type: "chat" }],
      }),
    ];

    await expect(
      service(providers, new ExecutionCatalog()).prepareExecution({
        projectId: "project_1",
        model: "azure/gpt-5.4",
      }),
    ).resolves.toMatchObject({
      model: "azure/gpt-5.4",
      api_version: DEFAULT_AZURE_API_VERSION,
    });
  });
  it("uses Azure gateway mode when its base URL is configured", async () => {
    const providers = new Providers();
    providers.rows = [
      provider({
        provider: "azure",
        customKeys: {
          AZURE_OPENAI_API_KEY: "azure-key",
          AZURE_API_GATEWAY_BASE_URL: "https://gateway.example.test/azure",
          AZURE_API_GATEWAY_VERSION: "2024-09-01",
        },
        customModels: [{ id: "gpt-5.4", label: "GPT 5.4", type: "chat" }],
      }),
    ];

    await expect(
      service(providers, new ExecutionCatalog()).prepareExecution({
        projectId: "project_1",
        model: "azure/gpt-5.4",
      }),
    ).resolves.toMatchObject({
      api_base: "https://gateway.example.test/azure",
      api_version: "2024-09-01",
      use_azure_gateway: "true",
    });
  });
  it("normalizes an mp-id model reference with the stored provider", async () => {
    const providers = new Providers();
    providers.rows = [
      provider({
        id: "mp_azure_123",
        provider: "azure",
        customKeys: { AZURE_OPENAI_API_KEY: "azure-key" },
        deploymentMapping: { "azure/my-gpt4-deployment": "azure-deployment" },
      }),
    ];

    await expect(
      service(providers, new ExecutionCatalog()).prepareExecution({
        projectId: "project_1",
        model: "mp_azure_123/my-gpt4-deployment",
      }),
    ).resolves.toMatchObject({
      model: "azure/my-gpt4-deployment",
      deployment: "azure-deployment",
    });
  });
  it("strips Anthropic's version suffix written without a trailing slash", async () => {
    const providers = new Providers();
    providers.rows = [
      provider({
        provider: "anthropic",
        customKeys: {
          ANTHROPIC_API_KEY: "anthropic-key",
          ANTHROPIC_BASE_URL: "https://api.anthropic.com/v1",
        },
        customModels: [{ id: "claude-opus-4.5", label: "Claude Opus", type: "chat" }],
      }),
    ];

    await expect(
      service(providers, new ExecutionCatalog()).prepareExecution({
        projectId: "project_1",
        model: "anthropic/claude-opus-4.5",
      }),
    ).resolves.toMatchObject({ api_base: "https://api.anthropic.com" });
  });
  it("leaves an Anthropic base URL that carries no version suffix alone", async () => {
    const providers = new Providers();
    providers.rows = [
      provider({
        provider: "anthropic",
        customKeys: {
          ANTHROPIC_API_KEY: "anthropic-key",
          ANTHROPIC_BASE_URL: "https://custom-anthropic.example.com",
        },
        customModels: [{ id: "claude-opus-4.5", label: "Claude Opus", type: "chat" }],
      }),
    ];

    await expect(
      service(providers, new ExecutionCatalog()).prepareExecution({
        projectId: "project_1",
        model: "anthropic/claude-opus-4.5",
      }),
    ).resolves.toMatchObject({ api_base: "https://custom-anthropic.example.com" });
  });
  it("normalizes Anthropic's versioned model and base URL", async () => {
    const providers = new Providers();
    providers.rows = [
      provider({
        provider: "anthropic",
        customKeys: {
          ANTHROPIC_API_KEY: "anthropic-key",
          ANTHROPIC_BASE_URL: "https://api.anthropic.com/v1/",
        },
        customModels: [{ id: "claude-opus-4.5", label: "Claude Opus", type: "chat" }],
      }),
    ];

    await expect(
      service(providers, new ExecutionCatalog()).prepareExecution({
        projectId: "project_1",
        model: "anthropic/claude-opus-4.5",
      }),
    ).resolves.toMatchObject({
      model: "anthropic/claude-opus-4-5",
      api_base: "https://api.anthropic.com",
    });
  });
  it("keeps Gemini Agent Platform values with their stored credential", async () => {
    const providers = new Providers();
    providers.rows = [
      provider({
        provider: "gemini",
        customKeys: {
          GEMINI_API_KEY: "gemini-key",
          GEMINI_PROJECT: "stored-project",
          GEMINI_LOCATION: "europe-west4",
        },
        customModels: [{ id: "gemini-2.5-pro", label: "Gemini", type: "chat" }],
      }),
    ];

    await expect(
      service(
        providers,
        new ExecutionCatalog({
          GEMINI_PROJECT: "environment-project",
          GEMINI_LOCATION: "us-central1",
        }),
      ).prepareExecution({
        projectId: "project_1",
        model: "gemini/gemini-2.5-pro",
      }),
    ).resolves.toMatchObject({
      api_key: "gemini-key",
      project_id: "stored-project",
      region: "europe-west4",
    });
  });
  it("uses injected configuration when preparing a Vertex execution", async () => {
    const providers = new Providers();
    providers.rows = [
      provider({
        provider: "vertex_ai",
        customKeys: null,
        customModels: [{ id: "gemini-2.5-pro", label: "Gemini", type: "chat" }],
      }),
    ];

    await expect(
      service(
        providers,
        new ExecutionCatalog({
          VERTEXAI_API_KEY: "vertex-credential",
          VERTEXAI_LOCATION: "europe-west4",
          VERTEXAI_PROJECT: "vertex-project",
        }),
      ).prepareExecution({
        projectId: "project_1",
        model: "vertex_ai/gemini-2.5-pro",
      }),
    ).resolves.toEqual({
      model: "vertex_ai/gemini-2.5-pro",
      vertex_credentials: "vertex-credential",
      vertex_project: "vertex-project",
      vertex_location: "europe-west4",
    });
  });
  it("keeps the Codex refusal for an explicit model-provider row", async () => {
    const providers = new Providers();
    providers.rows = [
      provider({
        id: "mp_codexrow123",
        provider: "openai_codex",
        customKeys: { CODEX_ACCESS_TOKEN: "oauth-token" },
      }),
    ];

    await expect(
      service(providers).prepareExecution({
        projectId: "project_1",
        model: "mp_codexrow123/gpt-5.6-terra",
      }),
    ).rejects.toThrow(
      '"mp_codexrow123/gpt-5.6-terra" serves the coding-assistant surfaces only and cannot run workflows, evaluations or the playground.',
    );
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

    await expect(service(providers).getCodexStatus({ projectId: "project_1" })).resolves.toEqual({
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
  it("does not let a disabled project row mask an enabled organization row", async () => {
    const providers = new Providers();
    providers.rows = [
      provider({
        id: "organization-row",
        enabled: true,
        scopes: [{ scopeType: "ORGANIZATION", scopeId: "org_1" }],
        customModels: [{ id: "deployment", label: "Deployment", type: "chat" }],
      }),
      provider({
        id: "project-row",
        enabled: false,
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
    ).resolves.toMatchObject({ id: "organization-row" });
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
    const defaults = new Defaults();
    const modelProviders = ModelProviderService.create({
      repository: providers,
      projects: new Projects(),
      organizations: new Organizations(),
      credentialPolicy: new CredentialPolicy(),
      codexTokenRefresher: new CodexRefresher(),
      connectionRateLimiter: new ConnectionRateLimiter(),
      defaults,
      costs: new Costs(),
      catalog: new Catalog(),
      authorization: new Authorization(),
      translation: new Translator(),
      ids: new Ids(),
    });

    await modelProviders.upsert({
      projectId: "project_1",
      provider: "openai",
      enabled: true,
    });

    expect(defaults.configs).toEqual([
      expect.objectContaining({
        config: {
          DEFAULT: "openai/latest",
          FAST: "openai/latest-mini",
          EMBEDDINGS: expect.stringMatching(/^openai\/text-embedding-/),
        },
        scopes: [{ scopeType: "PROJECT", scopeId: "project_1" }],
      }),
    ]);
  });

  it("does not overwrite an existing onboarding default at the provider scope", async () => {
    const providers = new Providers();
    providers.rows = [];
    const defaults = new Defaults();
    defaults.configs = [
      {
        id: "existing",
        config: { DEFAULT: "customer-choice" },
        scopes: [{ scopeType: "PROJECT", scopeId: "project_1" }],
        authorId: null,
        createdAt: now,
      },
    ];

    await ModelProviderService.create({
      repository: providers,
      projects: new Projects(),
      organizations: new Organizations(),
      credentialPolicy: new CredentialPolicy(),
      codexTokenRefresher: new CodexRefresher(),
      connectionRateLimiter: new ConnectionRateLimiter(),
      defaults,
      costs: new Costs(),
      catalog: new Catalog(),
      authorization: new Authorization(),
      translation: new Translator(),
      ids: new Ids(),
    }).upsert({ projectId: "project_1", provider: "openai", enabled: true });

    expect(defaults.configs).toHaveLength(1);
    expect(defaults.configs[0]?.config).toEqual({ DEFAULT: "customer-choice" });
  });

  it("persists a Codex token rotation through the canonical repository", async () => {
    const providers = new Providers();
    const refreshed: CodexTokenKeys = {
      CODEX_ACCESS_TOKEN: "new-access",
      CODEX_REFRESH_TOKEN: "new-refresh",
      CODEX_ID_TOKEN: "id-token",
      CODEX_ACCOUNT_ID: "account-1",
      CODEX_PLAN: "plus",
      CODEX_EMAIL: "person@example.test",
      CODEX_TOKENS_SAVED_AT: "2026-01-01T00:00:00.000Z",
    };
    providers.rows = [
      provider({
        provider: "openai_codex",
        customKeys: {
          ...refreshed,
          CODEX_ACCESS_TOKEN: "old-access",
          CODEX_TOKENS_SAVED_AT: "2020-01-01T00:00:00.000Z",
        },
      }),
    ];
    const refresher = new CodexRefresher();
    refresher.result = { status: "refreshed", tokens: refreshed };

    await expect(
      service(providers, new Catalog(), refresher).refreshCodexForGateway({
        providerRowId: "mp_1",
      }),
    ).resolves.toEqual({
      status: "refreshed",
      accessToken: "new-access",
      accountId: "account-1",
    });
    expect(providers.updates).toHaveLength(1);
    expect(providers.updates[0]?.customKeys).toEqual(refreshed);
  });

  it("does not persist a rejected Codex session", async () => {
    const providers = new Providers();
    providers.rows = [
      provider({
        provider: "openai_codex",
        customKeys: {
          CODEX_ACCESS_TOKEN: "old-access",
          CODEX_REFRESH_TOKEN: "old-refresh",
          CODEX_ID_TOKEN: "id-token",
          CODEX_ACCOUNT_ID: "account-1",
          CODEX_PLAN: "plus",
          CODEX_EMAIL: "person@example.test",
          CODEX_TOKENS_SAVED_AT: "2020-01-01T00:00:00.000Z",
        },
      }),
    ];

    await expect(
      service(providers).refreshCodexForGateway({ providerRowId: "mp_1" }),
    ).resolves.toEqual({ status: "session_expired" });
    expect(providers.updates).toHaveLength(0);
  });

  it("reuses a token that another gateway request just refreshed", async () => {
    const providers = new Providers();
    providers.rows = [
      provider({
        provider: "openai_codex",
        customKeys: {
          CODEX_ACCESS_TOKEN: "fresh-access",
          CODEX_REFRESH_TOKEN: "fresh-refresh",
          CODEX_ID_TOKEN: "id-token",
          CODEX_ACCOUNT_ID: "account-1",
          CODEX_PLAN: "plus",
          CODEX_EMAIL: "person@example.test",
          CODEX_TOKENS_SAVED_AT: new Date().toISOString(),
        },
      }),
    ];
    const refresher = new CodexRefresher();

    await expect(
      service(providers, new Catalog(), refresher).refreshCodexForGateway({
        providerRowId: "mp_1",
      }),
    ).resolves.toEqual({
      status: "refreshed",
      accessToken: "fresh-access",
      accountId: "account-1",
    });
    expect(refresher.calls).toBe(0);
    expect(providers.updates).toHaveLength(0);
  });

  it("does not refresh a row owned by another provider", async () => {
    const providers = new Providers();
    const refresher = new CodexRefresher();

    await expect(
      service(providers, new Catalog(), refresher).refreshCodexForGateway({
        providerRowId: "mp_1",
      }),
    ).resolves.toEqual({ status: "not_connected" });
    expect(refresher.calls).toBe(0);
    expect(providers.updates).toHaveLength(0);
  });

  it("propagates a transient Codex issuer failure without persisting tokens", async () => {
    const providers = new Providers();
    providers.rows = [
      provider({
        provider: "openai_codex",
        customKeys: {
          CODEX_ACCESS_TOKEN: "old-access",
          CODEX_REFRESH_TOKEN: "old-refresh",
          CODEX_ID_TOKEN: "id-token",
          CODEX_ACCOUNT_ID: "account-1",
          CODEX_PLAN: "plus",
          CODEX_EMAIL: "person@example.test",
          CODEX_TOKENS_SAVED_AT: "2020-01-01T00:00:00.000Z",
        },
      }),
    ];
    const refresher = new CodexRefresher();
    const failure = new Error("issuer unavailable");
    refresher.failure = failure;

    await expect(
      service(providers, new Catalog(), refresher).refreshCodexForGateway({
        providerRowId: "mp_1",
      }),
    ).rejects.toBe(failure);
    expect(providers.updates).toHaveLength(0);
  });

  it("rejects an organization-scoped create before persisting when the actor lacks that scope", async () => {
    const providers = new Providers();
    providers.rows = [];
    const authorization = new Authorization();
    authorization.canWriteResult = false;

    await expect(
      service(providers, new Catalog(), new CodexRefresher(), authorization).upsert({
        organizationId: "org_1",
        actorId: "user_1",
        provider: "openai",
        enabled: true,
        scopes: [{ scopeType: "ORGANIZATION", scopeId: "org_1" }],
      }),
    ).rejects.toMatchObject({ code: "model_provider_scope_forbidden" });
    expect(providers.created).toEqual([]);
  });

  it("authorizes every old and new scope before replacing a provider scope set", async () => {
    const providers = new Providers();
    providers.rows = [
      provider({
        scopes: [{ scopeType: "ORGANIZATION", scopeId: "org_1" }],
      }),
    ];
    const authorization = new Authorization();

    await service(providers, new Catalog(), new CodexRefresher(), authorization).upsert({
      id: "mp_1",
      projectId: "project_1",
      actorId: "user_1",
      provider: "openai",
      enabled: true,
      scopes: [{ scopeType: "PROJECT", scopeId: "project_1" }],
    });

    expect(authorization.writes).toEqual([
      { actorId: "user_1", scopeType: "ORGANIZATION", scopeId: "org_1" },
      { actorId: "user_1", scopeType: "PROJECT", scopeId: "project_1" },
    ]);
    expect(providers.rows[0]?.scopes).toEqual([{ scopeType: "PROJECT", scopeId: "project_1" }]);
  });

  it("does not turn a missing id into a new provider row", async () => {
    const providers = new Providers();
    providers.rows = [];

    await expect(
      service(providers).upsert({
        id: "missing",
        projectId: "project_1",
        provider: "openai",
        enabled: true,
      }),
    ).rejects.toMatchObject({ code: "model_provider_not_found" });
    expect(providers.created).toEqual([]);
  });

  it("refuses a denied delete without mutating the stored provider", async () => {
    const providers = new Providers();
    const authorization = new Authorization();
    authorization.canWriteResult = false;

    await expect(
      service(providers, new Catalog(), new CodexRefresher(), authorization).delete({
        id: "mp_1",
        projectId: "project_1",
        actorId: "user_1",
        provider: "openai",
      }),
    ).rejects.toMatchObject({ code: "model_provider_scope_forbidden" });
    expect(providers.rows).toHaveLength(1);
    expect(providers.deleted).toEqual([]);
  });

  it("refuses unreadable stored credentials until a usable replacement is supplied", async () => {
    const providers = new Providers();
    providers.rows = [provider({ customKeys: null })];
    providers.storedCredentialIds.add("mp_1");
    const modelProviders = service(providers);

    await expect(
      modelProviders.upsert({
        id: "mp_1",
        projectId: "project_1",
        provider: "openai",
        enabled: true,
        customKeys: { apiKey: "••••" },
      }),
    ).rejects.toMatchObject({ code: "model_provider_credentials_unreadable" });
    expect(providers.rows[0]?.customKeys).toBeNull();

    await expect(
      modelProviders.upsert({
        id: "mp_1",
        projectId: "project_1",
        provider: "openai",
        enabled: true,
        customKeys: { apiKey: "replacement" },
      }),
    ).resolves.toMatchObject({ customKeys: { apiKey: "replacement" } });
  });

  it("keeps an omitted secret while accepting a replacement endpoint", async () => {
    const providers = new Providers();
    providers.rows = [
      provider({
        customKeys: {
          apiKey: "secret",
          publicBaseUrl: "https://old.example.test",
        },
      }),
    ];

    await service(providers).upsert({
      id: "mp_1",
      projectId: "project_1",
      provider: "openai",
      enabled: true,
      customKeys: { publicBaseUrl: "https://new.example.test" },
    });

    expect(providers.rows[0]?.customKeys).toEqual({
      apiKey: "secret",
      publicBaseUrl: "https://new.example.test",
    });
  });

  it("uses stored credentials for a connection check and never request-supplied values", async () => {
    const providers = new Providers();
    providers.rows = [provider({ customKeys: { apiKey: "stored-secret" } })];
    const catalog = new Catalog();
    const authorization = new Authorization();

    await service(providers, catalog, new CodexRefresher(), authorization).testConnection({
      modelProviderId: "mp_1",
      organizationId: "org_1",
      actorId: "user_1",
    });

    expect(catalog.connectionChecks).toEqual([
      { provider: "openai", customKeys: { apiKey: "stored-secret" } },
    ]);
  });

  it("does not rate-limit a connection check that authorization rejects", async () => {
    const authorization = new Authorization();
    authorization.canWriteResult = false;
    const limiter = new ConnectionRateLimiter();

    await expect(
      service(
        new Providers(),
        new Catalog(),
        new CodexRefresher(),
        authorization,
        limiter,
      ).testConnection({
        modelProviderId: "mp_1",
        organizationId: "org_1",
        actorId: "user_1",
      }),
    ).rejects.toMatchObject({ code: "model_provider_scope_forbidden" });
    expect(limiter.calls).toBe(0);
  });

  it("does not test a provider row with no granted scope", async () => {
    const providers = new Providers();
    providers.rows = [provider({ scopes: [] })];
    const catalog = new Catalog();

    await expect(
      service(providers, catalog).testConnection({
        modelProviderId: "mp_1",
        organizationId: "org_1",
      }),
    ).rejects.toMatchObject({ code: "model_provider_not_found" });
    expect(catalog.connectionChecks).toEqual([]);
  });

  it("does not disclose a provider row from another organization during a connection check", async () => {
    const providers = new Providers();
    providers.rows = [provider({ organizationId: "other-organization" })];
    const catalog = new Catalog();

    await expect(
      service(providers, catalog).testConnection({
        modelProviderId: "mp_1",
        organizationId: "org_1",
      }),
    ).rejects.toMatchObject({ code: "model_provider_not_found" });
    expect(catalog.connectionChecks).toEqual([]);
  });

  it("selects the oldest matching row when visible rows have the same scope tier", async () => {
    const providers = new Providers();
    providers.rows = [
      provider({
        id: "newer",
        createdAt: new Date("2026-01-02"),
        customModels: [{ id: "deployment", label: "Deployment", type: "chat" }],
      }),
      provider({
        id: "older",
        createdAt: new Date("2026-01-01"),
        customModels: [{ id: "deployment", label: "Deployment", type: "chat" }],
      }),
    ];

    await expect(
      service(providers).tryFindRowServingModel({
        projectId: "project_1",
        provider: "openai",
        model: "deployment",
      }),
    ).resolves.toMatchObject({ id: "older" });
  });

  it("selects an embeddings row only when that row advertises the embedding model", async () => {
    const providers = new Providers();
    providers.rows = [
      provider({
        id: "chat-row",
        customModels: [{ id: "gpt-4o", label: "Chat", type: "chat" }],
      }),
      provider({
        id: "embedding-row",
        customEmbeddingsModels: [
          { id: "text-embedding-3-small", label: "Embedding", type: "embedding" },
        ],
      }),
    ];

    await expect(
      service(providers).tryFindRowServingModel({
        projectId: "project_1",
        provider: "openai",
        model: "text-embedding-3-small",
      }),
    ).resolves.toMatchObject({ id: "embedding-row" });
  });

  it("restores each masked header by name through the canonical save path", async () => {
    const providers = new Providers();
    providers.rows = [
      provider({
        extraHeaders: [
          { key: "Authorization", value: "Bearer stored" },
          { key: "X-Tenant", value: "tenant-1" },
        ],
      }),
    ];

    await service(
      providers,
      new Catalog(),
      new CodexRefresher(),
      undefined,
      new ConnectionRateLimiter(),
      new HeaderCredentialPolicy(),
    ).upsert({
      id: "mp_1",
      projectId: "project_1",
      provider: "openai",
      enabled: true,
      extraHeaders: [
        { key: "Authorization", value: "••••" },
        { key: "X-Tenant", value: "••••" },
      ],
    });

    expect(providers.rows[0]?.extraHeaders).toEqual([
      { key: "Authorization", value: "Bearer stored" },
      { key: "X-Tenant", value: "tenant-1" },
    ]);
  });

  it("allows a renamed masked header to reuse only its unclaimed position", async () => {
    const providers = new Providers();
    providers.rows = [
      provider({
        extraHeaders: [
          { key: "Authorization", value: "Bearer stored" },
          { key: "X-Tenant", value: "tenant-1" },
        ],
      }),
    ];

    await service(
      providers,
      new Catalog(),
      new CodexRefresher(),
      undefined,
      new ConnectionRateLimiter(),
      new HeaderCredentialPolicy(),
    ).upsert({
      id: "mp_1",
      projectId: "project_1",
      provider: "openai",
      enabled: true,
      extraHeaders: [
        { key: "X-Auth", value: "••••" },
        { key: "X-Tenant", value: "••••" },
      ],
    });

    expect(providers.rows[0]?.extraHeaders).toEqual([
      { key: "X-Auth", value: "Bearer stored" },
      { key: "X-Tenant", value: "tenant-1" },
    ]);
  });

  it("does not assign a claimed header secret to an unrelated masked header", async () => {
    const providers = new Providers();
    providers.rows = [
      provider({ extraHeaders: [{ key: "Authorization", value: "Bearer stored" }] }),
    ];

    await service(
      providers,
      new Catalog(),
      new CodexRefresher(),
      undefined,
      new ConnectionRateLimiter(),
      new HeaderCredentialPolicy(),
    ).upsert({
      id: "mp_1",
      projectId: "project_1",
      provider: "openai",
      enabled: true,
      extraHeaders: [
        { key: "X-New", value: "••••" },
        { key: "Authorization", value: "••••" },
      ],
    });

    expect(providers.rows[0]?.extraHeaders).toEqual([
      { key: "Authorization", value: "Bearer stored" },
    ]);
  });
});
