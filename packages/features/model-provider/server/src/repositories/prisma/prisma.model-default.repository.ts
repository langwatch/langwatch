import { PrismaClient } from "@langwatch/prisma-client/generated";
import { modelDefaultConfigSchema, type ModelDefaultConfig, type ModelDefaultScope, type ModelProviderScopeType } from "@langwatch/model-provider-contract";
import { ModelDefaultRepository } from "../../ports/model-provider.port";

type Database = Pick<PrismaClient, "modelDefaultConfig" | "modelDefaultConfigScope" | "project" | "team" | "organization" | "$executeRaw">;
type RootDatabase = Database & Pick<PrismaClient, "$transaction">;

export class PrismaModelDefaultRepository extends ModelDefaultRepository {
  private constructor(private readonly database: RootDatabase) { super(); }
  static create(database: object): PrismaModelDefaultRepository { return new PrismaModelDefaultRepository(database as RootDatabase); }

  async listForProject(projectId: string): Promise<ModelDefaultConfig[]> {
    const scopes = await this.projectScopes(projectId);
    const rows = await this.database.modelDefaultConfig.findMany({ where: { scopes: { some: { OR: scopes } } }, include: { scopes: true }, orderBy: { createdAt: "desc" } });
    return rows.map(toConfig);
  }
  async listForOrganization(organizationId: string): Promise<ModelDefaultConfig[]> {
    const rows = await this.database.modelDefaultConfig.findMany({ where: { organizationId }, include: { scopes: true }, orderBy: { createdAt: "desc" } });
    return rows.map(toConfig);
  }
  async getProjectContext(projectId: string): Promise<{ teamId: string | null; organizationId: string | null; organizationName: string | null }> {
    const project = await this.database.project.findUnique({ where: { id: projectId }, select: { teamId: true, team: { select: { organizationId: true, organization: { select: { name: true } } } } } });
    if (!project) throw new Error("Project was not found");
    return { teamId: project.teamId, organizationId: project.team.organizationId, organizationName: project.team.organization.name };
  }
  async listOrganizationScopes(organizationId: string): Promise<{ organization: { id: string; name: string } | null; teams: { id: string; name: string }[]; projects: { id: string; name: string; teamId: string }[] }> {
    const organization = await this.database.organization.findUnique({ where: { id: organizationId }, select: { id: true, name: true } });
    const teams = await this.database.team.findMany({ where: { organizationId }, select: { id: true, name: true }, orderBy: { name: "asc" } });
    const projects = await this.database.project.findMany({ where: { team: { organizationId } }, select: { id: true, name: true, teamId: true }, orderBy: { name: "asc" } });
    return { organization, teams, projects };
  }
  async tryGetById(id: string): Promise<ModelDefaultConfig | null> { const row = await this.database.modelDefaultConfig.findUnique({ where: { id }, include: { scopes: true } }); return row ? toConfig(row) : null; }
  async save(input: Omit<ModelDefaultConfig, "createdAt"> & { createdAt?: Date }): Promise<ModelDefaultConfig> {
    const organizationId = await this.organizationIdForScopes(input.scopes);
    return this.database.$transaction(async (database) => this.saveInTransaction(database, input, organizationId));
  }

  private async saveInTransaction(database: Database, input: Omit<ModelDefaultConfig, "createdAt"> & { createdAt?: Date }, organizationId: string): Promise<ModelDefaultConfig> {
    await this.lockForWrite(database, organizationId, input.scopes);
      const held = await database.modelDefaultConfigScope.findMany({
        where: { OR: input.scopes.map((scope) => ({ scopeType: scope.scopeType, scopeId: scope.scopeId })), ...(input.id ? { configId: { not: input.id } } : {}) },
        select: { id: true, configId: true },
      });
      if (held.length > 0) {
        const attachmentIds = held.map(({ id }) => id).sort();
        const configIds = [...new Set(held.map(({ configId }) => configId))].sort();
        await database.modelDefaultConfigScope.deleteMany({ where: { id: { in: attachmentIds } } });
        await database.modelDefaultConfig.deleteMany({ where: { id: { in: configIds }, scopes: { none: {} } } });
      }
      const row = await database.modelDefaultConfig.upsert({
        where: { id: input.id },
        create: { id: input.id, organizationId, config: input.config, authorId: input.authorId, scopes: { create: input.scopes } },
        update: { config: input.config, organizationId, authorId: input.authorId, scopes: { deleteMany: {}, create: input.scopes } },
        include: { scopes: true },
      });
      return toConfig(row);
  }

