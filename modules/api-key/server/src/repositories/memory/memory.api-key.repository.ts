import { generate } from "@langwatch/ksuid";
import { HIDDEN_SYSTEM_KEY_NAMES, type ApiKeyRevocationCause } from "@langwatch/api-key-contract";
import { nowInstant, toDate, type Instant } from "@langwatch/time";
import type {
  ApiKeyCreateRecord,
  ApiKeyRepository,
  ApiKeyUpdateRecord,
  StoredApiKey,
} from "../api-key.repository.ts";
import { MemoryApiKeyDatabase } from "./memory.api-key.database.ts";

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

  async create(input: ApiKeyCreateRecord): Promise<StoredApiKey> {
    const now = toDate(nowInstant());
    const { roleBindings: _roleBindings, startsDisabled, expiresAt, ...data } = input;
    const key: StoredApiKey = {
      ...data,
      createdByDeviceLabel: data.createdByDeviceLabel ?? null,
      id: generate(API_KEY_KSUID_RESOURCE).toString(),
      expiresAt: expiresAt ? toDate(expiresAt) : null,
      revokedAt: startsDisabled ? now : null,
      revocationCause: null,
      lastUsedAt: null,
      createdAt: now,
      updatedAt: now,
      // Bindings are written by the grants side, exactly as the Prisma create
      // discards them and reads back an empty include.
      roleBindings: [],
    };
    this.#database.replaceKey(key);

    return structuredClone(key);
  }

  async activate(input: { id: string }): Promise<StoredApiKey> {
    return this.#write(input.id, (key) => ({ ...key, revokedAt: null }));
  }

  async findByLookupId(input: { lookupId: string }): Promise<StoredApiKey | null> {
    return this.#find(
      (key) => key.lookupId === input.lookupId && !this.#database.isUserDeactivated(key.userId),
    );
  }

  async findById(input: { id: string }): Promise<StoredApiKey | null> {
    return this.#find((key) => key.id === input.id);
  }

  async findByIdInOrganization(input: {
    id: string;
    organizationId: string;
  }): Promise<StoredApiKey | null> {
    return this.#find((key) => key.id === input.id && key.organizationId === input.organizationId);
  }

  async listForUser(input: { organizationId: string; userId: string }): Promise<StoredApiKey[]> {
    return this.#list(
      (key) =>
        key.organizationId === input.organizationId &&
        key.revokedAt === null &&
        !HIDDEN_SYSTEM_KEY_NAMES.includes(key.name) &&
        (key.userId === input.userId || (key.userId === null && key.ingestSourceType === null)),
    );
  }

  async listForOrganization(input: { organizationId: string }): Promise<StoredApiKey[]> {
    return this.#list(
      (key) =>
        key.organizationId === input.organizationId &&
        key.revokedAt === null &&
        !HIDDEN_SYSTEM_KEY_NAMES.includes(key.name),
    );
  }

  async update(input: ApiKeyUpdateRecord): Promise<StoredApiKey> {
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
  async revoke(input: { id: string; cause: ApiKeyRevocationCause }): Promise<StoredApiKey> {
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
    projectId: string;
    sourceType: string;
  }): Promise<StoredApiKey | null> {
    const [newest] = this.#list(
      (key) =>
        key.organizationId === input.organizationId &&
        key.ingestSourceType === input.sourceType &&
        key.revokedAt === null &&
        this.#reachesProject(key, input.projectId),
    );

    return newest ?? null;
  }

  async findIngestKeysForProject(input: {
    organizationId: string;
    projectId: string;
  }): Promise<StoredApiKey[]> {
    return this.#list(
      (key) =>
        key.organizationId === input.organizationId &&
        key.ingestSourceType !== null &&
        key.revokedAt === null &&
        this.#reachesProject(key, input.projectId),
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

  #reachesProject(key: StoredApiKey, projectId: string): boolean {
    return key.roleBindings.some(
      (binding) => binding.scopeType === "PROJECT" && binding.scopeId === projectId,
    );
  }

  #find(matches: (key: StoredApiKey) => boolean): StoredApiKey | null {
    const key = this.#database.keys().find(matches);

    return key ? structuredClone(key) : null;
  }

  /** Newest first, as every Prisma list here orders by `createdAt desc`. */
  #list(matches: (key: StoredApiKey) => boolean): StoredApiKey[] {
    return this.#database
      .keys()
      .filter(matches)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .map((key) => structuredClone(key));
  }

  #write(id: string, change: (key: StoredApiKey) => StoredApiKey): StoredApiKey {
    const key = this.#database.keys().find((row) => row.id === id);
    if (!key) throw new Error(`No API key ${id}`);

    const written = change(key);
    this.#database.replaceKey(written);

    return structuredClone(written);
  }
}
