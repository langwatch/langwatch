import {
  CLI_LOGIN_KEY_NAME_PREFIX,
  HIDDEN_SYSTEM_KEY_NAMES,
  type ApiKeyRevocationCause,
} from "@langwatch/api-key-contract";
import { generate } from "@langwatch/ksuid";
import { fromDate, nowInstant, toDate, type Instant } from "@langwatch/time";

import type {
  ApiKeyCreateRecord,
  ApiKeyRepository,
  ApiKeyRow,
  ApiKeyUpdateRecord,
} from "../api-key.repository.ts";
import type { MemoryApiKeyDatabase } from "./memory.api-key.database.ts";

const API_KEY_KSUID_RESOURCE = "apikey";

/** The same observable behaviour as the Prisma repository, over arrays. */
export class MemoryApiKeyRepository implements ApiKeyRepository {
  #database: MemoryApiKeyDatabase;

  private constructor(database: MemoryApiKeyDatabase) {
    this.#database = database;
  }

  static create(input: Readonly<{ memory: MemoryApiKeyDatabase }>): MemoryApiKeyRepository {
    return new MemoryApiKeyRepository(input.memory);
  }

  async create(input: ApiKeyCreateRecord): Promise<ApiKeyRow> {
    const now = toDate(nowInstant());
    const { roleBindings: _roleBindings, startsDisabled, expiresAt, ...data } = input;
    const key: ApiKeyRow = {
      ...data,
      createdByDeviceLabel: data.createdByDeviceLabel ?? null,
      parentApiKeyId: data.parentApiKeyId ?? null,
      id: generate(API_KEY_KSUID_RESOURCE).toString(),
      expiresAt: expiresAt ? toDate(expiresAt) : null,
      revokedAt: startsDisabled ? now : null,
      revocationCause: null,
      lastUsedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.#database.replaceKey(key);

    return structuredClone(key);
  }

  async activate(input: { id: string }): Promise<ApiKeyRow> {
    return this.#write(input.id, (key) => ({ ...key, revokedAt: null }));
  }

  async findByLookupId(input: { lookupId: string }): Promise<ApiKeyRow | null> {
    return this.#find(
      (key) => key.lookupId === input.lookupId && !this.#database.isUserDeactivated(key.userId),
    );
  }

  async findById(input: { id: string }): Promise<ApiKeyRow | null> {
    return this.#find((key) => key.id === input.id);
  }

  async findByIdInOrganization(input: {
    id: string;
    organizationId: string;
  }): Promise<ApiKeyRow | null> {
    return this.#find((key) => key.id === input.id && key.organizationId === input.organizationId);
  }

