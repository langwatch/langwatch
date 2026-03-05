import type { ModelProvider, Prisma, PrismaClient } from "@prisma/client";
import { generate } from "@langwatch/ksuid";
import { KSUID_RESOURCES } from "../../utils/constants";
import { encrypt, decrypt } from "../../utils/encryption";
import type { CustomModelsInput } from "./customModel.schema";

/**
 * Repository for ModelProvider data access.
 * Single Responsibility: Database operations for model providers.
 *
 * Encrypts customKeys (API credentials) before writing to the database
 * and decrypts them after reading, using AES-256-GCM encryption.
 */
export class ModelProviderRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(
    id: string,
    projectId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<ModelProvider | null> {
    const client = tx ?? this.prisma;
    const result = await client.modelProvider.findFirst({
      where: { id, projectId },
    });
    return result ? this.withDecryptedKeys(result) : null;
  }

  async findByProvider(
    provider: string,
    projectId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<ModelProvider | null> {
    const client = tx ?? this.prisma;
    const result = await client.modelProvider.findFirst({
      where: { provider, projectId },
    });
    return result ? this.withDecryptedKeys(result) : null;
  }

  async findAll(
    projectId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<ModelProvider[]> {
    const client = tx ?? this.prisma;
    const results = await client.modelProvider.findMany({
      where: { projectId },
    });
    return results.map((result) => this.withDecryptedKeys(result));
  }

  async create(
    data: {
      projectId: string;
      provider: string;
      enabled: boolean;
      customKeys?: Record<string, unknown> | null;
      customModels?: CustomModelsInput;
      customEmbeddingsModels?: CustomModelsInput;
      extraHeaders?: { key: string; value: string }[];
    },
    tx?: Prisma.TransactionClient,
  ): Promise<ModelProvider> {
    const client = tx ?? this.prisma;
    const encryptedKeys = this.encryptCustomKeys(data.customKeys ?? undefined);
    return client.modelProvider.create({
      data: {
        id: generate(KSUID_RESOURCES.MODEL_PROVIDER).toString(),
        projectId: data.projectId,
        provider: data.provider,
        enabled: data.enabled,
        customKeys: encryptedKeys as Prisma.InputJsonValue | undefined,
        customModels: data.customModels as Prisma.InputJsonValue | undefined,
        customEmbeddingsModels: data.customEmbeddingsModels as
          | Prisma.InputJsonValue
          | undefined,
        extraHeaders: data.extraHeaders ?? [],
      },
    });
  }

  async update(
    id: string,
    projectId: string,
    data: {
      enabled?: boolean;
      customKeys?: Record<string, unknown>;
      customModels?: CustomModelsInput;
      customEmbeddingsModels?: CustomModelsInput;
      extraHeaders?: { key: string; value: string }[];
    },
    tx?: Prisma.TransactionClient,
  ): Promise<ModelProvider> {
    const client = tx ?? this.prisma;
    const encryptedKeys = this.encryptCustomKeys(data.customKeys);
    return client.modelProvider.update({
      where: { id, projectId },
      data: {
        ...data,
        customKeys: encryptedKeys as Prisma.InputJsonValue | undefined,
        customModels: data.customModels as Prisma.InputJsonValue | undefined,
        customEmbeddingsModels: data.customEmbeddingsModels as
          | Prisma.InputJsonValue
          | undefined,
      },
    });
  }

  async delete(
    id: string,
    projectId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<ModelProvider> {
    const client = tx ?? this.prisma;
    return client.modelProvider.delete({
      where: { id, projectId },
    });
  }

  async deleteByProvider(
    provider: string,
    projectId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Prisma.BatchPayload> {
    const client = tx ?? this.prisma;
    return client.modelProvider.deleteMany({
      where: { provider, projectId },
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // Private encryption helpers
  // ─────────────────────────────────────────────────────────────────

  /**
   * Encrypts customKeys before storing in the database.
   * Serializes the object to JSON, then encrypts the JSON string.
   *
   * @returns Encrypted string, or null/undefined if input is null/undefined.
   */
  private encryptCustomKeys(
    customKeys: Record<string, unknown> | null | undefined,
  ): string | null | undefined {
    if (customKeys === null) return null;
    if (customKeys === undefined) return undefined;
    return encrypt(JSON.stringify(customKeys));
  }

  /**
   * Decrypts customKeys after reading from the database.
   * Handles the migration transition where some rows may still have plaintext JSON objects.
   *
   * @returns Decrypted object, or null if input is null/undefined.
   */
  private decryptCustomKeys(
    customKeys: unknown,
  ): Record<string, unknown> | null {
    if (customKeys === null || customKeys === undefined) return null;

    // Plaintext object (migration compatibility): return as-is
    if (typeof customKeys === "object") {
      return customKeys as Record<string, unknown>;
    }

    // Encrypted string: decrypt and parse
    if (typeof customKeys === "string") {
      const decrypted = decrypt(customKeys);
      return JSON.parse(decrypted) as Record<string, unknown>;
    }

    return null;
  }

  /**
   * Returns a copy of the ModelProvider with decrypted customKeys.
   */
  private withDecryptedKeys(provider: ModelProvider): ModelProvider {
    return {
      ...provider,
      customKeys: this.decryptCustomKeys(provider.customKeys) as
        | Prisma.JsonValue
        | null,
    };
  }
}
