import type {
  StoredObjectDeliveryAudience,
  StoredObjectId,
  StoredObjectProjectId,
} from "@langwatch/stored-object-contract";
import { type Instant, Temporal } from "@langwatch/time";

import type {
  StoredObjectRecord,
  StoredObjectRecordPageQuery,
  StoredObjectRecordRepository,
} from "../stored-object-record.repository.ts";
import type { MemoryStoredObjectOwnerLinkRepository } from "./memory.stored-object-owner-link.repository.ts";

/**
 * The same answers as the Prisma repository, over one Map keyed by tenant and id. The
 * owner links answer the conditional delete, as the Prisma statement reads their table.
 */
export class MemoryStoredObjectRecordRepository implements StoredObjectRecordRepository {
  static create(
    values: readonly StoredObjectRecord[] = [],
    ownerLinks?: MemoryStoredObjectOwnerLinkRepository,
  ): MemoryStoredObjectRecordRepository {
    return new MemoryStoredObjectRecordRepository(values, ownerLinks);
  }

  readonly #values = new Map<string, StoredObjectRecord>();
  readonly #ownerLinks: MemoryStoredObjectOwnerLinkRepository | undefined;

  private constructor(
    values: readonly StoredObjectRecord[],
    ownerLinks: MemoryStoredObjectOwnerLinkRepository | undefined,
  ) {
    for (const value of values) this.#values.set(key(value), value);
    this.#ownerLinks = ownerLinks;
  }

  async findById(input: {
    tenantId: StoredObjectProjectId;
    id: StoredObjectId;
  }): Promise<StoredObjectRecord | null> {
    return this.#values.get(key(input)) ?? null;
  }

  async upsert(value: StoredObjectRecord): Promise<void> {
    this.#values.set(key(value), value);
  }

  async countActive(input: {
    tenantId: StoredObjectProjectId;
    purpose?: string;
  }): Promise<{ activeObjectCount: number; activeByteLength: number }> {
    const active = [...this.#values.values()].filter(
      (value) =>
        value.tenantId === input.tenantId &&
        value.status === "available" &&
        (!input.purpose || value.purpose === input.purpose),
    );

    return {
      activeObjectCount: active.length,
      activeByteLength: active.reduce((total, value) => total + value.byteLength, 0),
    };
  }

  async findPage(input: StoredObjectRecordPageQuery): Promise<StoredObjectRecord[]> {
    return [...this.#values.values()]
      .filter(
        (value) =>
          value.tenantId === input.tenantId &&
          (!input.afterId || value.id > input.afterId) &&
          (!input.status || value.status === input.status) &&
          (!input.purpose || value.purpose === input.purpose) &&
          (!input.expiresBefore ||
            (value.expiresAt !== null &&
              Temporal.Instant.compare(value.expiresAt, input.expiresBefore) <= 0)),
      )
      .toSorted((left, right) => left.id.localeCompare(right.id))
      .slice(0, input.limit);
  }

  async findReusable(input: {
    tenantId: StoredObjectProjectId;
    purpose: string;
    sha256: string;
    mediaType: string;
  }): Promise<StoredObjectRecord[]> {
    return [...this.#values.values()]
      .filter(
        (value) =>
          value.tenantId === input.tenantId &&
          value.status === "available" &&
          value.purpose === input.purpose &&
          value.sha256 === input.sha256 &&
          value.mediaType === input.mediaType,
      )
      .toSorted((left, right) => left.id.localeCompare(right.id));
  }

  async findPageByPurpose(input: {
    purpose: string;
    after?: Readonly<{ tenantId: StoredObjectProjectId; id: StoredObjectId }>;
    limit: number;
  }): Promise<StoredObjectRecord[]> {
    const { after } = input;
    return [...this.#values.values()]
      .filter(
        (value) =>
          value.purpose === input.purpose &&
          (!after ||
            value.tenantId > after.tenantId ||
            (value.tenantId === after.tenantId && value.id > after.id)),
      )
      .toSorted(
        (left, right) =>
          left.tenantId.localeCompare(right.tenantId) || left.id.localeCompare(right.id),
      )
      .slice(0, input.limit);
  }

  async delete(input: { tenantId: StoredObjectProjectId; id: StoredObjectId }): Promise<void> {
    this.#values.delete(key(input));
  }

  async markDeletedIfUnheld(input: {
    tenantId: StoredObjectProjectId;
    id: StoredObjectId;
    now: Instant;
  }): Promise<boolean> {
    if (!this.#ownerLinks) {
      throw new Error("the memory record repository was created without its owner links");
    }
    const value = this.#values.get(key(input));
    if (value?.status !== "available") return false;
    if (this.#ownerLinks.holds({ tenantId: input.tenantId, objectId: input.id, now: input.now })) {
      return false;
    }
    this.#values.set(key(input), {
      ...value,
      status: "deleted",
      generation: value.generation + 1,
      deletedAt: input.now,
      updatedAt: input.now,
    });

    return true;
  }

  async addAudience(input: {
    tenantId: StoredObjectProjectId;
    id: StoredObjectId;
    audience: StoredObjectDeliveryAudience;
    at: Instant;
  }): Promise<void> {
    const value = this.#values.get(key(input));
    if (value?.status !== "available" || value.audiences.includes(input.audience)) return;
    this.#values.set(key(input), {
      ...value,
      audiences: [...value.audiences, input.audience],
      updatedAt: input.at,
    });
  }
}

/**
 * The compound primary key, as one string. A JSON pair rather than a joined
 * pair: no tenant and id can spell another pair's key however either is
 * punctuated.
 */
function key(input: { tenantId: string; id: string }): string {
  return JSON.stringify([input.tenantId, input.id]);
}
