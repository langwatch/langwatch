import { generateText } from "ai";
import { z } from "zod";
import {
  ModelProviderCatalog,
  ModelProviderCredentialCodec,
  ModelProviderCredentialPolicy,
  ModelTranslationPort,
  PostgresModelProviderAdapter,
} from "@langwatch/model-provider-server";
import type { ModelCostRate, ModelDefaultFeature, ModelProviderApiKeyValidation, ModelProviderService, ModelProviderSummary } from "@langwatch/model-provider-contract";
import type { ManagedProviderService } from "@langwatch/enterprise-managed-provider-contract";
import type { AuthzService } from "@langwatch/authz-contract";
import { ModelProviderAuthorization } from "@langwatch/model-provider-server";
import { validateProviderApiKey } from "~/server/modelProviders/providerValidation";
import { getProviderModelOptions, modelProviders } from "~/server/modelProviders/registry";
import { allFeatures, MODEL_ROLES, featureByKey } from "~/server/modelProviders/featureRegistry";
import { isModelAllowedAsRoleDefault, isModelAllowedForFeature } from "~/server/modelProviders/codexRestrictions";
import { expandLatestAlias, isLatestAlias } from "~/server/modelProviders/latestAliases";
import { buildSeedPlanForProvider } from "~/server/modelProviders/seedOnboardingDefaults";
import { getVercelAIModel } from "~/server/modelProviders/utils";
import { MASKED_KEY_PLACEHOLDER } from "~/utils/constants";
import { encrypt } from "~/utils/encryption";
import { readCustomKeys } from "~/server/modelProviders/customKeys";
import { getStaticModelCosts } from "~/server/modelProviders/llmModelCost";
import {
  isSecretCredential,
  mergeStoredCustomKeys,
} from "~/server/modelProviders/credentialMerge";

class AppModelProviderCatalog extends ModelProviderCatalog {
  constructor(
    private readonly managedProviders: ManagedProviderService,
    private readonly systemProviderEnvironment: Readonly<Record<string, string | undefined>> = {},
    private readonly isSaas = false,
  ) { super(); }

  exists(provider: string): boolean { return provider in modelProviders; }

  metadata(provider: string) {
    return {
      models: getProviderModelOptions(provider, "chat").map((model) => model.value),
      embeddingsModels: getProviderModelOptions(provider, "embedding").map((model) => model.value),
      disabledByDefault: modelProviders[provider as keyof typeof modelProviders]?.type === "safety",
    };
  }

  defaultFeatures(): ModelDefaultFeature[] {
    return allFeatures().map(({ key, role, displayName, description }) => ({ key, role, displayName, description }));
  }

  sanitizeDefaultConfig(input: Record<string, unknown>): Record<string, string> {
    const valid = new Set<string>([...MODEL_ROLES, ...allFeatures().map((feature) => feature.key)]);
    const clean: Record<string, string> = {};
    for (const [key, value] of Object.entries(input)) {
      if (!valid.has(key) || typeof value !== "string" || value.length === 0) continue;
      const allowed = MODEL_ROLES.includes(key as (typeof MODEL_ROLES)[number])
        ? isModelAllowedAsRoleDefault(value, key as (typeof MODEL_ROLES)[number])
        : Boolean(featureByKey(key) && isModelAllowedForFeature({ modelId: value, featureKey: key }));
      if (!allowed) throw new Error(`Model is not allowed for default key: ${key}`);
      clean[key] = value;
    }
    return clean;
  }

  tryNormalizeDefaultModel(input: { key: string; model: string }): string | null {
    const model = expandLatestAlias(input.model);
    if (isLatestAlias(input.model) && model === input.model) return null;
    const allowed = MODEL_ROLES.includes(input.key as (typeof MODEL_ROLES)[number])
      ? isModelAllowedAsRoleDefault(model, input.key as (typeof MODEL_ROLES)[number])
      : Boolean(featureByKey(input.key) && isModelAllowedForFeature({ modelId: model, featureKey: input.key }));
    return allowed ? model : null;
  }

