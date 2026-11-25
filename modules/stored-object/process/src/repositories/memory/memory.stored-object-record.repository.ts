import type { StoredObjectId, StoredObjectProjectId } from "@langwatch/stored-object-contract";
import { type Instant, Temporal } from "@langwatch/time";

import type {
  StoredObjectRecord,
  StoredObjectRecordPageQuery,
  StoredObjectRecordRepository,
  StoredObjectRecordStatus,
} from "../stored-object-record.repository.ts";

/** The same answers as the Prisma repository, over one Map keyed by tenant and id. */
export class MemoryStoredObjectRecordRepository implements StoredObjectRecordRepository {
  static create(values: readonly StoredObjectRecord[] = []): MemoryStoredObjectRecordRepository {
    return new MemoryStoredObjectRecordRepository(values);
  }

  readonly #values = new Map<string, StoredObjectRecord>();

  private constructor(values: readonly StoredObjectRecord[]) {
    for (const value of values) this.#values.set(key(value), value);
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
          (!input.expiresBefore ||
            (value.expiresAt !== null &&
              Temporal.Instant.compare(value.expiresAt, input.expiresBefore) <= 0)),
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
