import { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";
import { modelProviderSchema, type Model, type ModelProvider } from "@langwatch/model-provider-contract";
import {
  ModelProviderCredentialCodec,
  ModelProviderRepository,
} from "../../ports/model-provider.port";

type Database = Pick<
  PrismaClient,
  | "modelProvider"
  | "project"
  | "team"
  | "organization"
  | "gatewayChangeEvent"
  | "$transaction"
>;

export class PrismaModelProviderRepository extends ModelProviderRepository {
  private constructor(
    private readonly database: Database,
    private readonly credentials: ModelProviderCredentialCodec,
  ) { super(); }
  static create(
    database: object,
    credentials: ModelProviderCredentialCodec,
  ): PrismaModelProviderRepository {
    return new PrismaModelProviderRepository(database as Database, credentials);
  }

  async tryFindById(input: { id: string; organizationId?: string; projectId?: string }): Promise<ModelProvider | null> {
    const project = input.projectId
      ? await this.database.project.findUnique({
          where: { id: input.projectId },
          select: {
            teamId: true,
            team: { select: { organizationId: true } },
          },
        })
      : null;
    if (input.projectId && !project) return null;
    const row = await this.database.modelProvider.findFirst({
      where: {
        id: input.id,
        ...(input.organizationId ? { organizationId: input.organizationId } : {}),
        ...(input.projectId && project
          ? {
              scopes: {
                some: {
                  OR: [
                    { scopeType: "PROJECT", scopeId: input.projectId },
                    { scopeType: "TEAM", scopeId: project.teamId },
                    {
                      scopeType: "ORGANIZATION",
                      scopeId: project.team.organizationId,
                    },
                  ],
                },
              },
            }
          : {}),
      },
      include: { scopes: true },
    });
    return row ? toModelProvider(row, this.credentials) : null;
  }

  async tryFindByProviderForProject(input: { provider: string; projectId: string }): Promise<ModelProvider | null> {
    const project = await this.database.project.findUnique({ where: { id: input.projectId }, select: { teamId: true, team: { select: { organizationId: true } } } });
    if (!project) return null;
    const row = await this.database.modelProvider.findFirst({
      where: { provider: input.provider, scopes: { some: { OR: [
        { scopeType: "PROJECT", scopeId: input.projectId },
        { scopeType: "TEAM", scopeId: project.teamId },
        { scopeType: "ORGANIZATION", scopeId: project.team.organizationId },
      ] } } }, include: { scopes: true }, orderBy: { createdAt: "asc" },
    });
    return row ? toModelProvider(row, this.credentials) : null;
  }

  async listForProject(projectId: string): Promise<ModelProvider[]> {
    const project = await this.database.project.findUnique({ where: { id: projectId }, select: { teamId: true, team: { select: { organizationId: true } } } });
    if (!project) return [];
    const rows = await this.database.modelProvider.findMany({ where: { scopes: { some: { OR: [
      { scopeType: "PROJECT", scopeId: projectId }, { scopeType: "TEAM", scopeId: project.teamId }, { scopeType: "ORGANIZATION", scopeId: project.team.organizationId },
    ] } } }, include: { scopes: true }, orderBy: { createdAt: "asc" } });
    return rows.map((row) => toModelProvider(row, this.credentials));
  }

  async listForOrganization(organizationId: string): Promise<ModelProvider[]> {
    const rows = await this.database.modelProvider.findMany({ where: { organizationId }, include: { scopes: true }, orderBy: { createdAt: "asc" } });
    return rows.map((row) => toModelProvider(row, this.credentials));
  }

  async create(input: Omit<ModelProvider, "createdAt" | "updatedAt">): Promise<ModelProvider> {
    return this.database.$transaction(async (database) => {
      const row = await database.modelProvider.create({
        data: toCreateData(input, this.credentials),
        include: { scopes: true },
      });
      await appendProviderChanged(database, input.organizationId, input.id);
      return toModelProvider(row, this.credentials);
    });
  }

  async update(input: Omit<ModelProvider, "createdAt" | "updatedAt">): Promise<ModelProvider> {
    return this.database.$transaction(async (database) => {
      const row = await database.modelProvider.update({
        where: { id: input.id },
        data: toUpdateData(input, this.credentials),
        include: { scopes: true },
      });
      await appendProviderChanged(database, input.organizationId, input.id);
      return toModelProvider(row, this.credentials);
    });
  }

  async delete(input: { id: string; organizationId?: string; projectId?: string }): Promise<void> {
    await this.database.$transaction(async (database) => {
      const row = await database.modelProvider.delete({
        where: { id: input.id },
        select: { id: true, organizationId: true },
      });
      await appendProviderChanged(database, row.organizationId, row.id);
    });
  }

  async hasStoredCredentials(id: string): Promise<boolean> {
    const row = await this.database.modelProvider.findUnique({
      where: { id },
      select: { customKeys: true },
    });
    return row?.customKeys !== null && row?.customKeys !== undefined;
  }

  async tryResolveOrganizationId(input: { projectId?: string; organizationId?: string }): Promise<string | null> {
    if (input.organizationId) return input.organizationId;
    if (!input.projectId) return null;
    const project = await this.database.project.findUnique({ where: { id: input.projectId }, select: { team: { select: { organizationId: true } } } });
    return project?.team.organizationId ?? null;
  }
  async resolveOrganizationIdForScopes(scopes: Array<{ scopeType: "ORGANIZATION" | "TEAM" | "PROJECT"; scopeId: string }>): Promise<string> {
    if (scopes.length === 0) throw new Error("Provider scopes are required");
    const organizations = await Promise.all(scopes.map(async (scope) => {
      if (scope.scopeType === "ORGANIZATION") return (await this.database.organization.findUnique({ where: { id: scope.scopeId }, select: { id: true } }))?.id;
      if (scope.scopeType === "TEAM") return (await this.database.team.findUnique({ where: { id: scope.scopeId }, select: { organizationId: true } }))?.organizationId;
      return (await this.database.project.findUnique({ where: { id: scope.scopeId }, select: { team: { select: { organizationId: true } } } }))?.team.organizationId;
    }));
    const organizationId = organizations[0];
    if (!organizationId || organizations.some((id) => id !== organizationId)) throw new Error("Provider scopes must belong to one organization");
    return organizationId;
  }
}

async function appendProviderChanged(
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

function toCreateData(input: Omit<ModelProvider, "createdAt" | "updatedAt">, credentials: ModelProviderCredentialCodec) {
  return {
    id: input.id, organizationId: input.organizationId, provider: input.provider, name: input.name,
    enabled: input.enabled, routingHandle: input.routingHandle, customKeys: input.customKeys === null ? Prisma.JsonNull : credentials.encode(input.customKeys),
    customModels: input.customModels, customEmbeddingsModels: input.customEmbeddingsModels,
    extraHeaders: input.extraHeaders, rateLimitRpm: input.rateLimitRpm, rateLimitTpm: input.rateLimitTpm,
    rateLimitRpd: input.rateLimitRpd, fallbackPriorityGlobal: input.fallbackPriorityGlobal,
    providerConfig: input.providerConfig ?? Prisma.JsonNull, scopes: { create: input.scopes },
  } as unknown as Parameters<Database["modelProvider"]["create"]>[0]["data"];
}

function toUpdateData(input: Omit<ModelProvider, "createdAt" | "updatedAt">, credentials: ModelProviderCredentialCodec) {
  return {
    name: input.name, provider: input.provider, enabled: input.enabled, routingHandle: input.routingHandle,
    customKeys: input.customKeys === null ? Prisma.JsonNull : credentials.encode(input.customKeys), customModels: input.customModels,
    customEmbeddingsModels: input.customEmbeddingsModels, extraHeaders: input.extraHeaders,
    rateLimitRpm: input.rateLimitRpm, rateLimitTpm: input.rateLimitTpm, rateLimitRpd: input.rateLimitRpd,
    fallbackPriorityGlobal: input.fallbackPriorityGlobal, providerConfig: input.providerConfig ?? Prisma.JsonNull,
    scopes: { deleteMany: {}, create: input.scopes },
  } as unknown as Parameters<Database["modelProvider"]["update"]>[0]["data"];
}

function toModelProvider(row: unknown, credentials: ModelProviderCredentialCodec): ModelProvider {
  const value = row as Record<string, unknown>;
  const scopes = Array.isArray(value.scopes) ? value.scopes.map((scope) => {
    const item = scope as Record<string, unknown>;
    return { scopeType: item.scopeType, scopeId: item.scopeId };
  }) : [];
  return modelProviderSchema.parse({
    id: value.id, organizationId: value.organizationId, provider: value.provider,
    name: value.name, enabled: value.enabled, routingHandle: value.routingHandle ?? null,
    scopes, customKeys: credentials.decode(value.customKeys), customModels: asModels(value.customModels, "chat"),
    customEmbeddingsModels: asModels(value.customEmbeddingsModels, "embedding"),
    extraHeaders: asHeaders(value.extraHeaders), rateLimitRpm: value.rateLimitRpm ?? null,
    rateLimitTpm: value.rateLimitTpm ?? null, rateLimitRpd: value.rateLimitRpd ?? null,
    fallbackPriorityGlobal: value.fallbackPriorityGlobal ?? null, providerConfig: asRecord(value.providerConfig),
    createdAt: value.createdAt, updatedAt: value.updatedAt,
  });
}

function asRecord(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function asHeaders(value: unknown): Array<{ key: string; value: string }> { return Array.isArray(value) ? value.filter((item): item is { key: string; value: string } => Boolean(item && typeof item === "object" && typeof (item as Record<string, unknown>).key === "string" && typeof (item as Record<string, unknown>).value === "string")).map((item) => ({ key: item.key, value: item.value })) : []; }
function asModels(value: unknown, type: Model["type"]): Model[] { return Array.isArray(value) ? value.flatMap((item) => { if (typeof item === "string") return [{ id: item, label: item, type }]; if (!item || typeof item !== "object") return []; const row = item as Record<string, unknown>; const id = typeof row.id === "string" ? row.id : typeof row.modelId === "string" ? row.modelId : null; return id ? [{ id, label: typeof row.label === "string" ? row.label : id, type }] : []; }) : []; }
