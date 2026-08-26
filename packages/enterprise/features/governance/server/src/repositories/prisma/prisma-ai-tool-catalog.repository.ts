import {
  Prisma,
  type AiToolEntry as PrismaAiToolEntry,
  type AiToolEntryDepartment,
  type PrismaClient,
} from "@langwatch/prisma-client/generated";
import type {
  AiToolEntry,
  AiToolMemberInput,
  AiToolStarterTile,
  AiToolType,
  CreateAiToolEntryInput,
  ReorderAiToolEntriesInput,
  SeedAiToolStarterPackInput,
  UpdateAiToolEntryInput,
} from "@langwatch/enterprise-governance-contract";
import { AiToolCatalogRepository } from "../../ports/ai-tool-catalog.port";

type EntryRow = PrismaAiToolEntry & {
  departments: Pick<AiToolEntryDepartment, "departmentId">[];
};

export class PrismaAiToolCatalogRepository extends AiToolCatalogRepository {
  private constructor(private readonly database: PrismaClient) {
    super();
  }

  static create(database: object): PrismaAiToolCatalogRepository {
    return new PrismaAiToolCatalogRepository(database as PrismaClient);
  }

  async listVisible(input: {
    organizationId: string;
    userId: string;
    type?: AiToolType;
  }): Promise<AiToolEntry[]> {
    const membership = await this.database.organizationUser.findUnique({
      where: {
        userId_organizationId: {
          userId: input.userId,
          organizationId: input.organizationId,
        },
      },
      select: { departmentId: true },
    });
    const where: Prisma.AiToolEntryWhereInput = {
      organizationId: input.organizationId,
      enabled: true,
      archivedAt: null,
    };
    if (input.type) where.type = input.type;
    const rows = await this.database.aiToolEntry.findMany({
      where,
      orderBy: [{ order: "asc" }, { displayName: "asc" }],
      include: { departments: { select: { departmentId: true } } },
    });
    const departmentId = membership?.departmentId ?? null;
    const visible = rows.filter((row) => {
      if (row.departments.length > 0) {
        return (
          departmentId !== null &&
          row.departments.some((department) => department.departmentId === departmentId)
        );
      }
      if (row.scope === "department") {
        return departmentId !== null && row.scopeId === departmentId;
      }
      return true;
    });
    const bySlug = new Map<string, (typeof visible)[number]>();
    for (const row of visible) {
      const existing = bySlug.get(row.slug);
      if (!existing) {
        bySlug.set(row.slug, row);
        continue;
      }
      const rowDepartment = row.departments.length > 0 || row.scope === "department";
      const existingDepartment =
        existing.departments.length > 0 || existing.scope === "department";
      if (rowDepartment && !existingDepartment) bySlug.set(row.slug, row);
    }
    return Array.from(bySlug.values(), mapEntry);
  }

  async listAdmin(organizationId: string): Promise<AiToolEntry[]> {
    const rows = await this.database.aiToolEntry.findMany({
      where: { organizationId, archivedAt: null },
      orderBy: [{ order: "asc" }, { displayName: "asc" }],
      include: { departments: { select: { departmentId: true } } },
    });
    return rows.map(mapEntry);
  }

  async tryFindById(id: string): Promise<AiToolEntry | null> {
    const row = await this.database.aiToolEntry.findUnique({
      where: { id },
      include: { departments: { select: { departmentId: true } } },
    });
    return row ? mapEntry(row) : null;
  }

  async departmentsBelongToOrganization(input: {
    organizationId: string;
    departmentIds: string[];
  }): Promise<boolean> {
    const ids = new Set(input.departmentIds);
    const count = await this.database.department.count({
      where: {
        id: { in: Array.from(ids) },
        organizationId: input.organizationId,
        archivedAt: null,
      },
    });
    return count === ids.size;
  }

  async create(input: {
    values: CreateAiToolEntryInput;
    slug: string;
  }): Promise<AiToolEntry> {
    const legacy = legacyScope(input.values.organizationId, input.values.departmentIds);
    const row = await this.database.$transaction(async (transaction) => {
      const created = await transaction.aiToolEntry.create({
        data: {
          organizationId: input.values.organizationId,
          scope: legacy.scope,
          scopeId: legacy.scopeId,
          type: input.values.type,
          displayName: input.values.displayName,
          slug: input.slug,
          iconAsset: input.values.iconAsset ?? null,
          order: input.values.order ?? 0,
          enabled: true,
          config: input.values.config as Prisma.InputJsonValue,
          createdById: input.values.actorUserId ?? null,
          updatedById: input.values.actorUserId ?? null,
        },
      });
      if (input.values.departmentIds.length > 0) {
        await transaction.aiToolEntryDepartment.createMany({
          data: input.values.departmentIds.map((departmentId) => ({
            entryId: created.id,
            departmentId,
          })),
        });
      }
      return transaction.aiToolEntry.findUniqueOrThrow({
        where: { id: created.id },
        include: { departments: { select: { departmentId: true } } },
      });
    });
    return mapEntry(row);
  }

