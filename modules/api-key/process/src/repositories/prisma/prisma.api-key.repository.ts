import {
  CLI_LOGIN_KEY_NAME_PREFIX,
  HIDDEN_SYSTEM_KEY_NAMES,
  type ApiKeyRevocationCause,
} from "@langwatch/api-key-contract";
import { prismaTables, type PrismaModelClient } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { fromDate, nowInstant, toDate, type Instant } from "@langwatch/time";

import type {
  ApiKeyCreateRecord,
  ApiKeyRepository,
  ApiKeyRow,
  ApiKeyUpdateRecord,
} from "../api-key.repository.ts";

/** The key rows, plus the raw write the fenced revoke needs. */
export type PrismaApiKeyDatabase = PrismaModelClient<"ApiKey"> & Pick<PrismaClient, "$executeRaw">;

/** Prisma persistence is private to the API-key server package. */
export class PrismaApiKeyRepository implements ApiKeyRepository {
  /** Declared, not inherited: the model-scoped client carries no `$executeRaw`. */
  static readonly tables = prismaTables("ApiKey");

  static create({ prisma }: { prisma: PrismaApiKeyDatabase }): PrismaApiKeyRepository {
    return new PrismaApiKeyRepository(prisma);
  }

  private constructor(private readonly database: PrismaApiKeyDatabase) {}

  create(input: ApiKeyCreateRecord): Promise<ApiKeyRow> {
    const { roleBindings: _roleBindings, startsDisabled, expiresAt, ...data } = input;
    return this.database.apiKey.create({
      data: {
        ...data,
        expiresAt: expiresAt ? toDate(expiresAt) : null,
        ...(startsDisabled ? { revokedAt: new Date() } : {}),
      },
    });
  }
  activate(input: { id: string }): Promise<ApiKeyRow> {
    return this.database.apiKey.update({
      where: { id: input.id },
      data: { revokedAt: null },
    });
  }
  findByLookupId(input: { lookupId: string }): Promise<ApiKeyRow | null> {
    return this.database.apiKey.findFirst({
      where: {
        lookupId: input.lookupId,
        OR: [{ userId: null }, { user: { deactivatedAt: null } }],
      },
    });
  }
  findById(input: { id: string }): Promise<ApiKeyRow | null> {
    return this.database.apiKey.findFirst({
      where: { id: input.id },
    });
  }
  findByIdInOrganization(input: { id: string; organizationId: string }): Promise<ApiKeyRow | null> {
    return this.database.apiKey.findFirst({
      where: { id: input.id, organizationId: input.organizationId },
    });
  }
  listForUser(input: { organizationId: string; userId: string }): Promise<ApiKeyRow[]> {
    return this.database.apiKey.findMany({
      where: {
        organizationId: input.organizationId,
        revokedAt: null,
        name: { notIn: [...HIDDEN_SYSTEM_KEY_NAMES] },
        OR: [{ userId: input.userId }, { userId: null, ingestSourceType: null }],
      },
      orderBy: { createdAt: "desc" },
    });
  }
  listForOrganization(input: { organizationId: string }): Promise<ApiKeyRow[]> {
    return this.database.apiKey.findMany({
      where: {
        organizationId: input.organizationId,
        revokedAt: null,
        name: { notIn: [...HIDDEN_SYSTEM_KEY_NAMES] },
      },
      orderBy: { createdAt: "desc" },
    });
  }
  update(input: ApiKeyUpdateRecord): Promise<ApiKeyRow> {
    const { id, roleBindings: _roleBindings, revokedAt, lastUsedAt, ...data } = input;
    return this.database.apiKey.update({
      where: { id },
      data: {
        ...data,
        ...(revokedAt === void 0 ? {} : { revokedAt: revokedAt && toDate(revokedAt) }),
        ...(lastUsedAt === void 0 ? {} : { lastUsedAt: toDate(lastUsedAt) }),
      },
    });
  }
  /**
   * SQL, with the fence against the table: through `updateMany` it sits in a
   * subquery, and a revoke parked on the row lock re-checks only the id, so
   * the later cause would overwrite the first one.
   */
  async revoke(input: { id: string; cause: ApiKeyRevocationCause }): Promise<ApiKeyRow> {
    await this.database.$executeRaw`
      -- @tenancy: addressed by the key's own id, which the caller resolved inside its organization.
      UPDATE "ApiKey"
         SET "revokedAt" = now(),
             "revocationCause" = ${input.cause},
             "updatedAt" = now()
       WHERE "id" = ${input.id}
         AND "revokedAt" IS NULL
    `;
    return this.database.apiKey.findUniqueOrThrow({
      where: { id: input.id },
    });
  }
  async updateLastUsedAt(input: { id: string }): Promise<void> {
    await this.update({ id: input.id, lastUsedAt: nowInstant() });
  }
  async upgradeHash(input: { id: string; hashedSecret: string }): Promise<void> {
    await this.update({ id: input.id, hashedSecret: input.hashedSecret });
  }
  async findIngestKey(input: {
    organizationId: string;
    apiKeyIds: readonly string[];
    sourceType: string;
  }): Promise<ApiKeyRow | null> {
    if (input.apiKeyIds.length === 0) return null;
    return this.database.apiKey.findFirst({
      where: {
        organizationId: input.organizationId,
        id: { in: [...input.apiKeyIds] },
        ingestSourceType: input.sourceType,
        revokedAt: null,
      },
      orderBy: { createdAt: "desc" },
    });
  }
  async findIngestKeys(input: {
    organizationId: string;
    apiKeyIds: readonly string[];
  }): Promise<ApiKeyRow[]> {
    if (input.apiKeyIds.length === 0) return [];
    return this.database.apiKey.findMany({
      where: {
        organizationId: input.organizationId,
        id: { in: [...input.apiKeyIds] },
        ingestSourceType: { not: null },
        revokedAt: null,
      },
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
  async findLivenessById(input: {
    id: string;
  }): Promise<{ revokedAt: Instant | null; expiresAt: Instant | null } | null> {
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
