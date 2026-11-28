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
  StoredObjectRecordStatus,
} from "../stored-object-record.repository.ts";
import { MemoryStoredObjectOwnerLinkRepository } from "./memory.stored-object-owner-link.repository.ts";

/**
 * The same answers as the Prisma repository, over one Map keyed by tenant and id. The
 * owner links answer the conditional delete, as the Prisma statement reads their table; with
 * none given, no link holds any object.
 */
export class MemoryStoredObjectRecordRepository implements StoredObjectRecordRepository {
  static create(
    values: readonly StoredObjectRecord[] = [],
    ownerLinks: MemoryStoredObjectOwnerLinkRepository = MemoryStoredObjectOwnerLinkRepository.create(),
  ): MemoryStoredObjectRecordRepository {
    return new MemoryStoredObjectRecordRepository(values, ownerLinks);
  }

  readonly #values = new Map<string, StoredObjectRecord>();
  readonly #ownerLinks: MemoryStoredObjectOwnerLinkRepository;

  private constructor(
    values: readonly StoredObjectRecord[],
    ownerLinks: MemoryStoredObjectOwnerLinkRepository,
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

  async insert(value: StoredObjectRecord): Promise<boolean> {
    if (this.#values.has(key(value))) return false;
    this.#values.set(key(value), value);
    return true;
  }

  async transition(input: {
    expected: Pick<StoredObjectRecord, "status" | "generation">;
    next: StoredObjectRecord;
  }): Promise<boolean> {
    const current = this.#values.get(key(input.next));
    const isCurrent =
      current?.status === input.expected.status && current.generation === input.expected.generation;
    if (isCurrent) this.#values.set(key(input.next), input.next);

    return isCurrent;
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
          statusMatches(value.status, input.status) &&
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
    limit: number;
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
      .toSorted((left, right) => left.id.localeCompare(right.id))
      .slice(0, input.limit);
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

  async findTenantsWithExpiredUploads(input: {
    expiresBefore: Instant;
    afterTenantId?: StoredObjectProjectId;
    limit: number;
  }): Promise<StoredObjectProjectId[]> {
    const { afterTenantId } = input;
    const tenants = new Set(
      [...this.#values.values()]
        .filter(
          (value) =>
            isReapable(value) &&
            value.expiresAt !== null &&
            Temporal.Instant.compare(value.expiresAt, input.expiresBefore) <= 0 &&
            (afterTenantId === undefined || value.tenantId > afterTenantId),
        )
        .map((value) => value.tenantId),
    );

    return [...tenants].toSorted().slice(0, input.limit);
  }

  async delete(input: { tenantId: StoredObjectProjectId; id: StoredObjectId }): Promise<void> {
    this.#values.delete(key(input));
  }

  async markDeletedIfUnheld(input: {
    tenantId: StoredObjectProjectId;
    id: StoredObjectId;
    now: Instant;
  }): Promise<boolean> {
    const value = this.#values.get(key(input));
    if (value?.status !== "available") return false;
    if (
      MemoryStoredObjectOwnerLinkRepository.holds(this.#ownerLinks, {
        tenantId: input.tenantId,
        objectId: input.id,
        now: input.now,
      })
    ) {
      return false;
    }
    this.#values.set(key(input), {
      ...value,
      status: "deleted",
      generation: value.generation + 1,
      deletedAt: input.now,
      expiresAt: input.now,
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

/** An open upload, or a closed row whose bytes are still held. */
function isReapable(value: StoredObjectRecord): boolean {
  if (value.status === "pending" || value.status === "uploading") return true;
  return (value.status === "failed" || value.status === "deleted") && value.storage !== null;
}

function statusMatches(
  status: StoredObjectRecordStatus,
  wanted: StoredObjectRecordPageQuery["status"],
): boolean {
  if (wanted === undefined) return true;
  return typeof wanted === "string" ? status === wanted : wanted.includes(status);
}

/**
 * The compound primary key, as one string. A JSON pair rather than a joined
 * pair: no tenant and id can spell another pair's key however either is
 * punctuated.
 */
function key(input: { tenantId: string; id: string }): string {
  return JSON.stringify([input.tenantId, input.id]);
}