  async update(input: UpdateAiToolEntryInput): Promise<AiToolEntry> {
    const data: Prisma.AiToolEntryUpdateInput = {
      updatedById: input.actorUserId ?? null,
    };
    if (input.displayName !== undefined) data.displayName = input.displayName;
    if (input.iconAsset !== undefined) data.iconAsset = input.iconAsset;
    if (input.order !== undefined) data.order = input.order;
    if (input.enabled !== undefined) data.enabled = input.enabled;
    if (input.type !== undefined) data.type = input.type;
    if (input.config !== undefined) {
      data.config = input.config as Prisma.InputJsonValue;
    }
    if (input.departmentIds !== undefined) {
      const mirror = legacyScope(input.organizationId, input.departmentIds);
      data.scope = mirror.scope;
      data.scopeId = mirror.scopeId;
    }
    const row = await this.database.$transaction(async (transaction) => {
      await transaction.aiToolEntry.update({ where: { id: input.id }, data });
      if (input.departmentIds !== undefined) {
        await transaction.aiToolEntryDepartment.deleteMany({
          where: { entryId: input.id },
        });
        if (input.departmentIds.length > 0) {
          await transaction.aiToolEntryDepartment.createMany({
            data: input.departmentIds.map((departmentId) => ({
              entryId: input.id,
              departmentId,
            })),
          });
        }
      }
      return transaction.aiToolEntry.findUniqueOrThrow({
        where: { id: input.id },
        include: { departments: { select: { departmentId: true } } },
      });
    });
    return mapEntry(row);
  }

  async remove(id: string): Promise<AiToolEntry> {
    const row = await this.database.aiToolEntry.delete({
      where: { id },
      include: { departments: { select: { departmentId: true } } },
    });
    return mapEntry(row);
  }

  async ensureDefaultCatalog(input: {
    organizationId: string;
    tiles: readonly AiToolStarterTile[];
  }): Promise<{ hasSeeded: boolean; created: number }> {
    const count = await this.database.aiToolEntry.count({
      where: { organizationId: input.organizationId },
    });
    if (count > 0) return { hasSeeded: false, created: 0 };
    return this.database.$transaction(
      async (transaction) => {
        await transaction.$executeRaw`-- @tenancy: advisory-lock helper, key is organization-bounded
SELECT pg_advisory_xact_lock(hashtextextended(${`ai-tool-default-catalog:${input.organizationId}`}, 0))`;
        const lockedCount = await transaction.aiToolEntry.count({
          where: { organizationId: input.organizationId },
        });
        if (lockedCount > 0) return { hasSeeded: false, created: 0 };
        await transaction.aiToolEntry.createMany({
          data: input.tiles.map((tile, order) =>
            starterData(input.organizationId, tile, order, null),
          ),
        });
        return { hasSeeded: true, created: input.tiles.length };
      },
      { timeout: 15_000, maxWait: 10_000 },
    );
  }

  async seedStarterPack(input: {
    values: SeedAiToolStarterPackInput;
    tiles: readonly AiToolStarterTile[];
  }): Promise<{ created: number; updated: number; skipped: number }> {
    const existing = await this.database.aiToolEntry.findMany({
      where: {
        organizationId: input.values.organizationId,
        scope: "organization",
        scopeId: input.values.organizationId,
      },
      select: { id: true, type: true, displayName: true, iconAsset: true },
    });
    const fingerprint = (type: string, name: string) =>
      `${type}::${name.trim().toLowerCase()}`;
    const byFingerprint = new Map(
      existing.map((row) => [fingerprint(row.type, row.displayName), row]),
    );
    const create: AiToolStarterTile[] = [];
    const update: Array<{ id: string; iconAsset: string }> = [];
    let skipped = 0;
    for (const tile of input.tiles) {
      const match = byFingerprint.get(fingerprint(tile.type, tile.displayName));
      if (!match) create.push(tile);
      else if (match.iconAsset === null) {
        update.push({ id: match.id, iconAsset: tile.iconAsset });
      } else skipped += 1;
    }
    if (create.length === 0 && update.length === 0) {
      return { created: 0, updated: 0, skipped };
    }
    const operations: Prisma.PrismaPromise<unknown>[] = [];
    for (const row of update) {
      operations.push(
        this.database.aiToolEntry.update({
          where: { id: row.id },
          data: {
            iconAsset: row.iconAsset,
            updatedById: input.values.actorUserId ?? null,
          },
        }),
      );
    }
    for (const [index, tile] of create.entries()) {
      operations.push(
        this.database.aiToolEntry.create({
          data: starterData(
            input.values.organizationId,
            tile,
            existing.length + index,
            input.values.actorUserId,
          ),
        }),
      );
    }
    await this.database.$transaction(operations);
    return { created: create.length, updated: update.length, skipped };
  }

