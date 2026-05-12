import type { PrismaClient, Project } from "@prisma/client";
import type { Session } from "~/server/auth";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { KEY_CHECK, MASKED_KEY_PLACEHOLDER } from "../../utils/constants";
import type { CustomModelsInput } from "./customModel.schema";
import { toLegacyCompatibleCustomModels } from "./customModel.schema";
import {
  assertCanManageAllScopes,
  canReadAnyScope,
} from "./modelProvider.authz";
import {
  ModelProviderRepository,
  type ModelProviderWithScopes,
  type ScopeInput,
} from "./modelProvider.repository";
import {
  getProviderModelOptions,
  type MaybeStoredModelProvider,
  modelProviders,
} from "./registry";

/**
 * Minimal ctx slice this service uses to authorize scope-level writes.
 * Kept narrow so the service can be constructed from any caller (tRPC,
 * Hono routes, workers) without dragging the full tRPC Context in.
 */
export type AuthzContext = { prisma: PrismaClient; session: Session | null };

/**
 * Input types for service operations
 */
export type UpdateModelProviderInput = {
  id?: string;
  projectId: string;
  name?: string;
  provider: string;
  enabled: boolean;
  customKeys?: Record<string, unknown> | null;
  customModels?: CustomModelsInput | null;
  customEmbeddingsModels?: CustomModelsInput | null;
  extraHeaders?: { key: string; value: string }[] | null;
  defaultModel?: string;
  /**
   * Full scope set for this credential. When omitted on create, defaults
   * to `[{ scopeType: "PROJECT", scopeId: projectId }]` for backward
   * compatibility; when omitted on update, the existing scope set is
   * preserved. Replace-all semantics: passing `[]` is rejected at the
   * router boundary.
   */
  scopes?: ScopeInput[];
  /**
   * Legacy single-scope inputs kept so existing form callers still
   * compile during the transition. When both `scopes` and these legacy
   * fields arrive, `scopes` wins; otherwise the pair is promoted to a
   * single-entry scope array.
   */
  scopeType?: "ORGANIZATION" | "TEAM" | "PROJECT";
  scopeId?: string;
};

export type DeleteModelProviderInput = {
  id?: string;
  projectId: string;
  provider: string;
};

/**
 * Service layer for ModelProvider business logic.
 * Single Responsibility: Model provider lifecycle management.
 *
 * Framework-agnostic - no tRPC dependencies.
 */
