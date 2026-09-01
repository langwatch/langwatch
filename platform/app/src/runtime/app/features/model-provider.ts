import { generateText } from "ai";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  ModelProviderCatalog,
  ModelProviderCredentialCodec,
  ModelProviderConnectionRateLimiter,
  ModelProviderIdService,
  ModelTranslationPort,
  CodexTokenRefresher,
  PostgresModelProviderAdapter,
} from "@langwatch/model-provider-server";
import type {
  CodexTokenKeys,
  ModelProviderApiKeyValidation,
  ModelProviderCredentialVerdict,
  ModelProviderService,
  ModelProviderSummary,
} from "@langwatch/model-provider-contract";
import type { ManagedProviderService } from "@langwatch/enterprise-managed-provider-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { ProjectService } from "@langwatch/project-contract";
import type { AuthzService } from "@langwatch/authz-contract";
import { validateProviderApiKey } from "~/server/modelProviders/providerValidation";
import { rateLimit } from "~/server/rateLimit";
import { ModelProviderTestRateLimitedError } from "@langwatch/model-provider-contract";
import { modelProviders } from "@langwatch/model-provider-contract";
import { getProviderModelOptions } from "@langwatch/model-provider-contract";
import { getVercelAIModel } from "~/server/modelProviders/utils";
import { encrypt } from "~/utils/encryption";
import { readCustomKeys } from "~/server/modelProviders/customKeys";
import { CodexAccountService, CodexAuthError } from "~/server/modelProviders/codexAccount.service";
import type { PrismaClient } from "~/generated/prisma/client";
import type { ModelClientConfig } from "../model-client.config";

class AppModelProviderCatalog extends ModelProviderCatalog {
  constructor(
    private readonly managedProviders: ManagedProviderService,
    private readonly systemProviderEnvironment: Readonly<Record<string, string | undefined>> = {},
    private readonly isSaas = false,
  ) {
    super();
  }

