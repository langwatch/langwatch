import type { ModelProvider, ModelProviderScope, Prisma, PrismaClient } from "@prisma/client";
import { generate } from "@langwatch/ksuid";
import { KSUID_RESOURCES } from "../../utils/constants";
import { encrypt, decrypt } from "../../utils/encryption";
import type { CustomModelsInput } from "./customModel.schema";

/**
 * A ModelProvider row hydrated with its ModelProviderScope entries.
 * The `scopes` relation is the authoritative grant set — the `projectId`
 * column is kept only as a legacy pointer and does NOT imply access on
 * its own.
 */
export type ModelProviderWithScopes = ModelProvider & {
  scopes: ModelProviderScope[];
};

export type ScopeInput = {
  scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
  scopeId: string;
};

/**
 * Repository for ModelProvider data access.
 *
 * Iter 109: the `(scopeType, scopeId)` columns moved to a
 * `ModelProviderScope` join table, so a single credential can now be
 * granted to N orgs/teams/projects. The repository's access resolver
 * walks that table; the `projectId` column remains as a legacy pointer
 * for backwards compatibility but carries no access semantics on its
 * own.
 */
export class ModelProviderRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(
    id: string,
    projectId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<ModelProviderWithScopes | null> {
    const client = tx ?? this.prisma;
    const result = await client.modelProvider.findFirst({
      where: { id, projectId },
      include: { scopes: true },
    });
    return result ? this.withDecryptedKeys(result) : null;
  }

  async findByProvider(
    provider: string,
    projectId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<ModelProviderWithScopes | null> {
    const client = tx ?? this.prisma;
    const result = await client.modelProvider.findFirst({
      where: { provider, projectId },
      include: { scopes: true },
    });
    return result ? this.withDecryptedKeys(result) : null;
  }

  async findAll(
    projectId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<ModelProviderWithScopes[]> {
    const client = tx ?? this.prisma;
    const results = await client.modelProvider.findMany({
      where: { projectId },
      include: { scopes: true },
    });
    return results.map((result) => this.withDecryptedKeys(result));
  }

  /**
   * Find every ModelProvider visible to a project under the multi-scope
   * ladder: a credential is visible when it has at least one scope entry
   * matching the project itself, the project's team, or the project's
   * organization.
   *
   * When the same provider string is bound multiple times in scope (e.g.
   * an ORG row and a PROJECT override), the narrower-scope row wins at
   * the reducer layer (see ModelProviderService). The repository itself
   * returns all rows so consumers that want the full set (gateway
   * binding picker, settings list page) can see everything.
   */
  async findAllAccessibleForProject(
    projectId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<ModelProviderWithScopes[]> {
    const client = tx ?? this.prisma;
    const project = await client.project.findUnique({
      where: { id: projectId },
      select: { id: true, teamId: true, team: { select: { organizationId: true } } },
    });
    if (!project) return [];
    const results = await client.modelProvider.findMany({
      where: {
        scopes: {
          some: {
            OR: [
              { scopeType: "PROJECT", scopeId: projectId },
              { scopeType: "TEAM", scopeId: project.teamId },
              { scopeType: "ORGANIZATION", scopeId: project.team.organizationId },
            ],
          },
        },
      },
      include: { scopes: true },
    });
    return results.map((result) => this.withDecryptedKeys(result));
  }

  async create(
    data: {
      projectId: string;
      name: string;
      provider: string;
      enabled: boolean;
      customKeys?: Record<string, unknown> | null;
      customModels?: CustomModelsInput;
      customEmbeddingsModels?: CustomModelsInput;
      extraHeaders?: { key: string; value: string }[];
      /**
       * Scope grants for this credential. Required — every row must be
       * accessible to at least one (scopeType, scopeId) pair. When the
       * caller omits scopes, defaults to a single PROJECT entry pointing
       * at `projectId`, matching the legacy iter-107 behavior.
       */
      scopes?: ScopeInput[];
    },
    tx?: Prisma.TransactionClient,
  ): Promise<ModelProviderWithScopes> {
    const client = tx ?? this.prisma;
    const encryptedKeys = this.encryptCustomKeys(data.customKeys ?? undefined);
    const scopes =
      data.scopes && data.scopes.length > 0
        ? data.scopes
        : [{ scopeType: "PROJECT" as const, scopeId: data.projectId }];

    return client.modelProvider.create({
      data: {
        id: generate(KSUID_RESOURCES.MODEL_PROVIDER).toString(),
        projectId: data.projectId,
        name: data.name,
        provider: data.provider,
        enabled: data.enabled,
        customKeys: encryptedKeys as Prisma.InputJsonValue | undefined,
        customModels: data.customModels as Prisma.InputJsonValue | undefined,
        customEmbeddingsModels: data.customEmbeddingsModels as
          | Prisma.InputJsonValue
          | undefined,
        extraHeaders: data.extraHeaders ?? [],
        scopes: {
          create: scopes.map((scope) => ({ scopeType: scope.scopeType, scopeId: scope.scopeId })),
        },
      },
      include: { scopes: true },
    });
  }

  async update(
    id: string,
    projectId: string,
    data: {
      name?: string;
      enabled?: boolean;
      customKeys?: Record<string, unknown>;
      customModels?: CustomModelsInput;
      customEmbeddingsModels?: CustomModelsInput;
      extraHeaders?: { key: string; value: string }[];
      /**
       * Replace the scope set atomically. When provided, all existing
       * ModelProviderScope rows for this MP are deleted and the new set
       * inserted; when omitted the scope set is untouched.
       */
      scopes?: ScopeInput[];
    },
    tx?: Prisma.TransactionClient,
  ): Promise<ModelProviderWithScopes> {
    const encryptedKeys = this.encryptCustomKeys(data.customKeys);
    const { scopes, ...rest } = data;

    const runUpdate = async (workingTx: Prisma.TransactionClient) => {
      if (scopes) {
        await workingTx.modelProviderScope.deleteMany({
          where: { modelProviderId: id },
        });
        await workingTx.modelProviderScope.createMany({
          data: scopes.map((scope) => ({
            modelProviderId: id,
            scopeType: scope.scopeType,
            scopeId: scope.scopeId,
          })),
        });
      }

      return workingTx.modelProvider.update({
        where: { id, projectId },
        data: {
          ...rest,
          customKeys: encryptedKeys as Prisma.InputJsonValue | undefined,
          customModels: data.customModels as Prisma.InputJsonValue | undefined,
          customEmbeddingsModels: data.customEmbeddingsModels as
            | Prisma.InputJsonValue
            | undefined,
        },
        include: { scopes: true },
      });
    };

    // Reuse the caller's transaction when provided so scope replacement
    // is atomic with their other writes; otherwise spin our own.
    if (tx) return runUpdate(tx);
    return this.prisma.$transaction(runUpdate);
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
   * Preserves the `scopes` relation as-is.
   */
  private withDecryptedKeys(
    provider: ModelProviderWithScopes,
  ): ModelProviderWithScopes {
    return {
      ...provider,
      customKeys: this.decryptCustomKeys(provider.customKeys) as
        | Prisma.JsonValue
        | null,
    };
  }
}