  inferredDefaultsForProvider(provider: string): Record<string, string> {
    return buildSeedPlanForProvider(provider);
  }

  staticCostRates(): readonly ModelCostRate[] {
    return getStaticModelCosts();
  }

  async systemProviders(_input: { projectId?: string; organizationId?: string }): Promise<ModelProviderSummary[]> {
    const now = new Date(0);
    const organizationId = _input.organizationId ?? `system:${_input.projectId ?? "global"}`;
    return Object.entries(modelProviders)
      .filter(([, definition]) => definition.enabledSince)
      .map(([provider, definition]) => {
        const enabled = this.isSystemProviderEnabled(provider, definition.apiKey);
        const models = getProviderModelOptions(provider, "chat").map((model) => model.value);
        const embeddingsModels = getProviderModelOptions(provider, "embedding").map((model) => model.value);
        return {
          id: `system_${provider}`,
          organizationId,
          provider,
          name: definition.name,
          enabled,
          routingHandle: null,
          scopes: [],
          customKeys: null,
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
          models,
          embeddingsModels,
          disabledByDefault: !enabled,
          isSystem: true,
          embeddingsUnsupported: false,
        } satisfies ModelProviderSummary;
      });
  }

  private isSystemProviderEnabled(provider: string, apiKey: string): boolean {
    return this.isSaas && Boolean(this.systemProviderEnvironment[apiKey]) &&
      (provider !== "vertex_ai" || Boolean(this.systemProviderEnvironment.VERTEXAI_PROJECT));
  }

  async validateApiKey(provider: string, customKeys: Record<string, unknown>): Promise<ModelProviderApiKeyValidation> {
    const result = await validateProviderApiKey(provider, customKeys as Record<string, string>);
    return { valid: result.valid, message: result.valid ? undefined : result.outcome };
  }

  async testConnection(provider: string, customKeys: Record<string, unknown>): Promise<{ connected: boolean }> {
    const result = await this.validateApiKey(provider, customKeys);
    return { connected: result.valid };
  }

  tryMaskCredentials(customKeys: Record<string, unknown> | null): Record<string, unknown> | null {
    if (!customKeys) return null;
    return Object.fromEntries(Object.keys(customKeys).map((key) => [key, MASKED_KEY_PLACEHOLDER]));
  }

  isManagedProvider(organizationId: string, provider: string): boolean {
    return this.managedProviders.isManagedProvider(organizationId, provider);
  }
}

class AppModelProviderCredentialCodec extends ModelProviderCredentialCodec {
  encode(value: Record<string, unknown> | null): unknown {
    return value === null ? null : encrypt(JSON.stringify(value));
  }

  decode(value: unknown): Record<string, unknown> | null {
    return readCustomKeys(value).keys;
  }
}

class AppModelProviderCredentialPolicy extends ModelProviderCredentialPolicy {
  normalize(
    provider: string,
    value: Record<string, unknown> | null,
  ): Record<string, unknown> | null {
    if (value === null) return null;
    const definition = modelProviders[provider as keyof typeof modelProviders];
    if (!definition) throw new Error(`Unknown model provider: ${provider}`);
    return z
      .union([definition.keysSchema, z.object({ MANAGED: z.string() })])
      .parse(value);
  }

  merge(input: {
    incoming: Record<string, unknown> | null;
    stored: Record<string, unknown> | null;
  }): Record<string, unknown> {
    return mergeStoredCustomKeys(input);
  }

  mask(
    value: Record<string, unknown> | null,
  ): Record<string, unknown> | null {
    if (value === null) return null;
    return Object.fromEntries(
      Object.entries(value).map(([key, field]) => [
        key,
        isSecretCredential(key) ? MASKED_KEY_PLACEHOLDER : field,
      ]),
    );
  }

  hasUsableReplacement(value: Record<string, unknown> | null): boolean {
    return Object.values(value ?? {}).some(
      (field) =>
        typeof field === "string" &&
        field.length > 0 &&
        field !== MASKED_KEY_PLACEHOLDER,
    );
  }