  async systemProviders(_input: {
    projectId?: string;
    organizationId?: string;
    referenceCreatedAt: Date;
  }): Promise<ModelProviderSummary[]> {
    const now = new Date(0);
    const organizationId = _input.organizationId ?? `system:${_input.projectId ?? "global"}`;
    return Object.entries(modelProviders)
      .filter(([, definition]) => definition.enabledSince)
      .map(([provider, definition]) => {
        const enabled =
          definition.enabledSince < _input.referenceCreatedAt &&
          this.isSystemProviderEnabled(provider, definition.apiKey);
        const models = getProviderModelOptions(provider, "chat").map((model) => model.value);
        const embeddingsModels = getProviderModelOptions(provider, "embedding").map(
          (model) => model.value,
        );
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
    return (
      this.isSaas &&
      Boolean(this.systemProviderEnvironment[apiKey]) &&
      (provider !== "vertex_ai" || Boolean(this.systemProviderEnvironment.VERTEXAI_PROJECT))
    );
  }

  async validateApiKey(
    provider: string,
    customKeys: Record<string, unknown>,
  ): Promise<ModelProviderApiKeyValidation> {
    const result = await validateProviderApiKey(
      provider,
      z.record(z.string(), z.string()).parse(customKeys),
    );
    return { valid: result.valid, message: result.valid ? undefined : result.outcome };
  }

  /**
   * The stored-credential probe, handed back whole.
   *
   * `validateApiKey` above narrows the same verdict to what the save path
   * needs, because a save is a yes-or-no decision. A reader is not: this
   * returns the probe's own answer so "we could not check this" survives the
   * trip to the browser instead of arriving as a pass.
   */
  testConnection(
    provider: string,
    customKeys: Record<string, unknown>,
  ): Promise<ModelProviderCredentialVerdict> {
    return validateProviderApiKey(provider, z.record(z.string(), z.string()).parse(customKeys));
  }

  tryGetExecutionValue(input: {
    customKeys: Record<string, unknown> | null;
    key: string;
  }): string | null {
    const stored = input.customKeys?.[input.key];
    if (typeof stored === "string" && stored.length > 0) {
      return stored;
    }

    return this.systemProviderEnvironment[input.key] ?? null;
  }

  isManagedProvider(input: { organizationId: string; provider: string }): boolean {
    return this.managedProviders.isManagedProvider(input);
  }

  prepareExecution(input: {
    parameters: Record<string, string>;
    projectId: string;
    model: string;
    provider: string;
  }): Promise<Record<string, string>> {
    return this.managedProviders.buildLitellmParameters({
      params: input.parameters,
      projectId: input.projectId,
      model: input.model,
      modelProvider: { provider: input.provider },
    });
  }
}

class AppModelProviderCredentialCodec extends ModelProviderCredentialCodec {
  encode(value: Record<string, unknown> | null): unknown {
    return value === null ? null : encrypt(JSON.stringify(value));
  }

  tryDecode(value: unknown): Record<string, unknown> | null {
    const parsed = readCustomKeys(value);
    return parsed.state === "read" ? parsed.keys : null;
  }
}

class AppCodexTokenRefresher extends CodexTokenRefresher {
  private readonly account = new CodexAccountService();

  async refresh(input: {
    tokens: CodexTokenKeys;
  }): Promise<{ status: "refreshed"; tokens: CodexTokenKeys } | { status: "session_expired" }> {
    try {
      const tokens = await this.account.refresh(input.tokens);
      return { status: "refreshed", tokens };
    } catch (error) {
      if (error instanceof CodexAuthError && error.kind === "refresh_rejected") {
        return { status: "session_expired" };
      }
      throw error;
    }
  }
}

class AppModelProviderConnectionRateLimiter extends ModelProviderConnectionRateLimiter {
  async assertAvailable(input: { organizationId: string }): Promise<void> {
    const organization = await rateLimit({
      key: `model-provider-test:org:${input.organizationId}`,
      windowSeconds: 60,
      max: 20,
    });
    if (!organization.allowed) {
      throw new ModelProviderTestRateLimitedError({
        retryAfterSeconds: retryAfterSeconds(organization.resetAt),
      });
    }

    const global = await rateLimit({
      key: "model-provider-test:global",
      windowSeconds: 60,
      max: 500,
    });
    if (!global.allowed) {
      throw new ModelProviderTestRateLimitedError({
        retryAfterSeconds: retryAfterSeconds(global.resetAt),
      });
    }
  }
}

function retryAfterSeconds(resetAt: number): number {
  return Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
}

class AppModelProviderIdService extends ModelProviderIdService {
  generate(input: { type: "provider" | "default" | "cost" }): string {
    const prefix =
      input.type === "provider"
        ? "model_provider"
        : input.type === "default"
          ? "model_default"
          : "model_cost";
    return `${prefix}_${nanoid()}`;
  }
}

class AppModelTranslation extends ModelTranslationPort {
  constructor(
    private readonly managedProviders: ManagedProviderService,
    private readonly clientConfig: ModelClientConfig | undefined,
  ) {
    super();
  }

  async translate(input: {
    projectId: string;
    text: string;
    model: string;
    modelProviders: ModelProviderService;
  }): Promise<string> {
    const model = await getVercelAIModel({
      projectId: input.projectId,
      model: input.model,
      featureKey: "translate.text",
      modelProviders: input.modelProviders,
      managedProviders: this.managedProviders,
      executionProxyUrl: this.clientConfig?.executionProxyUrl,
      codexGatewayUrl: this.clientConfig?.codexGatewayUrl,
    });
    const result = await generateText({
      model,
      prompt: `Translate the following text to English only reply with the translated text, do not include any other text: ${input.text}`,
    });
    return result.text;
  }
}

export interface AppModelProviderRuntimeOptions {
  database: PrismaClient;
  managedProviders: ManagedProviderService;
  organizations: OrganizationService;
  projects: ProjectService;
  systemProviderEnvironment?: Readonly<Record<string, string | undefined>>;
  isSaas?: boolean;
  permissions: AuthzService;
  /** Parsed process configuration for the model SDK boundary. */
  modelClient?: ModelClientConfig;
}

export class AppModelProviderRuntime {
  private constructor(private readonly options: AppModelProviderRuntimeOptions) {}

  static create(options: AppModelProviderRuntimeOptions): AppModelProviderRuntime {
    return new AppModelProviderRuntime(options);
  }

  build(): ModelProviderService {
    return PostgresModelProviderAdapter.create({
      database: this.options.database,
      projects: this.options.projects,
      organizations: this.options.organizations,
      catalog: new AppModelProviderCatalog(
        this.options.managedProviders,
        this.options.systemProviderEnvironment,
        this.options.isSaas,
      ),
      credentials: new AppModelProviderCredentialCodec(),
      codexTokenRefresher: new AppCodexTokenRefresher(),
      connectionRateLimiter: new AppModelProviderConnectionRateLimiter(),
      authorization: this.options.permissions,
      translation: new AppModelTranslation(this.options.managedProviders, this.options.modelClient),
      ids: new AppModelProviderIdService(),
    }).build();
  }
}
