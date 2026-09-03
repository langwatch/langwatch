import {
  type ModelProvider as PrismaModelProvider,
  type ModelProviderScope,
  Prisma,
  PrismaClient,
} from "@langwatch/prisma-client/generated";
import { z } from "zod";
import {
  modelProviderSchema,
  type Model,
  type ModelDefaultScope,
  type ModelProvider,
} from "@langwatch/model-provider-contract";
import {
  ModelProviderCredentialCodec,
  ModelProviderRepository,
} from "../../ports/model-provider.port";

type Database = Pick<PrismaClient, "modelProvider" | "gatewayChangeEvent" | "$transaction">;

const recordSchema = z.record(z.string(), z.unknown());
const stringRecordSchema = z.record(z.string(), z.string());
const jsonValueSchema = z.json();
const headerSchema = z.object({ key: z.string(), value: z.string() });
const storedModelSchema = z.union([
  z.string(),
  z.object({
    id: z.string().optional(),
    modelId: z.string().optional(),
    label: z.string().optional(),
    displayName: z.string().optional(),
    maxTokens: z.number().nullable().optional(),
    supportedParameters: z.array(z.string()).optional(),
    multimodalInputs: z.array(z.enum(["image", "file", "audio"])).optional(),
  }),
]);

export class PrismaModelProviderRepository extends ModelProviderRepository {
  private constructor(
    private readonly database: Database,
    private readonly credentials: ModelProviderCredentialCodec,
  ) {
    super();
  }

  static create(
    database: object,
    credentials: ModelProviderCredentialCodec,
  ): PrismaModelProviderRepository {
    if (!PrismaModelProviderRepository.isModelProviderDatabase(database)) {
      throw new Error("Model Provider repository requires a Prisma database adapter");
    }

    return new PrismaModelProviderRepository(database, credentials);
  }

  async tryFindById(input: {
    id: string;
    organizationId?: string;
    projectScopes?: ModelDefaultScope[];
  }): Promise<ModelProvider | null> {
    const row = await this.database.modelProvider.findFirst({
      where: {
        id: input.id,
        ...(input.organizationId ? { organizationId: input.organizationId } : {}),
        ...(input.projectScopes
          ? {
              scopes: {
                some: {
                  OR: input.projectScopes,
                },
              },
            }
          : {}),
      },
      include: { scopes: true },
    });
    return row ? PrismaModelProviderRepository.toModelProvider(row, this.credentials) : null;
  }

  async tryFindByProviderForProject(input: {
    provider: string;
    projectScopes: ModelDefaultScope[];
  }): Promise<ModelProvider | null> {
    const row = await this.database.modelProvider.findFirst({
      where: {
        provider: input.provider,
        scopes: {
          some: {
            OR: input.projectScopes,
          },
        },
      },
      include: { scopes: true },
      orderBy: { createdAt: "asc" },
    });
    return row ? PrismaModelProviderRepository.toModelProvider(row, this.credentials) : null;
  }