  mergeHeaders(input: {
    incoming: Array<{ key: string; value: string }>;
    stored: Array<{ key: string; value: string }>;
  }): Array<{ key: string; value: string }> {
    const incomingKeys = new Set(input.incoming.map(({ key }) => key));
    return input.incoming.flatMap((header, index) => {
      if (header.value !== MASKED_KEY_PLACEHOLDER) return [header];
      const byKey = input.stored.find(({ key }) => key === header.key);
      if (byKey) return [{ key: header.key, value: byKey.value }];
      const positional = input.stored[index];
      if (positional && !incomingKeys.has(positional.key)) {
        return [{ key: header.key, value: positional.value }];
      }
      return [];
    });
  }

  maskHeaders(
    value: Array<{ key: string; value: string }>,
  ): Array<{ key: string; value: string }> {
    return value.map(({ key }) => ({ key, value: MASKED_KEY_PLACEHOLDER }));
  }
}

class AppModelProviderAuthorization extends ModelProviderAuthorization {
  constructor(private readonly permissions: AuthzService) { super(); }

  canRead(input: { actorId: string; scopeType: "ORGANIZATION" | "TEAM" | "PROJECT"; scopeId: string }): Promise<boolean> {
    return this.check(input, input.scopeType === "PROJECT" ? "project:view" : input.scopeType === "TEAM" ? "team:view" : "organization:view");
  }

  canWrite(input: { actorId: string; scopeType: "ORGANIZATION" | "TEAM" | "PROJECT"; scopeId: string }): Promise<boolean> {
    return this.check(input, input.scopeType === "ORGANIZATION" ? "organization:manage" : input.scopeType === "TEAM" ? "team:manage" : "project:update");
  }

  private async check(input: { actorId: string; scopeType: "ORGANIZATION" | "TEAM" | "PROJECT"; scopeId: string }, permission: "organization:view" | "team:view" | "project:view" | "organization:manage" | "team:manage" | "project:update"): Promise<boolean> {
    const scope = input.scopeType === "PROJECT"
      ? { tier: "project" as const, id: input.scopeId }
      : input.scopeType === "TEAM"
        ? { tier: "team" as const, id: input.scopeId }
        : { tier: "organization" as const, id: input.scopeId };
    return (await this.permissions.getDecision({ userId: input.actorId, permission, scope })).permitted;
  }
}

class AppModelTranslation extends ModelTranslationPort {
  async translate(input: { projectId: string; text: string; model: string }): Promise<string> {
    const model = await getVercelAIModel({ projectId: input.projectId, featureKey: "translate.text" });
    const result = await generateText({ model, prompt: `Translate the following text to English only reply with the translated text, do not include any other text: ${input.text}` });
    return result.text;
  }
}

export interface AppModelProviderRuntimeOptions {
  database: object;
  managedProviders: ManagedProviderService;
  systemProviderEnvironment?: Readonly<Record<string, string | undefined>>;
  isSaas?: boolean;
  permissions?: AuthzService;
}

export class AppModelProviderRuntime {
  private constructor(private readonly options: AppModelProviderRuntimeOptions) {}

  static create(options: AppModelProviderRuntimeOptions): AppModelProviderRuntime {
    return new AppModelProviderRuntime(options);
  }

  build(): ModelProviderService {
    return PostgresModelProviderAdapter.create({
      database: this.options.database,
      catalog: new AppModelProviderCatalog(
        this.options.managedProviders,
        this.options.systemProviderEnvironment,
        this.options.isSaas,
      ),
      managedProviders: this.options.managedProviders,
      credentials: new AppModelProviderCredentialCodec(),
      credentialPolicy: new AppModelProviderCredentialPolicy(),
      authorization: this.options.permissions ? new AppModelProviderAuthorization(this.options.permissions) : undefined,
      translation: new AppModelTranslation(),
    }).build();
  }
}
