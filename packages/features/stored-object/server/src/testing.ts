import type {
  StoredObjectId,
  StoredObjectLifecycleStatus,
  StoredObjectProjectId,
} from "@langwatch/stored-object-contract";
import {
  StoredObjectStore,
  type StoredObjectRecord,
} from "./stores/stored-object.store";

export class InMemoryStoredObjectStore extends StoredObjectStore {
  static create(
    values: readonly StoredObjectRecord[] = [],
  ): InMemoryStoredObjectStore {
    return new InMemoryStoredObjectStore(values);
  }

  private readonly values = new Map<string, StoredObjectRecord>();

  private constructor(values: readonly StoredObjectRecord[]) {
    super();
    for (const value of values) this.values.set(this.key(value), value);
  }

  async tryFind(input: {
    tenantId: StoredObjectProjectId;
    id: StoredObjectId;
  }): Promise<StoredObjectRecord | null> {
    return this.values.get(this.key(input)) ?? null;
  }

  async save(value: StoredObjectRecord): Promise<void> {
    this.values.set(this.key(value), value);
  }

  async getUsage(input: { tenantId: StoredObjectProjectId; purpose?: string }) {
    const active = [...this.values.values()].filter(
      (value) =>
        value.tenantId === input.tenantId &&
        value.status === "available" &&
        (!input.purpose || value.purpose === input.purpose),
    );
    return {
      activeObjectCount: active.length,
      activeByteLength: active.reduce(
        (total, value) => total + value.byteLength,
        0,
      ),
    };
  }

  async findPage(input: {
    tenantId: StoredObjectProjectId;
    afterId?: StoredObjectId;
    status?: StoredObjectLifecycleStatus;
    expiresBefore?: Date;
    limit: number;
  }): Promise<StoredObjectRecord[]> {
    return [...this.values.values()]
      .filter(
        (value) =>
          value.tenantId === input.tenantId &&
          (!input.afterId || value.id > input.afterId) &&
          (!input.status || value.status === input.status) &&
          (!input.expiresBefore ||
            (value.expiresAt !== null &&
              value.expiresAt <= input.expiresBefore)),
      )
      .sort((left, right) => left.id.localeCompare(right.id))
      .slice(0, input.limit);
  }

  private key(input: { tenantId: string; id: string }): string {
    return `${input.tenantId}\u0000${input.id}`;
  }
}