  async listForProject(projectScopes: ModelDefaultScope[]): Promise<ModelProvider[]> {
    const rows = await this.database.modelProvider.findMany({
      where: {
        scopes: {
          some: {
            OR: projectScopes,
          },
        },
      },
      include: { scopes: true },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => PrismaModelProviderRepository.toModelProvider(row, this.credentials));
  }

  async listForOrganization(organizationId: string): Promise<ModelProvider[]> {
    const rows = await this.database.modelProvider.findMany({
      where: { organizationId },
      include: { scopes: true },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => PrismaModelProviderRepository.toModelProvider(row, this.credentials));
  }

  async create(input: ModelProvider): Promise<ModelProvider> {
    return this.database.$transaction(async (database) => {
      const row = await database.modelProvider.create({
        data: PrismaModelProviderRepository.toCreateData(input, this.credentials),
        include: { scopes: true },
      });
      await PrismaModelProviderRepository.appendProviderChanged(
        database,
        input.organizationId,
        input.id,
      );
      return PrismaModelProviderRepository.toModelProvider(row, this.credentials);
    });
  }

  async update(input: ModelProvider): Promise<ModelProvider> {
    return this.database.$transaction(async (database) => {
      const row = await database.modelProvider.update({
        where: { id: input.id },
        data: PrismaModelProviderRepository.toUpdateData(input, this.credentials),
        include: { scopes: true },
      });
      await PrismaModelProviderRepository.appendProviderChanged(
        database,
        input.organizationId,
        input.id,
      );
      return PrismaModelProviderRepository.toModelProvider(row, this.credentials);
    });
  }

  async delete(input: { id: string; organizationId?: string; projectId?: string }): Promise<void> {
    await this.database.$transaction(async (database) => {
      const row = await database.modelProvider.delete({
        where: { id: input.id },
        select: { id: true, organizationId: true },
      });
      await PrismaModelProviderRepository.appendProviderChanged(
        database,
        row.organizationId,
        row.id,
      );
    });
  }

  async hasStoredCredentials(id: string): Promise<boolean> {
    const row = await this.database.modelProvider.findUnique({
      where: { id },
      select: { customKeys: true },
    });
    return row?.customKeys !== null && row?.customKeys !== undefined;
  }

  isRoutingHandleConflict(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
      return false;
    }
    if (error.code !== "P2002") {
      return false;
    }
    return JSON.stringify(error.meta).toLowerCase().includes("routinghandle");
  }

  private static isModelProviderDatabase(database: object): database is Database {
    return (
      "modelProvider" in database && "gatewayChangeEvent" in database && "$transaction" in database
    );
  }

  private static async appendProviderChanged(
    database: Pick<PrismaClient, "gatewayChangeEvent">,
    organizationId: string,
    modelProviderId: string,
  ): Promise<void> {
    await database.gatewayChangeEvent.create({
      data: {
        organizationId,
        kind: "MODEL_PROVIDER_UPDATED",
        modelProviderId,
        payload: Prisma.JsonNull,
      },
    });
  }

  private static toCreateData(
    input: ModelProvider,
    credentials: ModelProviderCredentialCodec,
  ): Prisma.ModelProviderCreateInput {
    return {
      id: input.id,
      organizationId: input.organizationId,
      provider: input.provider,
      name: input.name,
      enabled: input.enabled,
      routingHandle: input.routingHandle,
      customKeys:
        input.customKeys === null
          ? Prisma.JsonNull
          : PrismaModelProviderRepository.toPrismaInputJson(credentials.encode(input.customKeys)),
      customModels: PrismaModelProviderRepository.toPrismaInputJson(input.customModels),
      customEmbeddingsModels: PrismaModelProviderRepository.toPrismaInputJson(
        input.customEmbeddingsModels,
      ),
      extraHeaders: PrismaModelProviderRepository.toPrismaInputJson(input.extraHeaders),
      rateLimitRpm: input.rateLimitRpm,
      rateLimitTpm: input.rateLimitTpm,
      rateLimitRpd: input.rateLimitRpd,
      fallbackPriorityGlobal: input.fallbackPriorityGlobal,
      providerConfig: input.providerConfig
        ? PrismaModelProviderRepository.toPrismaInputJson(input.providerConfig)
        : Prisma.JsonNull,
      scopes: { create: input.scopes },
    } satisfies Prisma.ModelProviderCreateInput;
  }

  private static toUpdateData(
    input: ModelProvider,
    credentials: ModelProviderCredentialCodec,
  ): Prisma.ModelProviderUpdateInput {
    return {
      name: input.name,
      provider: input.provider,
      enabled: input.enabled,
      routingHandle: input.routingHandle,
      customKeys:
        input.customKeys === null
          ? Prisma.JsonNull
          : PrismaModelProviderRepository.toPrismaInputJson(credentials.encode(input.customKeys)),
      customModels: PrismaModelProviderRepository.toPrismaInputJson(input.customModels),
      customEmbeddingsModels: PrismaModelProviderRepository.toPrismaInputJson(
        input.customEmbeddingsModels,
      ),
      extraHeaders: PrismaModelProviderRepository.toPrismaInputJson(input.extraHeaders),
      rateLimitRpm: input.rateLimitRpm,
      rateLimitTpm: input.rateLimitTpm,
      rateLimitRpd: input.rateLimitRpd,
      fallbackPriorityGlobal: input.fallbackPriorityGlobal,
      providerConfig: input.providerConfig
        ? PrismaModelProviderRepository.toPrismaInputJson(input.providerConfig)
        : Prisma.JsonNull,
      scopes: { deleteMany: {}, create: input.scopes },
    } satisfies Prisma.ModelProviderUpdateInput;
  }

  private static toPrismaInputJson(value: unknown): Prisma.InputJsonValue {
    return PrismaModelProviderRepository.toNonNullPrismaJson(jsonValueSchema.parse(value));
  }

  private static toNonNullPrismaJson(
    value: z.infer<typeof jsonValueSchema>,
  ): Prisma.InputJsonValue {
    if (value === null) {
      throw new Error("A Prisma JSON input must not be null at the top level");
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((item) =>
        item === null ? null : PrismaModelProviderRepository.toNonNullPrismaJson(item),
      );
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        item === null ? null : PrismaModelProviderRepository.toNonNullPrismaJson(item),
      ]),
    );
  }

  private static toModelProvider(
    row: PrismaModelProvider & { scopes: ModelProviderScope[] },
    credentials: ModelProviderCredentialCodec,
  ): ModelProvider {
    return modelProviderSchema.parse({
      id: row.id,
      organizationId: row.organizationId,
      provider: row.provider,
      name: row.name,
      enabled: row.enabled,
      routingHandle: row.routingHandle ?? null,
      scopes: row.scopes.map(({ scopeType, scopeId }) => ({ scopeType, scopeId })),
      customKeys: credentials.tryDecode(row.customKeys),
      customModels: PrismaModelProviderRepository.asModels(row.customModels, "chat"),
      customEmbeddingsModels: PrismaModelProviderRepository.asModels(
        row.customEmbeddingsModels,
        "embedding",
      ),
      extraHeaders: PrismaModelProviderRepository.asHeaders(row.extraHeaders),
      rateLimitRpm: row.rateLimitRpm ?? null,
      rateLimitTpm: row.rateLimitTpm ?? null,
      rateLimitRpd: row.rateLimitRpd ?? null,
      fallbackPriorityGlobal: row.fallbackPriorityGlobal ?? null,
      rotationPolicy: row.rotationPolicy,
      providerConfig: PrismaModelProviderRepository.asRecord(row.providerConfig),
      deploymentMapping: PrismaModelProviderRepository.asStringRecord(row.deploymentMapping),
      healthStatus: row.healthStatus,
      circuitOpenedAt: row.circuitOpenedAt ?? null,
      lastHealthCheckAt: row.lastHealthCheckAt ?? null,
      disabledAt: row.disabledAt ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  private static asRecord(value: unknown): Record<string, unknown> | null {
    const parsed = recordSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  }

  private static asStringRecord(value: unknown): Record<string, string> | null {
    const parsed = stringRecordSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  }

  private static asHeaders(value: unknown): Array<{ key: string; value: string }> {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.flatMap((item) => {
      const parsed = headerSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    });
  }

  private static asModels(value: unknown, type: Model["type"]): Model[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.flatMap((item) => {
      const parsed = storedModelSchema.safeParse(item);
      if (!parsed.success) {
        return [];
      }

      if (typeof parsed.data === "string") {
        return [{ id: parsed.data, label: parsed.data, type }];
      }

      const id = parsed.data.id ?? parsed.data.modelId;
      if (!id) {
        return [];
      }

      return [
        {
          id,
          label: parsed.data.label ?? parsed.data.displayName ?? id,
          type,
          maxTokens: parsed.data.maxTokens ?? null,
          supportedParameters: parsed.data.supportedParameters ?? [],
          multimodalInputs: parsed.data.multimodalInputs ?? [],
        },
      ];
    });
  }
}
