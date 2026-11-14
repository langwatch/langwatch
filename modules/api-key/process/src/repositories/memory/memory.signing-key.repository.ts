import { SigningKeyNotFoundError } from "@langwatch/api-key-contract";
import { type Instant, nowInstant } from "@langwatch/time";

import type {
  SigningKeyCreateRecord,
  SigningKeyCredential,
  SigningKeyRepository,
  SigningKeyRow,
} from "../signing-key.repository.ts";

type StoredSigningKey = SigningKeyRow & Readonly<{ secret: string }>;

function rowOf({ secret: _secret, ...row }: StoredSigningKey): SigningKeyRow {
  return row;
}

/** Signing keys held in memory, for a boot with no datastore and for tests; nothing rests. */
export class MemorySigningKeyRepository implements SigningKeyRepository {
  readonly #keys = new Map<string, StoredSigningKey>();

  static create(): MemorySigningKeyRepository {
    return new MemorySigningKeyRepository();
  }

  private constructor() {}

  #find(input: { organizationId: string; projectId: string; id: string }) {
    const key = this.#keys.get(input.id);
    return key?.organizationId === input.organizationId && key.projectId === input.projectId
      ? key
      : undefined;
  }

  async findByProject(input: {
    organizationId: string;
    projectId: string;
  }): Promise<SigningKeyRow[]> {
    return [...this.#keys.values()]
      .filter(
        (key) => key.organizationId === input.organizationId && key.projectId === input.projectId,
      )
      .toSorted((a, b) => b.createdAt.epochMilliseconds - a.createdAt.epochMilliseconds)
      .map(rowOf);
  }

  async getById(input: {
    organizationId: string;
    projectId: string;
    id: string;
  }): Promise<SigningKeyRow> {
    const key = this.#find(input);
    if (!key) throw new SigningKeyNotFoundError(input.id);
    return rowOf(key);
  }

  async create(input: SigningKeyCreateRecord): Promise<SigningKeyRow> {
    if ([...this.#keys.values()].some((key) => key.publicId === input.publicId)) {
      throw new Error("SigningKey.publicId must be unique");
    }
    const stored: StoredSigningKey = {
      ...input,
      createdAt: nowInstant(),
      rotatedAt: null,
      verifiesUntil: null,
      revokedAt: null,
      lastUsedAt: null,
    };
    this.#keys.set(stored.id, stored);
    return rowOf(stored);
  }

  async markRotated(input: {
    organizationId: string;
    projectId: string;
    id: string;
    rotatedAt: Instant;
    verifiesUntil: Instant;
  }): Promise<boolean> {
    const key = this.#find(input);
    if (!key || key.rotatedAt || key.revokedAt) return false;
    this.#keys.set(key.id, {
      ...key,
      rotatedAt: input.rotatedAt,
      verifiesUntil: input.verifiesUntil,
    });
    return true;
  }

  async revoke(input: {
    organizationId: string;
    projectId: string;
    id: string;
    revokedAt: Instant;
  }): Promise<void> {
    const key = this.#find(input);
    if (key) this.#keys.set(key.id, { ...key, revokedAt: key.revokedAt ?? input.revokedAt });
  }

  async findCredentials(input: {
    organizationId: string;
    publicId: string;
  }): Promise<SigningKeyCredential[]> {
    return [...this.#keys.values()]
      .filter(
        (key) => key.publicId === input.publicId && key.organizationId === input.organizationId,
      )
      .map(({ id, projectId, publicId, secret, verifiesUntil, revokedAt }) => ({
        id,
        projectId,
        publicId,
        secret,
        verifiesUntil,
        revokedAt,
      }));
  }

  async markUsed(input: {
    organizationId: string;
    ids: readonly string[];
    at: Instant;
  }): Promise<void> {
    for (const id of input.ids) {
      const key = this.#keys.get(id);
      if (key?.organizationId === input.organizationId) {
        this.#keys.set(id, { ...key, lastUsedAt: input.at });
      }
    }
  }
}
