import { PrismaRepository, type PrismaRepositoryClient } from "@langwatch/prisma-client";
import { nowInstant, toDate, type Instant } from "@langwatch/time";
import { HIDDEN_SYSTEM_KEY_NAMES, type ApiKeyRevocationCause } from "@langwatch/api-key-contract";
import type {
  ApiKeyCreateRecord,
  ApiKeyRepository,
  ApiKeyUpdateRecord,
  StoredApiKey,
} from "../api-key.repository.ts";

export type PrismaApiKeyDatabase = PrismaRepositoryClient<["ApiKey"]>;

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
   * One bounded UPDATE over the (name, revokedAt, expiresAt) shape.
   *
   * `expiresAt: { not: null }` is carried explicitly rather than left to
   * `lte`: a key created without an expiry must never be swept, and a NULL
   * that a later Prisma or Postgres comparison treated as "before now" would
   * revoke every key of this name in the product at once.
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
}
