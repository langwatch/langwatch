import { PrismaRepository, type PrismaModelClient } from "@langwatch/prisma-client";
import { fromDate, nowInstant, toDate, type Instant } from "@langwatch/time";
import {
  CLI_LOGIN_KEY_NAME_PREFIX,
  HIDDEN_SYSTEM_KEY_NAMES,
  type ApiKeyRevocationCause,
} from "@langwatch/api-key-contract";
import type {
  ApiKeyCreateRecord,
  ApiKeyRepository,
  ApiKeyUpdateRecord,
  StoredApiKey,
} from "../api-key.repository.ts";

export type PrismaApiKeyDatabase = PrismaModelClient<"ApiKey">;

/** Prisma persistence is private to the API-key server package. */
export class PrismaApiKeyRepository
  extends PrismaRepository.for("ApiKey")
  implements ApiKeyRepository
{
  static readonly create = this.factory((prisma) => new PrismaApiKeyRepository(prisma));

  private get database(): PrismaApiKeyDatabase {
    return this.prisma;
  }

  create(input: ApiKeyCreateRecord): Promise<StoredApiKey> {
    const { roleBindings: _roleBindings, startsDisabled, expiresAt, ...data } = input;
    return this.database.apiKey.create({
      data: {
        ...data,
        expiresAt: expiresAt ? toDate(expiresAt) : null,
        ...(startsDisabled ? { revokedAt: new Date() } : {}),
      },
      include: { roleBindings: true },
    });
  }
  activate(input: { id: string }): Promise<StoredApiKey> {
    return this.database.apiKey.update({
      where: { id: input.id },
      data: { revokedAt: null },
      include: { roleBindings: true },
    });
  }
  findByLookupId(input: { lookupId: string }): Promise<StoredApiKey | null> {
    return this.database.apiKey.findFirst({
      where: {
        lookupId: input.lookupId,
        OR: [{ userId: null }, { user: { deactivatedAt: null } }],
      },
      include: { roleBindings: true },
    });
  }
  findById(input: { id: string }): Promise<StoredApiKey | null> {
    return this.database.apiKey.findFirst({
      where: { id: input.id },
      include: { roleBindings: true },
    });
  }
  findByIdInOrganization(input: {
    id: string;
    organizationId: string;
  }): Promise<StoredApiKey | null> {
    return this.database.apiKey.findFirst({
      where: { id: input.id, organizationId: input.organizationId },
      include: { roleBindings: true },
    });
  }
  listForUser(input: { organizationId: string; userId: string }): Promise<StoredApiKey[]> {
    return this.database.apiKey.findMany({
      where: {
        organizationId: input.organizationId,
        revokedAt: null,
        name: { notIn: [...HIDDEN_SYSTEM_KEY_NAMES] },
        OR: [{ userId: input.userId }, { userId: null, ingestSourceType: null }],
      },
      include: { roleBindings: true },
      orderBy: { createdAt: "desc" },
    });
  }
  listForOrganization(input: { organizationId: string }): Promise<StoredApiKey[]> {
    return this.database.apiKey.findMany({
      where: {
        organizationId: input.organizationId,
        revokedAt: null,
        name: { notIn: [...HIDDEN_SYSTEM_KEY_NAMES] },
      },
      include: { roleBindings: true },
      orderBy: { createdAt: "desc" },
    });
  }
  update(input: ApiKeyUpdateRecord): Promise<StoredApiKey> {
    const { id, roleBindings: _roleBindings, revokedAt, lastUsedAt, ...data } = input;
    return this.database.apiKey.update({
      where: { id },
      data: {
        ...data,
        ...(revokedAt === void 0 ? {} : { revokedAt: revokedAt && toDate(revokedAt) }),
        ...(lastUsedAt === void 0 ? {} : { lastUsedAt: toDate(lastUsedAt) }),
      },
      include: { roleBindings: true },
    });
  }
  async revoke(input: { id: string; cause: ApiKeyRevocationCause }): Promise<StoredApiKey> {
    // `updateMany` fenced on a live row, so a key already revoked keeps the
    // cause the first revocation recorded. Losing the race still returns a
    // dead key, which is all the caller needs.
    await this.database.apiKey.updateMany({
      where: { id: input.id, revokedAt: null },
      data: { revokedAt: new Date(), revocationCause: input.cause },
    });
    return this.database.apiKey.findUniqueOrThrow({
      where: { id: input.id },
      include: { roleBindings: true },
    });
  }
  async updateLastUsedAt(input: { id: string }): Promise<void> {
    await this.update({ id: input.id, lastUsedAt: nowInstant() });
  }
  async upgradeHash(input: { id: string; hashedSecret: string }): Promise<void> {
    await this.update({ id: input.id, hashedSecret: input.hashedSecret });
  }
  findIngestKey(input: {
    organizationId: string;
    projectId: string;
    sourceType: string;
  }): Promise<StoredApiKey | null> {
    return this.database.apiKey.findFirst({
      where: {
        organizationId: input.organizationId,
        ingestSourceType: input.sourceType,
        revokedAt: null,
        roleBindings: { some: { scopeType: "PROJECT", scopeId: input.projectId } },
      },
      include: { roleBindings: true },
      orderBy: { createdAt: "desc" },
    });
  }
  findIngestKeysForProject(input: {
    organizationId: string;
    projectId: string;
  }): Promise<StoredApiKey[]> {
    return this.database.apiKey.findMany({
      where: {
        organizationId: input.organizationId,
        ingestSourceType: { not: null },
        revokedAt: null,
        roleBindings: { some: { scopeType: "PROJECT", scopeId: input.projectId } },
      },
      include: { roleBindings: true },
      orderBy: { createdAt: "desc" },
    });
  }
  /**
   * One bounded UPDATE over (name, revokedAt, expiresAt). `expiresAt: {
   * not: null }` is explicit, not left to `lte`: a NULL treated as "before
   * now" would revoke every key of this name in the product at once.
   */
  async revokeExpiredByName(input: { name: string; now: Instant }): Promise<number> {
    const now = toDate(input.now);
    const { count } = await this.database.apiKey.updateMany({
      where: {
        name: input.name,
        revokedAt: null,
        expiresAt: { not: null, lte: now },
      },
      data: { revokedAt: now },
    });
    return count;
  }
  findLiveChildren(input: {
    parentApiKeyId: string;
    organizationId: string;
  }): Promise<{ id: string }[]> {
    return this.database.apiKey.findMany({
      where: {
        organizationId: input.organizationId,
        parentApiKeyId: input.parentApiKeyId,
        revokedAt: null,
      },
      select: { id: true },
    });
  }
  async findLivenessById(
    input: { id: string },
  ): Promise<{ revokedAt: Instant | null; expiresAt: Instant | null } | null> {
    const row = await this.database.apiKey.findUnique({
      where: { id: input.id },
      select: { revokedAt: true, expiresAt: true },
    });
    if (!row) return null;
    return {
      revokedAt: row.revokedAt ? fromDate(row.revokedAt) : null,
      expiresAt: row.expiresAt ? fromDate(row.expiresAt) : null,
    };
  }
  findElapsedLoginKeys(input: {
    now: Instant;
  }): Promise<{ id: string; userId: string | null; organizationId: string }[]> {
    return this.database.apiKey.findMany({
      where: {
        name: { startsWith: CLI_LOGIN_KEY_NAME_PREFIX },
        revokedAt: null,
        expiresAt: { not: null, lte: toDate(input.now) },
      },
      select: { id: true, userId: true, organizationId: true },
    });
  }
  async extendLoginKeyExpiry(input: {
    id: string;
    organizationId: string;
    userId: string;
    expiresAt: Instant;
  }): Promise<void> {
    await this.database.apiKey.updateMany({
      where: {
        id: input.id,
        organizationId: input.organizationId,
        userId: input.userId,
        name: { startsWith: CLI_LOGIN_KEY_NAME_PREFIX },
        revokedAt: null,
      },
      data: { expiresAt: toDate(input.expiresAt) },
    });
  }
}