export class ModelProviderService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly repository: ModelProviderRepository,
  ) {}

  /**
   * Static factory method for creating a ModelProviderService with proper DI.
   */
  static create(prisma: PrismaClient): ModelProviderService {
    const repository = new ModelProviderRepository(prisma);
    return new ModelProviderService(prisma, repository);
  }

  /**
   * Gets all model providers for a project, merging defaults with stored configurations.
   *
   * Business rules:
   * - Default providers from registry are included if they have enabledSince
   * - Stored providers override defaults
   * - Only includes stored providers with meaningful customizations
   */
  async getProjectModelProviders(
    projectId: string,
    includeKeys = true,
  ): Promise<Record<string, MaybeStoredModelProvider>> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new Error("Project not found");
    }

    const defaultModelProviders = this.buildDefaultProviders(project);
    const savedModelProviders = await this.buildSavedProviders(
      projectId,
      defaultModelProviders,
      includeKeys,
    );

    return {
      ...defaultModelProviders,
      ...savedModelProviders,
    };
  }

  /**
   * Gets model providers with API keys masked for frontend display.
   *
   * Business rules:
   * - Only masks fields matching KEY_CHECK patterns (API keys)
   * - URLs and other values remain visible
   */
  async getProjectModelProvidersForFrontend(
    projectId: string,
    includeKeys = true,
  ): Promise<Record<string, MaybeStoredModelProvider>> {
    const providers = await this.getProjectModelProviders(
      projectId,
      includeKeys,
    );

    if (!includeKeys) {
      return providers;
    }

    return this.maskApiKeys(providers);
  }

  /**
   * Updates or creates a model provider.
   *
   * Business rules:
   * - Validates provider exists in registry
   * - Validates custom keys against provider schema
   * - Smart merging: preserves original keys when masked placeholder is sent
   * - Can optionally update project default model
   */
  /**
   * Authorizes a write that lands the given set of scope entries on a
   * ModelProvider. Every entry must pass the per-scope manage check; a
   * single failure rejects the entire operation (no partial apply).
   *
   * When `ctx` is omitted the check is skipped — that path is reserved
   * for migrations, workers, and other server-internal callers that
   * already have a trusted root context. tRPC routers and any other
   * user-driven entrypoint MUST pass ctx.
   */
  async updateModelProvider(
    input: UpdateModelProviderInput,
    ctx?: AuthzContext,
  ) {
    const {
      id,
      projectId,
      provider,
      enabled,
      customKeys,
      customModels,
      customEmbeddingsModels,
      extraHeaders,
      defaultModel,
      name,
    } = input;

    // Validate provider exists
    if (!(provider in modelProviders)) {
      throw new Error("Invalid provider");
    }

    // Validate and clean custom keys
    const { validatedKeys, customKeysProvided } = this.validateAndCleanKeys(
      provider,
      customKeys,
    );

    // Find existing provider
    const existingProvider = await this.findExistingProvider(
      id,
      provider,
      projectId,
    );

    // Resolve input scope set. Callers may pass `scopes: [...]` directly,
    // or a single-scope pair via the legacy `scopeType`/`scopeId` fields.
    // When neither is given, defer to the create/update defaults.
    const scopes: ScopeInput[] | undefined =
      input.scopes ??
      (input.scopeType && input.scopeId
        ? [{ scopeType: input.scopeType, scopeId: input.scopeId }]
        : undefined);

    // Fail-closed scope authz. Every (scopeType, scopeId) entry in the
    // target set must pass the caller's manage-permission check; a
    // single failure aborts the whole operation so partial-success
    // cannot silently rebind a credential the caller can't see.
    if (ctx && scopes) {
      await assertCanManageAllScopes(ctx, scopes);
    }

    return await this.prisma.$transaction(async (tx) => {
      let result;

      if (existingProvider) {
        result = await this.updateExisting(
          existingProvider,
          {
            projectId,
            provider,
            enabled,
            name,
            scopes,
            customModels: customModels ?? [],
            customEmbeddingsModels: customEmbeddingsModels ?? [],
            extraHeaders: extraHeaders ?? [],
          },
          validatedKeys,
          customKeysProvided,
          tx,
        );
      } else {
        result = await this.createNew(
          {
            projectId,
            provider,
            enabled,
            name: name ?? this.deriveDefaultName(provider),
            scopes,
            customModels: customModels ?? undefined,
            customEmbeddingsModels: customEmbeddingsModels ?? undefined,
            extraHeaders: extraHeaders ?? [],
          },
          validatedKeys,
          customKeysProvided,
          tx,
        );
      }

      // Update project default model if provided
      if (defaultModel !== undefined) {
        await tx.project.update({
          where: { id: projectId },
          data: { defaultModel },
        });
      }

      return result;
    });
  }

  /**
   * Humanized default name for a brand-new ModelProvider when the caller
   * didn't supply one. Mirrors the backfill in migration
   * 20260419230000. For collisions within an org the service auto-
   * suffixes at write time — that suffix logic is handled by the router
   * because it needs access to the organization id.
   */
  private deriveDefaultName(provider: string): string {
    const humanized: Record<string, string> = {
      openai: "OpenAI",
      anthropic: "Anthropic",
      gemini: "Gemini",
      azure: "Azure OpenAI",
      bedrock: "Bedrock",
      vertex_ai: "Vertex AI",
      deepseek: "DeepSeek",
      xai: "xAI",
      cerebras: "Cerebras",
      groq: "Groq",
      azure_safety: "Azure Safety",
      custom: "Custom (OpenAI-compatible)",
      cloudflare: "Cloudflare",
      mistral: "Mistral",
      cohere: "Cohere",
      fireworks_ai: "Fireworks AI",
    };
    return (
      humanized[provider] ??
      provider
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
    );
  }

  /**
   * Deletes a model provider.
   *
   * Scope authz: the caller must hold the manage-permission on EVERY
   * current scope entry. A team-level admin cannot silently blow up an
   * org-shared credential from under an organization they don't
   * manage.
   */
  async deleteModelProvider(
    input: DeleteModelProviderInput,
    ctx?: AuthzContext,
  ) {
    const { id, projectId, provider } = input;

    if (ctx) {
      const existing = id
        ? await this.repository.findById(id, projectId)
        : await this.repository.findByProvider(provider, projectId);
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Model provider not found for this project",
        });
      }
      await assertCanManageAllScopes(
        ctx,
        existing.scopes.map((s) => ({
          scopeType: s.scopeType as "ORGANIZATION" | "TEAM" | "PROJECT",
          scopeId: s.scopeId,
        })),
      );
    }

    if (id) {
      return await this.repository.delete(id, projectId);
    } else {
      return await this.repository.deleteByProvider(provider, projectId);
    }
  }

  /**
   * Scope-aware read gate for getById. Returns the row when the caller
   * can see any of its scope entries, otherwise surfaces NOT_FOUND so
   * clients can't probe ids across tenants.
   */
  async getById(
    id: string,
    projectId: string,
    ctx: AuthzContext,
  ): Promise<ModelProviderWithScopes> {
    const existing = await this.repository.findById(id, projectId);
    if (!existing) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Model provider not found",
      });
    }
    const readable = await canReadAnyScope(
      ctx,
      existing.scopes.map((s) => ({
        scopeType: s.scopeType as "ORGANIZATION" | "TEAM" | "PROJECT",
        scopeId: s.scopeId,
      })),
    );
    if (!readable) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Model provider not found",
      });
    }
    return existing;
  }

  // ─────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────

  private buildDefaultProviders(
    project: Project,
  ): Record<string, MaybeStoredModelProvider> {
    return Object.fromEntries(
      Object.entries(modelProviders)
        .filter(([_, modelProvider]) => modelProvider.enabledSince)
        .map(([providerKey, modelProvider]) => {
          const enabled =
            modelProvider.enabledSince! < project.createdAt &&
            !!process.env[modelProvider.apiKey] &&
            (providerKey !== "vertex_ai" || !!process.env.VERTEXAI_PROJECT);

          const provider_: MaybeStoredModelProvider = {
            provider: providerKey,
            enabled,
            disabledByDefault: !enabled,
            customKeys: null,
            models: getProviderModelOptions(providerKey, "chat").map(
              (m) => m.value,
            ),
            embeddingsModels: getProviderModelOptions(
              providerKey,
              "embedding",
            ).map((m) => m.value),
            deploymentMapping: null,
            extraHeaders: [],
          };
          return [providerKey, provider_];
        }),
    );
  }

  private async buildSavedProviders(
    projectId: string,
    defaultProviders: Record<string, MaybeStoredModelProvider>,
    includeKeys: boolean,
  ): Promise<Record<string, MaybeStoredModelProvider>> {
    // Walk the multi-scope access relation: every MP whose scope set
    // intersects the project's (projectId, teamId, organizationId) is
    // returned. When the same provider string appears multiple times
    // (e.g. an ORG row and a PROJECT override), narrower-scope wins for
    // the legacy `Record<provider, …>` shape we still return here —
    // new consumers that need the full list should call
    // `listAccessibleForProject` directly on the service.
    const savedProviders =
      await this.repository.findAllAccessibleForProject(projectId);

    return savedProviders
      .filter((mp) => this.shouldKeepModelProvider(mp, defaultProviders))
      .reduce(
        (acc, mp) => {
          // Always use registry models for models/embeddingsModels
          const defaultProvider = defaultProviders[mp.provider];

          // Convert DB custom models (may be legacy string[] or new object[])
          const customModels = toLegacyCompatibleCustomModels(
            mp.customModels,
            "chat",
          );
          const customEmbeddingsModels = toLegacyCompatibleCustomModels(
            mp.customEmbeddingsModels,
            "embedding",
          );

          const narrowestScope = this.pickNarrowestScope(mp.scopes);

          const provider_: MaybeStoredModelProvider = {
            id: mp.id,
            name: mp.name,
            provider: mp.provider,
            enabled: mp.enabled,
            customKeys: includeKeys ? mp.customKeys : null,
            models: defaultProvider?.models ?? null,
            embeddingsModels: defaultProvider?.embeddingsModels ?? null,
            customModels:
              customModels.length > 0 ? customModels : null,
            customEmbeddingsModels:
              customEmbeddingsModels.length > 0
                ? customEmbeddingsModels
                : null,
            deploymentMapping: mp.deploymentMapping,
            disabledByDefault: defaultProvider?.disabledByDefault,
            extraHeaders: mp.extraHeaders as
              | { key: string; value: string }[]
              | null,
            scopes: mp.scopes.map((s) => ({
              scopeType: s.scopeType as "ORGANIZATION" | "TEAM" | "PROJECT",
              scopeId: s.scopeId,
            })),
            scopeType: narrowestScope.scopeType,
            scopeId: narrowestScope.scopeId,
          };

          // Narrower-scope wins when the same provider string has
          // multiple accessible rows (preserves iter 107/108 semantics
          // for the Record<provider, …> consumers).
          const existing = acc[mp.provider];
          if (!existing || this.isNarrower(provider_, existing)) {
            return { ...acc, [mp.provider]: provider_ };
          }
          return acc;
        },
        {} as Record<string, MaybeStoredModelProvider>,
      );
  }

  private scopePriority(
    scopeType: "ORGANIZATION" | "TEAM" | "PROJECT" | undefined,
  ): number {
    if (scopeType === "PROJECT") return 3;
    if (scopeType === "TEAM") return 2;
    if (scopeType === "ORGANIZATION") return 1;
    return 0;
  }

  private pickNarrowestScope(
    scopes: { scopeType: string; scopeId: string }[],
  ): { scopeType: "ORGANIZATION" | "TEAM" | "PROJECT"; scopeId: string } {
    if (scopes.length === 0) {
      return { scopeType: "PROJECT", scopeId: "" };
    }
    const sorted = [...scopes].sort(
      (a, b) =>
        this.scopePriority(
          b.scopeType as "ORGANIZATION" | "TEAM" | "PROJECT",
        ) -
        this.scopePriority(
          a.scopeType as "ORGANIZATION" | "TEAM" | "PROJECT",
        ),
    );
    return {
      scopeType: sorted[0]!.scopeType as "ORGANIZATION" | "TEAM" | "PROJECT",
      scopeId: sorted[0]!.scopeId,
    };
  }

  private isNarrower(
    a: MaybeStoredModelProvider,
    b: MaybeStoredModelProvider,
  ): boolean {
    return this.scopePriority(a.scopeType) > this.scopePriority(b.scopeType);
  }

  /**
   * Determines if a stored provider should be included in results.
   * Filters out providers that don't have meaningful customizations.
   */
  private shouldKeepModelProvider(
    mp: {
      customKeys: unknown;
      provider: string;
      enabled: boolean;
      customModels: unknown;
      customEmbeddingsModels: unknown;
    },
    defaultProviders: Record<string, MaybeStoredModelProvider>,
  ): boolean {
    // Keep if has custom keys
    if (mp.customKeys) return true;

    // Keep if enabled status differs from default
    const defaultProvider = defaultProviders[mp.provider];
    if (mp.enabled !== defaultProvider?.enabled) return true;

    // Keep if has custom models or embeddings (works for both string[] and object[])
    const customModels = mp.customModels as unknown[] | null;
    const customEmbeddings = mp.customEmbeddingsModels as unknown[] | null;

    return (
      (customModels != null && customModels.length > 0) ||
      (customEmbeddings != null && customEmbeddings.length > 0)
    );
  }

  private maskApiKeys(
    providers: Record<string, MaybeStoredModelProvider>,
  ): Record<string, MaybeStoredModelProvider> {
    const masked = { ...providers };

    for (const [providerKey, config] of Object.entries(masked)) {
      if (config.customKeys) {
        masked[providerKey] = {
          ...config,
          customKeys: Object.fromEntries(
            Object.entries(config.customKeys).map(([key, value]) => [
              key,
              KEY_CHECK.some((k) => key.includes(k))
                ? MASKED_KEY_PLACEHOLDER
                : value,
            ]),
          ),
        };
      }
    }

    return masked;
  }

  private validateAndCleanKeys(
    provider: string,
    customKeys: Record<string, unknown> | null | undefined,
  ): {
    validatedKeys: Record<string, unknown> | null;
    customKeysProvided: boolean;
  } {
    const customKeysProvided = customKeys !== undefined;

    if (!customKeys) {
      return { validatedKeys: null, customKeysProvided };
    }

    const providerSchema =
      modelProviders[provider as keyof typeof modelProviders]!.keysSchema;
    const validator = z.union([
      providerSchema,
      z.object({ MANAGED: z.string() }),
    ]);

    let validatedKeys: Record<string, unknown>;
    try {
      validatedKeys = validator.parse(customKeys);
    } catch {
      throw new Error(
        `Invalid API key configuration for ${provider}. Please verify your credentials.`,
      );
    }

    // Filter out null values for Azure provider
    if (provider === "azure" && validatedKeys) {
      validatedKeys = Object.fromEntries(
        Object.entries(validatedKeys).filter(([_, value]) => value !== null),
      );
      if (Object.keys(validatedKeys).length === 0) {
        return { validatedKeys: null, customKeysProvided };
      }
    }

    return { validatedKeys, customKeysProvided };
  }

  private async findExistingProvider(
    id: string | undefined,
    provider: string,
    projectId: string,
  ) {
    if (id) {
      return await this.repository.findById(id, projectId);
    }
    return await this.repository.findByProvider(provider, projectId);
  }

  private async updateExisting(
    existingProvider: { id: string; customKeys: unknown },
    data: {
      projectId: string;
      provider: string;
      enabled: boolean;
      name?: string;
      scopes?: ScopeInput[];
      customModels: CustomModelsInput;
      customEmbeddingsModels: CustomModelsInput;
      extraHeaders: { key: string; value: string }[];
    },
    validatedKeys: Record<string, unknown> | null,
    customKeysProvided: boolean,
    tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0],
  ) {
    let customKeysToSave: Record<string, unknown> | undefined;

    if (customKeysProvided) {
      customKeysToSave = this.mergeCustomKeys(
        validatedKeys,
        existingProvider.customKeys as Record<string, unknown> | null,
      );
    }

    return await this.repository.update(
      existingProvider.id,
      data.projectId,
      {
        enabled: data.enabled,
        customModels: data.customModels,
        customEmbeddingsModels: data.customEmbeddingsModels,
        extraHeaders: data.extraHeaders,
        ...(data.name !== undefined && { name: data.name }),
        ...(data.scopes !== undefined && { scopes: data.scopes }),
        ...(customKeysToSave !== undefined && {
          customKeys: customKeysToSave,
        }),
      },
      tx,
    );
  }

  private async createNew(
    data: {
      projectId: string;
      name: string;
      provider: string;
      enabled: boolean;
      customModels?: CustomModelsInput;
      customEmbeddingsModels?: CustomModelsInput;
      extraHeaders: { key: string; value: string }[];
      scopes?: ScopeInput[];
    },
    validatedKeys: Record<string, unknown> | null,
    customKeysProvided: boolean,
    tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0],
  ) {
    return await this.repository.create(
      {
        projectId: data.projectId,
        name: data.name,
        provider: data.provider,
        enabled: data.enabled,
        customModels: data.customModels,
        customEmbeddingsModels: data.customEmbeddingsModels,
        extraHeaders: data.extraHeaders,
        scopes: data.scopes,
        ...(customKeysProvided &&
          validatedKeys && { customKeys: validatedKeys }),
      },
      tx,
    );
  }

  /**
   * Smart merging: preserves original keys when masked placeholder is sent.
   *
   * Business rules:
   * - Start with new validated keys
   * - For any key with MASKED_KEY_PLACEHOLDER value, use existing value
   */
  private mergeCustomKeys(
    validatedKeys: Record<string, unknown> | null,
    existingKeys: Record<string, unknown> | null,
  ): Record<string, unknown> {
    if (!validatedKeys) return {};

    if (!existingKeys) return validatedKeys;

    return {
      ...validatedKeys,
      ...Object.fromEntries(
        Object.entries(existingKeys)
          .filter(([key]) => validatedKeys[key] === MASKED_KEY_PLACEHOLDER)
          .map(([key, value]) => [key, value]),
      ),
    };
  }
}
