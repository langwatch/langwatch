import type { StoredObjectId, StoredObjectProjectId } from "@langwatch/stored-object-contract";
import { Temporal } from "@langwatch/time";
import type {
  StoredObjectRecord,
  StoredObjectRecordPageQuery,
  StoredObjectRecordRepository,
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
          (!input.expiresBefore ||
            (value.expiresAt !== null &&
              Temporal.Instant.compare(value.expiresAt, input.expiresBefore) <= 0)),
      )
      .sort((left, right) => left.id.localeCompare(right.id))
      .slice(0, input.limit);
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
