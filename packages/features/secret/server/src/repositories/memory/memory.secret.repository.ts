import { generate } from "@langwatch/ksuid";
import {
  SECRET_KSUID_RESOURCE,
  SecretDuplicateError,
  SecretNotFoundError,
  secretSchema,
  type Secret,
} from "@langwatch/secret-contract";
import { nowInstant, toDate } from "@langwatch/time";
import type {
  CreateStoredSecretInput,
  SecretIdentity,
  SecretProjectScope,
  SecretRepository,
  StoredSecretValue,
  UpdateStoredSecretInput,
} from "../secret.repository.ts";

type StoredRow = Readonly<{ secret: Secret; encryptedValue: string }>;

/**
 * The Prisma repository's observable behaviour over a map: name ordering, the
 * duplicate refusal on `(projectId, name)`, the not-found refusal on a write
 * addressing another project's row. Ciphertext sits beside metadata, never in it.
 */
export class MemorySecretRepository implements SecretRepository {
  #rows = new Map<string, StoredRow>();

  private constructor() {}

  static create(): MemorySecretRepository {
    return new MemorySecretRepository();
  }

  async findAll(input: SecretProjectScope): Promise<Secret[]> {
    return this.#ofProject(input.projectId)
      .map((row) => structuredClone(row.secret))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async findAllValues(input: SecretProjectScope): Promise<StoredSecretValue[]> {
    return this.#ofProject(input.projectId).map((row) => ({
      name: row.secret.name,
      encryptedValue: row.encryptedValue,
    }));
  }

  async findById(input: SecretIdentity): Promise<Secret | undefined> {
    const row = this.#rows.get(input.id);
    if (!row || row.secret.projectId !== input.projectId) return undefined;

    return structuredClone(row.secret);
  }

  async count(input: SecretProjectScope): Promise<number> {
    return this.#ofProject(input.projectId).length;
  }

  async create(input: CreateStoredSecretInput): Promise<Secret> {
    const taken = this.#ofProject(input.projectId).some((row) => row.secret.name === input.name);
    if (taken) throw new SecretDuplicateError(input.name);

    const now = toDate(nowInstant());
    const secret = secretSchema.parse({
      id: generate(SECRET_KSUID_RESOURCE).toString(),
      projectId: input.projectId,
      name: input.name,
      createdAt: now,
      updatedAt: now,
      createdBy: { name: null },
      updatedBy: { name: null },
    });

    this.#rows.set(secret.id, { secret, encryptedValue: input.encryptedValue });

    return structuredClone(secret);
  }

  async update(input: UpdateStoredSecretInput): Promise<Secret> {
    const row = this.#rows.get(input.id);
    if (!row || row.secret.projectId !== input.projectId) throw new SecretNotFoundError();

    const secret = secretSchema.parse({ ...row.secret, updatedAt: toDate(nowInstant()) });
    this.#rows.set(secret.id, { secret, encryptedValue: input.encryptedValue });

    return structuredClone(secret);
  }

  async delete(input: SecretIdentity): Promise<void> {
    const row = this.#rows.get(input.id);
    if (!row || row.secret.projectId !== input.projectId) throw new SecretNotFoundError();

    this.#rows.delete(input.id);
  }

  #ofProject(projectId: string): StoredRow[] {
    return [...this.#rows.values()].filter((row) => row.secret.projectId === projectId);
  }
}
