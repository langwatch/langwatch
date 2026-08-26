import {
  type ModelDefaultConfig as PrismaModelDefaultConfig,
  type ModelDefaultConfigScope,
  PrismaClient,
} from "@langwatch/prisma-client/generated";
import {
  modelDefaultConfigSchema,
  type ModelDefaultConfig,
  type ModelDefaultScope,
  type ModelProviderScopeType,
} from "@langwatch/model-provider-contract";
import {
  ModelDefaultRepository,
  type ModelDefaultConfigSaveInput,
} from "../../ports/model-provider.port";

type Database = Pick<
  PrismaClient,
  "modelDefaultConfig" | "modelDefaultConfigScope" | "$executeRaw"
>;
type RootDatabase = Database & Pick<PrismaClient, "$transaction">;

export class PrismaModelDefaultRepository extends ModelDefaultRepository {
  private constructor(private readonly database: RootDatabase) {
    super();
  }

  static create(database: object): PrismaModelDefaultRepository {
    if (!isModelDefaultDatabase(database)) {
      throw new Error("Model Default repository requires a Prisma database adapter");
    }

    return new PrismaModelDefaultRepository(database);
  }

  async listForProject(scopes: ModelDefaultScope[]): Promise<ModelDefaultConfig[]> {
    const rows = await this.database.modelDefaultConfig.findMany({
      where: { scopes: { some: { OR: scopes } } },
      include: { scopes: true },
      orderBy: { createdAt: "desc" },
    });

    return rows.map(toConfig);
  }

  async listForOrganization(organizationId: string): Promise<ModelDefaultConfig[]> {
    const rows = await this.database.modelDefaultConfig.findMany({
      where: { organizationId },
      include: { scopes: true },
      orderBy: { createdAt: "desc" },
    });

    return rows.map(toConfig);
  }

  async tryGetById(id: string): Promise<ModelDefaultConfig | null> {
    const row = await this.database.modelDefaultConfig.findUnique({
      where: { id },
      include: { scopes: true },
    });

    return row ? toConfig(row) : null;
  }

  async tryFindByScope(scope: ModelDefaultScope): Promise<ModelDefaultConfig | null> {
    const row = await this.database.modelDefaultConfig.findFirst({
      where: { scopes: { some: scope } },
      include: { scopes: true },
      orderBy: { createdAt: "desc" },
    });

    return row ? toConfig(row) : null;
  }

  async save(input: ModelDefaultConfigSaveInput): Promise<ModelDefaultConfig> {
    return this.database.$transaction(async (database) =>
      this.saveInTransaction(database, input, input.organizationId),
    );
  }

  private async saveInTransaction(
    database: Database,
    input: ModelDefaultConfigSaveInput,
    organizationId: string,
  ): Promise<ModelDefaultConfig> {
    await this.lockForWrite(database, organizationId, input.scopes);
    const held = await database.modelDefaultConfigScope.findMany({
      where: {
        OR: input.scopes.map((scope) => ({
          scopeType: scope.scopeType,
          scopeId: scope.scopeId,
        })),
        ...(input.id ? { configId: { not: input.id } } : {}),
      },
      select: { id: true, configId: true },
    });
    if (held.length > 0) {
      const attachmentIds = held.map(({ id }) => id).sort();
      const configIds = [...new Set(held.map(({ configId }) => configId))].sort();
      await database.modelDefaultConfigScope.deleteMany({
        where: { id: { in: attachmentIds } },
      });
      await database.modelDefaultConfig.deleteMany({
        where: { id: { in: configIds }, scopes: { none: {} } },
      });
    }
    const row = await database.modelDefaultConfig.upsert({
      where: { id: input.id },
      create: {
        id: input.id,
        organizationId,
        config: input.config,
        authorId: input.authorId,
        scopes: { create: input.scopes },
      },
      update: {
        config: input.config,
        organizationId,
        authorId: input.authorId,
        scopes: { deleteMany: {}, create: input.scopes },
      },
      include: { scopes: true },
    });
    return toConfig(row);
  }

  private async lockForWrite(
    database: Database,
    organizationId: string,
    scopes: ModelDefaultScope[],
  ): Promise<void> {
    await database.$executeRaw`-- @tenancy: transaction-scoped advisory lock; organization is in the lock key
SELECT pg_advisory_xact_lock(hashtextextended(${`mdc-org:${organizationId}`}, 0))`;
    for (const scope of [...scopes].sort(scopeSort)) {
      await database.$executeRaw`-- @tenancy: transaction-scoped advisory lock; scope is in the lock key
SELECT pg_advisory_xact_lock(hashtextextended(${`mdc:${scope.scopeType}:${scope.scopeId}`}, 0))`;
    }
  }

  async set(input: {
    id: string;
    organizationId: string;
    scope: ModelDefaultScope;
    key: string;
    model: string | null;
    authorId: string | null;
  }): Promise<void> {
    await this.database.$transaction(async (database) => {
      await this.lockForWrite(database, input.organizationId, [input.scope]);
      const configs = await database.modelDefaultConfig.findMany({
        where: { scopes: { some: input.scope } },
        include: { scopes: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      });
      const existing = configs[0];
      const config = existing ? toConfig(existing).config : {};
      if (input.model === null) {
        delete config[input.key];
      } else {
        config[input.key] = input.model;
      }

      if (Object.keys(config).length === 0) {
        if (existing) {
          await database.modelDefaultConfig.deleteMany({ where: { id: existing.id } });
        }

        return;
      }

      await this.saveInTransaction(
        database,
        {
          id: existing?.id ?? input.id,
          config,
          scopes: [input.scope],
          authorId: input.authorId,
          organizationId: input.organizationId,
        },
        input.organizationId,
      );
    });
  }

  async delete(id: string): Promise<void> {
    await this.database.modelDefaultConfig.deleteMany({ where: { id } });
  }
}

function isModelDefaultDatabase(database: object): database is RootDatabase {
  return (
    "modelDefaultConfig" in database &&
    "modelDefaultConfigScope" in database &&
    "$executeRaw" in database &&
    "$transaction" in database
  );
}

function scopeSort(left: ModelDefaultScope, right: ModelDefaultScope): number {
  const leftKey = `${left.scopeType}:${left.scopeId}`;
  const rightKey = `${right.scopeType}:${right.scopeId}`;
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function toConfig(
  row: PrismaModelDefaultConfig & { scopes: ModelDefaultConfigScope[] },
): ModelDefaultConfig {
  return modelDefaultConfigSchema.parse({
    id: row.id,
    config: row.config,
    scopes: row.scopes.map(({ scopeType, scopeId }) => ({ scopeType, scopeId })),
    authorId: row.authorId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    organizationId: row.organizationId,
  });
}
