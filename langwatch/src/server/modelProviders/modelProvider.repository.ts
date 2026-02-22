import type { ModelProvider, Prisma, PrismaClient } from "@prisma/client";
import { generate } from "@langwatch/ksuid";
import { KSUID_RESOURCES } from "../../utils/constants";
import type { CustomModelsInput } from "./customModel.schema";

/**
 * Repository for ModelProvider data access.
 * Single Responsibility: Database operations for model providers.
 */
export class ModelProviderRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(
    id: string,
    projectId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<ModelProvider | null> {
    const client = tx ?? this.prisma;
    return client.modelProvider.findUnique({
      where: { id, projectId },
    });
  }

  async findByProvider(
    provider: string,
    projectId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<ModelProvider | null> {
    const client = tx ?? this.prisma;
    return client.modelProvider.findFirst({
      where: { provider, projectId },
    });
  }

  async findAll(
    projectId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<ModelProvider[]> {
    const client = tx ?? this.prisma;
    return client.modelProvider.findMany({
      where: { projectId },
    });
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
    return client.modelProvider.create({
      data: {
        id: generate(KSUID_RESOURCES.MODEL_PROVIDER).toString(),
        projectId: data.projectId,
        provider: data.provider,
        enabled: data.enabled,
        customKeys: (data.customKeys ?? undefined) as
          | Prisma.InputJsonValue
          | undefined,
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
    return client.modelProvider.update({
      where: { id, projectId },
      data: {
        ...data,
        customKeys: data.customKeys as Prisma.InputJsonValue | undefined,
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
}