  async findForUser(input: { organizationId: string; userId: string }): Promise<ApiKeyRow[]> {
    return this.#list(
      (key) =>
        key.organizationId === input.organizationId &&
        key.revokedAt === null &&
        !HIDDEN_SYSTEM_KEY_NAMES.includes(key.name) &&
        (key.userId === input.userId || (key.userId === null && key.ingestSourceType === null)),
    );
  }

  async findForOrganization(input: { organizationId: string }): Promise<ApiKeyRow[]> {
    return this.#list(
      (key) =>
        key.organizationId === input.organizationId &&
        key.revokedAt === null &&
        !HIDDEN_SYSTEM_KEY_NAMES.includes(key.name),
    );
  }

  async update(input: ApiKeyUpdateRecord): Promise<ApiKeyRow> {
    const { id, roleBindings: _roleBindings, revokedAt, lastUsedAt, ...data } = input;

    return this.#write(id, (key) => ({
      ...key,
      ...data,
      ...(revokedAt === void 0 ? {} : { revokedAt: revokedAt && toDate(revokedAt) }),
      ...(lastUsedAt === void 0 ? {} : { lastUsedAt: toDate(lastUsedAt) }),
      updatedAt: toDate(nowInstant()),
    }));
  }

  /** The cause of the FIRST revocation stands, as the fenced `updateMany` keeps it. */
  async revoke(input: { id: string; cause: ApiKeyRevocationCause }): Promise<ApiKeyRow> {
    return this.#write(input.id, (key) =>
      key.revokedAt === null
        ? { ...key, revokedAt: toDate(nowInstant()), revocationCause: input.cause }
        : key,
    );
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
    const [newest] = this.#list(
      (key) =>
        key.organizationId === input.organizationId &&
        key.ingestSourceType === input.sourceType &&
        key.revokedAt === null &&
        input.apiKeyIds.includes(key.id),
    );

    return newest ?? null;
  }

  async findIngestKeys(input: {
    organizationId: string;
    apiKeyIds: readonly string[];
  }): Promise<ApiKeyRow[]> {
    return this.#list(
      (key) =>
        key.organizationId === input.organizationId &&
        key.ingestSourceType !== null &&
        key.revokedAt === null &&
        input.apiKeyIds.includes(key.id),
    );
  }

  async findIngestKeysForUser(input: {
    organizationId: string;
    userId: string;
  }): Promise<ApiKeyRow[]> {
    return this.#list(
      (key) =>
        key.organizationId === input.organizationId &&
        key.userId === input.userId &&
        key.ingestSourceType !== null &&
        key.revokedAt === null,
    );
  }

  async revokeExpiredByName(input: { name: string; now: Instant }): Promise<number> {
    const now = toDate(input.now);
    const elapsed = this.#database
      .keys()
      .filter(
        (key) =>
          key.name === input.name &&
          key.revokedAt === null &&
          key.expiresAt !== null &&
          key.expiresAt.getTime() <= now.getTime(),
      );

    for (const key of elapsed) this.#database.replaceKey({ ...key, revokedAt: now });

    return elapsed.length;
  }

  async findLiveChildren(input: {
    parentApiKeyId: string;
    organizationId: string;
  }): Promise<{ id: string }[]> {
    return this.#list(
      (key) =>
        key.organizationId === input.organizationId &&
        key.parentApiKeyId === input.parentApiKeyId &&
        key.revokedAt === null,
    ).map((key) => ({ id: key.id }));
  }

  async findLivenessById(input: {
    id: string;
  }): Promise<{ revokedAt: Instant | null; expiresAt: Instant | null } | null> {
    const key = this.#database.keys().find((row) => row.id === input.id);
    if (!key) return null;
    return {
      revokedAt: key.revokedAt ? fromDate(key.revokedAt) : null,
      expiresAt: key.expiresAt ? fromDate(key.expiresAt) : null,
    };
  }

  async findElapsedLoginKeys(input: {
    now: Instant;
    organizationId?: string;
  }): Promise<{ id: string; userId: string | null; organizationId: string }[]> {
    const now = toDate(input.now);
    return this.#list(
      (key) =>
        (!input.organizationId || key.organizationId === input.organizationId) &&
        key.name.startsWith(CLI_LOGIN_KEY_NAME_PREFIX) &&
        key.revokedAt === null &&
        key.expiresAt !== null &&
        key.expiresAt.getTime() <= now.getTime(),
    ).map((key) => ({ id: key.id, userId: key.userId, organizationId: key.organizationId }));
  }

  async extendLoginKeyExpiry(input: {
    id: string;
    organizationId: string;
    userId: string;
    expiresAt: Instant;
  }): Promise<void> {
    const key = this.#database.keys().find((row) => row.id === input.id);
    if (!key) return;
    const ownedByCaller =
      key.organizationId === input.organizationId && key.userId === input.userId;
    if (!ownedByCaller) return;
    if (!key.name.startsWith(CLI_LOGIN_KEY_NAME_PREFIX) || key.revokedAt !== null) return;
    this.#database.replaceKey({ ...key, expiresAt: toDate(input.expiresAt) });
  }

  async findLiveLoginKeys(input: {
    organizationId: string;
  }): Promise<{ id: string; createdAt: Instant; expiresAt: Instant }[]> {
    return this.#list(
      (key) =>
        key.organizationId === input.organizationId &&
        key.name.startsWith(CLI_LOGIN_KEY_NAME_PREFIX) &&
        key.revokedAt === null,
    ).flatMap(({ id, createdAt, expiresAt }) =>
      expiresAt ? [{ id, createdAt: fromDate(createdAt), expiresAt: fromDate(expiresAt) }] : [],
    );
  }

  async lowerLoginKeyExpiry(input: {
    id: string;
    organizationId: string;
    expiresAt: Instant;
  }): Promise<void> {
    const key = this.#database.keys().find((row) => row.id === input.id);
    if (!key || key.organizationId !== input.organizationId || key.revokedAt !== null) return;
    this.#database.replaceKey({ ...key, expiresAt: toDate(input.expiresAt) });
  }

  #find(matches: (key: ApiKeyRow) => boolean): ApiKeyRow | null {
    const key = this.#database.keys().find(matches);

    return key ? structuredClone(key) : null;
  }

  /** Newest first, as every Prisma list here orders by `createdAt desc`. */
  #list(matches: (key: ApiKeyRow) => boolean): ApiKeyRow[] {
    return this.#database
      .keys()
      .filter(matches)
      .toSorted((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .map((key) => structuredClone(key));
  }

  #write(id: string, change: (key: ApiKeyRow) => ApiKeyRow): ApiKeyRow {
    const key = this.#database.keys().find((row) => row.id === id);
    if (!key) throw new Error(`No API key ${id}`);

    const written = change(key);
    this.#database.replaceKey(written);

    return structuredClone(written);
  }
}