  private async lockForWrite(database: Database, organizationId: string, scopes: ModelDefaultScope[]): Promise<void> {
    await database.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mdc-org:${organizationId}`}, 0))`;
    for (const scope of [...scopes].sort(scopeSort)) {
      await database.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mdc:${scope.scopeType}:${scope.scopeId}`}, 0))`;
    }
  }
  async set(input: { scope: ModelDefaultScope; key: string; model: string | null; authorId: string | null }): Promise<void> {
    const organizationId = await this.organizationForScope(input.scope);
    await this.database.$transaction(async (database) => {
      await this.lockForWrite(database, organizationId, [input.scope]);
      const configs = await database.modelDefaultConfig.findMany({ where: { scopes: { some: input.scope } }, include: { scopes: true }, orderBy: { createdAt: "desc" }, take: 1 });
      const existing = configs[0];
      const config = existing ? toConfig(existing).config : {};
      if (input.model === null) delete config[input.key]; else config[input.key] = input.model;
      if (Object.keys(config).length === 0) {
        if (existing) await database.modelDefaultConfig.deleteMany({ where: { id: existing.id } });
        return;
      }
      await this.saveInTransaction(database, { id: existing?.id ?? `model_default_${Date.now()}_${Math.random().toString(36).slice(2)}`, config, scopes: [input.scope], authorId: input.authorId }, organizationId);
    });
  }
  async delete(id: string): Promise<void> { await this.database.modelDefaultConfig.deleteMany({ where: { id } }); }
  async tryResolve(input: { projectId: string; featureKey: string }): Promise<string | null> {
    const configs = await this.listForProject(input.projectId);
    const priority: Record<ModelProviderScopeType, number> = { PROJECT: 3, TEAM: 2, ORGANIZATION: 1 };
    const matching = configs.flatMap((config) => config.scopes.flatMap((scope) => config.config[input.featureKey] ? [{ value: config.config[input.featureKey]!, priority: priority[scope.scopeType] }] : []));
    matching.sort((left, right) => right.priority - left.priority);
    return matching[0]?.value ?? null;
  }
  private async projectScopes(projectId: string) {
    const project = await this.database.project.findUnique({ where: { id: projectId }, select: { teamId: true, team: { select: { organizationId: true } } } });
    if (!project) return [{ scopeType: "PROJECT" as const, scopeId: projectId }];
    return [
      { scopeType: "PROJECT" as const, scopeId: projectId },
      { scopeType: "TEAM" as const, scopeId: project.teamId },
      { scopeType: "ORGANIZATION" as const, scopeId: project.team.organizationId },
    ];
  }
  private async organizationForScope(scope: ModelDefaultScope): Promise<string> {
    if (scope.scopeType === "ORGANIZATION") {
      const row = await this.database.organization.findUnique({ where: { id: scope.scopeId }, select: { id: true } });
      if (!row) throw new Error("Model default scope organization was not found");
      return row.id;
    }
    if (scope.scopeType === "TEAM") {
      const row = await this.database.team.findUnique({ where: { id: scope.scopeId }, select: { organizationId: true } });
      if (!row) throw new Error("Model default scope team was not found");
      return row.organizationId;
    }
    const row = await this.database.project.findUnique({ where: { id: scope.scopeId }, select: { team: { select: { organizationId: true } } } });
    if (!row) throw new Error("Model default scope project was not found");
    return row.team.organizationId;
  }

  private async organizationIdForScopes(scopes: ModelDefaultScope[]): Promise<string> {
    if (scopes.length === 0) throw new Error("At least one model default scope is required");
    const organizations = await Promise.all(scopes.map((scope) => this.organizationForScope(scope)));
    const organizationId = organizations[0]!;
    if (organizations.some((id) => id !== organizationId)) throw new Error("Model default scopes must belong to one organization");
    return organizationId;
  }
}

function scopeSort(left: ModelDefaultScope, right: ModelDefaultScope): number {
  const leftKey = `${left.scopeType}:${left.scopeId}`;
  const rightKey = `${right.scopeType}:${right.scopeId}`;
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function toConfig(row: unknown): ModelDefaultConfig {
  const value = row as Record<string, unknown>;
  const scopes = Array.isArray(value.scopes) ? value.scopes.map((scope) => { const item = scope as Record<string, unknown>; return { scopeType: item.scopeType, scopeId: item.scopeId }; }) : [];
  const config = value.config && typeof value.config === "object" && !Array.isArray(value.config) ? Object.fromEntries(Object.entries(value.config).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : {};
  return modelDefaultConfigSchema.parse({ id: value.id, config, scopes, authorId: value.authorId ?? null, createdAt: value.createdAt, updatedAt: value.updatedAt, organizationId: value.organizationId });
}