  async listConfiguredProvidersForUser(input: AiToolMemberInput): Promise<string[]> {
    const memberships = await this.database.teamUser.findMany({
      where: {
        userId: input.userId,
        team: { organizationId: input.organizationId },
      },
      select: {
        teamId: true,
        team: { select: { projects: { select: { id: true } } } },
      },
    });
    const teamIds = memberships.map(({ teamId }) => teamId);
    const projectIds = memberships.flatMap(({ team }) =>
      team.projects.map(({ id }) => id),
    );
    return this.configuredProviders(input.organizationId, teamIds, projectIds);
  }

  async listConfiguredProvidersForOrganization(
    organizationId: string,
  ): Promise<string[]> {
    const teams = await this.database.team.findMany({
      where: { organizationId },
      select: { id: true, projects: { select: { id: true } } },
    });
    return this.configuredProviders(
      organizationId,
      teams.map(({ id }) => id),
      teams.flatMap(({ projects }) => projects.map(({ id }) => id)),
    );
  }

  async listRoutingPolicyOptions(
    organizationId: string,
  ): Promise<Array<{ id: string; name: string }>> {
    return this.database.routingPolicy.findMany({
      where: {
        organizationId,
        scopes: {
          some: { scopeType: "ORGANIZATION", scopeId: organizationId },
        },
      },
      select: { id: true, name: true },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    });
  }

  async reorder(input: ReorderAiToolEntriesInput): Promise<void> {
    const operations = input.updates.map(({ id, order }) =>
      this.database.aiToolEntry.updateMany({
        where: { id, organizationId: input.organizationId },
        data: { order },
      }),
    );
    await this.database.$transaction(operations);
  }

  private async configuredProviders(
    organizationId: string,
    teamIds: string[],
    projectIds: string[],
  ): Promise<string[]> {
    const scopes: Prisma.ModelProviderScopeWhereInput[] = [
      { scopeType: "ORGANIZATION", scopeId: organizationId },
    ];
    if (teamIds.length > 0) {
      scopes.push({ scopeType: "TEAM", scopeId: { in: teamIds } });
    }
    if (projectIds.length > 0) {
      scopes.push({ scopeType: "PROJECT", scopeId: { in: projectIds } });
    }
    const rows = await this.database.modelProvider.findMany({
      where: {
        enabled: true,
        disabledAt: null,
        scopes: { some: { OR: scopes } },
      },
      select: { provider: true },
    });
    return Array.from(new Set(rows.map(({ provider }) => provider).filter(Boolean)));
  }
}

function legacyScope(
  organizationId: string,
  departmentIds: string[],
): { scope: "organization" | "department"; scopeId: string } {
  if (departmentIds.length === 0) {
    return { scope: "organization", scopeId: organizationId };
  }
  return { scope: "department", scopeId: departmentIds[0]! };
}

function starterData(
  organizationId: string,
  tile: AiToolStarterTile,
  order: number,
  actorUserId?: string | null,
): Prisma.AiToolEntryCreateManyInput {
  return {
    organizationId,
    scope: "organization",
    scopeId: organizationId,
    type: tile.type,
    displayName: tile.displayName,
    slug: tile.slug,
    iconAsset: tile.iconAsset,
    order,
    enabled: true,
    config: tile.config as Prisma.InputJsonValue,
    createdById: actorUserId ?? null,
    updatedById: actorUserId ?? null,
  };
}

function mapEntry(row: EntryRow): AiToolEntry {
  let departmentIds = row.departments.map(({ departmentId }) => departmentId);
  if (departmentIds.length === 0 && row.scope === "department" && row.scopeId) {
    departmentIds = [row.scopeId];
  }
  const scope =
    row.scope === "organization" || row.scope === "department" || row.scope === "team"
      ? row.scope
      : "organization";
  const type =
    row.type === "coding_assistant" ||
    row.type === "model_provider" ||
    row.type === "external_tool"
      ? row.type
      : "external_tool";
  return {
    id: row.id,
    organizationId: row.organizationId,
    scope,
    scopeId: row.scopeId,
    departmentIds,
    type,
    displayName: row.displayName,
    slug: row.slug,
    iconKey: row.iconKey,
    iconAsset: row.iconAsset,
    order: row.order,
    enabled: row.enabled,
    config: toObject(row.config),
    archivedAtMs: row.archivedAt?.getTime() ?? null,
    createdAtMs: row.createdAt.getTime(),
    updatedAtMs: row.updatedAt.getTime(),
    createdById: row.createdById,
    updatedById: row.updatedById,
  };
}

function toObject(value: Prisma.JsonValue): Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== "object") return {};
  return value as Record<string, unknown>;
}
