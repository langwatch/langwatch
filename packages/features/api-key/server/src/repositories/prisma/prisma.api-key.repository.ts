import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { ApiKeyRepository, type ApiKeyCreateRecord, type ApiKeyUpdateRecord, type StoredApiKey } from "../api-key.repository";

const HIDDEN_SYSTEM_KEY_NAMES = ["Langy session"] as const;

export type PrismaApiKeyDatabase = Pick<
  PrismaClient,
  "apiKey" | "team" | "project"
>;

/** Prisma persistence is private to the API-key server package. */
export class PrismaApiKeyRepository extends ApiKeyRepository {
  private constructor(private readonly database: PrismaApiKeyDatabase) { super(); }
  static create(database: PrismaApiKeyDatabase): PrismaApiKeyRepository { return new PrismaApiKeyRepository(database); }

  create(input: ApiKeyCreateRecord): Promise<StoredApiKey> {
    const { roleBindings: _roleBindings, startsDisabled, ...data } = input;
    return this.database.apiKey.create({
      data: {
        ...data,
        ...(startsDisabled ? { revokedAt: new Date() } : {}),
      },
      include: { roleBindings: true },
    });
  }
  activate(input: { id: string }): Promise<StoredApiKey> { return this.database.apiKey.update({ where: { id: input.id }, data: { revokedAt: null }, include: { roleBindings: true } }); }
  tryFindByLookupId(input: { lookupId: string }): Promise<StoredApiKey | null> { return this.database.apiKey.findFirst({ where: { lookupId: input.lookupId, OR: [{ userId: null }, { user: { deactivatedAt: null } }] }, include: { roleBindings: true } }); }
  tryFindById(input: { id: string }): Promise<StoredApiKey | null> { return this.database.apiKey.findFirst({ where: { id: input.id }, include: { roleBindings: true } }); }
  tryFindByIdInOrganization(input: { id: string; organizationId: string }): Promise<StoredApiKey | null> { return this.database.apiKey.findFirst({ where: { id: input.id, organizationId: input.organizationId }, include: { roleBindings: true } }); }
  listForUser(input: { organizationId: string; userId: string }): Promise<StoredApiKey[]> {
    return this.database.apiKey.findMany({ where: { organizationId: input.organizationId, revokedAt: null, name: { notIn: [...HIDDEN_SYSTEM_KEY_NAMES] }, OR: [{ userId: input.userId }, { userId: null, ingestSourceType: null }] }, include: { roleBindings: true }, orderBy: { createdAt: "desc" } });
  }
  listForOrganization(input: { organizationId: string }): Promise<StoredApiKey[]> {
    return this.database.apiKey.findMany({ where: { organizationId: input.organizationId, revokedAt: null, name: { notIn: [...HIDDEN_SYSTEM_KEY_NAMES] } }, include: { roleBindings: true }, orderBy: { createdAt: "desc" } });
  }
  update(input: ApiKeyUpdateRecord): Promise<StoredApiKey> {
    const { id, roleBindings: _roleBindings, ...data } = input;
    return this.database.apiKey.update({ where: { id }, data, include: { roleBindings: true } });
  }
  revoke(input: { id: string }): Promise<StoredApiKey> { return this.update({ id: input.id, revokedAt: new Date() }); }
  async updateLastUsedAt(input: { id: string }): Promise<void> { await this.update({ id: input.id, lastUsedAt: new Date() }); }
  async upgradeHash(input: { id: string; hashedSecret: string }): Promise<void> { await this.update({ id: input.id, hashedSecret: input.hashedSecret }); }
  tryFindIngestKey(input: { organizationId: string; projectId: string; sourceType: string }): Promise<StoredApiKey | null> { return this.database.apiKey.findFirst({ where: { organizationId: input.organizationId, ingestSourceType: input.sourceType, revokedAt: null, roleBindings: { some: { scopeType: "PROJECT", scopeId: input.projectId } } }, include: { roleBindings: true }, orderBy: { createdAt: "desc" } }); }
  findIngestKeysForProject(input: { organizationId: string; projectId: string }): Promise<StoredApiKey[]> { return this.database.apiKey.findMany({ where: { organizationId: input.organizationId, ingestSourceType: { not: null }, revokedAt: null, roleBindings: { some: { scopeType: "PROJECT", scopeId: input.projectId } } }, include: { roleBindings: true }, orderBy: { createdAt: "desc" } }); }
  async tryFindLegacyProjectId(input: { token: string }): Promise<string | null> {
    const row = await this.database.project.findUnique({
      where: { apiKey: input.token, archivedAt: null },
      select: { id: true },
    });
    return row?.id ?? null;
  }
  async rotateLegacyProjectKey(input: { projectId: string; token: string }): Promise<boolean> {
    const result = await this.database.project.updateMany({
      where: { id: input.projectId, archivedAt: null },
      data: { apiKey: input.token },
    });
    return result.count > 0;
  }
  async tryFindPersonalWorkspaceOwner(input: { organizationId: string; scopeId: string }): Promise<{ ownerUserId: string | null } | null> {
    const team = await this.database.team.findFirst({ where: { id: input.scopeId, organizationId: input.organizationId, isPersonal: true }, select: { ownerUserId: true } });
    if (team) return team;
    const project = await this.database.project.findFirst({ where: { id: input.scopeId, team: { organizationId: input.organizationId }, OR: [{ isPersonal: true }, { team: { isPersonal: true } }], archivedAt: null }, select: { team: { select: { ownerUserId: true } } } });
    return project?.team ?? null;
  }
}
