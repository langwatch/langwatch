import {
  CLI_LOGIN_KEY_NAME_PREFIX,
  HIDDEN_SYSTEM_KEY_NAMES,
  RESERVED_SYSTEM_KEY_NAMES,
  type ApiKeyRevocationCause,
} from "@langwatch/api-key-contract";
import { type PrismaModelClient, prismaTables, skipTenantCheck } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { fromDate, nowInstant, toDate, type Instant } from "@langwatch/time";

import type {
  ApiKeyCreateRecord,
  ApiKeyRepository,
  ApiKeyRow,
  ApiKeyUpdateRecord,
} from "../api-key.repository.ts";

/** The key rows, plus the raw SQL the fenced revoke and the fleet-wide sweeps need. */
type PrismaApiKeyDatabase = PrismaModelClient<"ApiKey"> &
  Pick<PrismaClient, "$executeRaw" | "$queryRaw">;

/** Prisma persistence is private to the API-key server package. */
export class PrismaApiKeyRepository implements ApiKeyRepository {
  /** Declared, not inherited: the model-scoped client carries no `$executeRaw`. */
  static readonly tables = prismaTables("ApiKey");

  static create({ prisma }: { prisma: PrismaApiKeyDatabase }): PrismaApiKeyRepository {
    return new PrismaApiKeyRepository(prisma);
  }

  private constructor(private readonly database: PrismaApiKeyDatabase) {}

  create(input: ApiKeyCreateRecord): Promise<ApiKeyRow> {
    const { grants: _grants, startsDisabled, expiresAt, ...data } = input;
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
  findForUser(input: { organizationId: string; userId: string }): Promise<ApiKeyRow[]> {
    return this.database.apiKey.findMany({
      where: {
        organizationId: input.organizationId,
        revokedAt: null,
        isSystemManaged: false,
        name: { notIn: [...HIDDEN_SYSTEM_KEY_NAMES] },
        OR: [{ userId: input.userId }, { userId: null, ingestSourceType: null }],
      },
      orderBy: { createdAt: "desc" },
    });
  }
  findForOrganization(input: { organizationId: string }): Promise<ApiKeyRow[]> {
    return this.database.apiKey.findMany({
      where: {
        organizationId: input.organizationId,
        revokedAt: null,
        isSystemManaged: false,
        name: { notIn: [...HIDDEN_SYSTEM_KEY_NAMES] },
      },
      orderBy: { createdAt: "desc" },
    });
  }
  update(input: ApiKeyUpdateRecord): Promise<ApiKeyRow> {
    const { id, grants: _grants, revokedAt, lastUsedAt, ...data } = input;
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
  async revoke(input: {
    id: string;
    organizationId: string;
    cause: ApiKeyRevocationCause;
  }): Promise<ApiKeyRow> {
    await this.database.$executeRaw`
      UPDATE "ApiKey"
         SET "revokedAt" = now(),
             "revocationCause" = ${input.cause},
             "updatedAt" = now()
       WHERE "id" = ${input.id}
         AND "organizationId" = ${input.organizationId}
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
  async findIngestKeysForUser(input: {
    organizationId: string;
    userId: string;
  }): Promise<ApiKeyRow[]> {
    return this.database.apiKey.findMany({
      where: {
        organizationId: input.organizationId,
        userId: input.userId,
        ingestSourceType: { not: null },
        revokedAt: null,
      },
      orderBy: { createdAt: "desc" },
    });
  }
  /**
   * The fleet-wide sweep, declared here rather than hatched in the tenancy guard: only a
   * reserved name, and a name a customer key could also carry needs `isSystemManaged`.
   * `"expiresAt" IS NOT NULL` is explicit: a NULL "before now" would revoke every key of the name.
   */
  async revokeExpiredByName(input: {
    name: string;
    now: Instant;
    systemManagedOnly?: boolean;
  }): Promise<number> {
    if (!RESERVED_SYSTEM_KEY_NAMES.includes(input.name)) {
      throw new Error(`The key sweep refuses "${input.name}", which is not a reserved name`);
    }
    const markedOnly =
      input.systemManagedOnly === true || !HIDDEN_SYSTEM_KEY_NAMES.includes(input.name);
    const now = toDate(input.now);
    return this.database.$executeRaw`
      ${skipTenantCheck({
        // Fleet-wide sweep of one reserved system key name, bounded to elapsed rows.
        SKIP_TENANT_CHECK: true,
      })}
      UPDATE "ApiKey"
         SET "revokedAt" = ${now},
             "updatedAt" = now()
       WHERE "name" = ${input.name}
         AND "revokedAt" IS NULL
         AND "expiresAt" IS NOT NULL
         AND "expiresAt" <= ${now}
         AND ("isSystemManaged" = true OR ${markedOnly} = false)
    `;
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
  async findElapsedLoginKeys(input: {
    organizationId: string;
    now: Instant;
  }): Promise<{ id: string; userId: string | null; organizationId: string }[]> {
    return this.database.apiKey.findMany({
      where: {
        organizationId: input.organizationId,
        name: { startsWith: CLI_LOGIN_KEY_NAME_PREFIX },
        revokedAt: null,
        expiresAt: { not: null, lte: toDate(input.now) },
      },
      select: { id: true, userId: true, organizationId: true },
    });
  }
  async sweepElapsedLoginKeys(input: {
    before: Instant;
  }): Promise<{ id: string; userId: string | null; organizationId: string }[]> {
    return this.database.$queryRaw<{ id: string; userId: string | null; organizationId: string }[]>`
      ${skipTenantCheck({
        // Fleet-wide sweep of CLI login keys; create refuses a customer key under the prefix.
        SKIP_TENANT_CHECK: true,
      })}
      SELECT "id", "userId", "organizationId"
        FROM "ApiKey"
       WHERE starts_with("name", ${CLI_LOGIN_KEY_NAME_PREFIX})
         AND "revokedAt" IS NULL
         AND "expiresAt" IS NOT NULL
         AND "expiresAt" <= ${toDate(input.before)}
    `;
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

  async findLiveLoginKeys(input: {
    organizationId: string;
  }): Promise<{ id: string; createdAt: Instant; expiresAt: Instant }[]> {
    const rows = await this.database.apiKey.findMany({
      where: {
        organizationId: input.organizationId,
        name: { startsWith: CLI_LOGIN_KEY_NAME_PREFIX },
        revokedAt: null,
        expiresAt: { not: null },
      },
      select: { id: true, createdAt: true, expiresAt: true },
    });
    return rows.flatMap(({ id, createdAt, expiresAt }) =>
      expiresAt ? [{ id, createdAt: fromDate(createdAt), expiresAt: fromDate(expiresAt) }] : [],
    );
  }
  async lowerLoginKeyExpiry(input: {
    id: string;
    organizationId: string;
    expiresAt: Instant;
  }): Promise<void> {
    await this.database.apiKey.updateMany({
      where: { id: input.id, organizationId: input.organizationId, revokedAt: null },
      data: { expiresAt: toDate(input.expiresAt) },
    });
  }
}
