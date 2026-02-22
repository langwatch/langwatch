import type { Prisma, PrismaClient, Project } from "@prisma/client";
import { generate } from "@langwatch/ksuid";
import { z } from "zod";
import { KEY_CHECK, KSUID_RESOURCES, MASKED_KEY_PLACEHOLDER } from "../../utils/constants";
import type { CustomModelsInput } from "./customModel.schema";
import { toLegacyCompatibleCustomModels } from "./customModel.schema";
import { ModelProviderRepository } from "./modelProvider.repository";
import {
  getProviderModelOptions,
  type MaybeStoredModelProvider,
  modelProviders,
} from "./registry";

/**
 * Input types for service operations
 */
export type UpdateModelProviderInput = {
  id?: string;
  projectId: string;
  provider: string;
  enabled: boolean;
  customKeys?: Record<string, unknown> | null;
  customModels?: CustomModelsInput | null;
  customEmbeddingsModels?: CustomModelsInput | null;
  extraHeaders?: { key: string; value: string }[] | null;
  defaultModel?: string;
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
  async updateModelProvider(input: UpdateModelProviderInput) {
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

    return await this.prisma.$transaction(async (tx) => {
      let result;

      if (existingProvider) {
        result = await this.updateExisting(
          existingProvider,
          {
            projectId,
            provider,
            enabled,
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
   * Deletes a model provider.
   */
  async deleteModelProvider(input: DeleteModelProviderInput) {
    const { id, projectId, provider } = input;

    if (id) {
      return await this.repository.delete(id, projectId);
    } else {
      return await this.repository.deleteByProvider(provider, projectId);
    }
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
    const savedProviders = await this.repository.findAll(projectId);

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

          const provider_: MaybeStoredModelProvider = {
            id: mp.id,
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
          };

          return { ...acc, [mp.provider]: provider_ };
        },
        {} as Record<string, MaybeStoredModelProvider>,
      );
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

    return await tx.modelProvider.update({
      where: { id: existingProvider.id, projectId: data.projectId },
      data: {
        enabled: data.enabled,
        customModels: data.customModels as Prisma.InputJsonValue,
        customEmbeddingsModels:
          data.customEmbeddingsModels as Prisma.InputJsonValue,
        extraHeaders: data.extraHeaders,
        ...(customKeysToSave !== undefined && {
          customKeys: customKeysToSave as Prisma.InputJsonValue,
        }),
      },
    });
  }

  private async createNew(
    data: {
      projectId: string;
      provider: string;
      enabled: boolean;
      customModels?: CustomModelsInput;
      customEmbeddingsModels?: CustomModelsInput;
      extraHeaders: { key: string; value: string }[];
    },
    validatedKeys: Record<string, unknown> | null,
    customKeysProvided: boolean,
    tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0],
  ) {
    return await tx.modelProvider.create({
      data: {
        id: generate(KSUID_RESOURCES.MODEL_PROVIDER).toString(),
        projectId: data.projectId,
        provider: data.provider,
        enabled: data.enabled,
        customModels: (data.customModels ?? []) as Prisma.InputJsonValue,
        customEmbeddingsModels:
          (data.customEmbeddingsModels ?? []) as Prisma.InputJsonValue,
        extraHeaders: data.extraHeaders,
        ...(customKeysProvided &&
          validatedKeys && { customKeys: validatedKeys }),
      } as Parameters<typeof tx.modelProvider.create>[0]["data"],
    });
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
