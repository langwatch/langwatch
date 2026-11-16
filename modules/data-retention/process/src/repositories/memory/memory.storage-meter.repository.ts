import type { StorageMeterRepository } from "../storage-meter.repository.ts";

/** The memory tier's event-log meter: bytes a test records per tenant, zero where none were. */
export class MemoryStorageMeterRepository implements StorageMeterRepository {
  static create(): MemoryStorageMeterRepository {
    return new MemoryStorageMeterRepository();
  }

  readonly #bytes = new Map<string, number>();

  private constructor() {}

  /** Records what the event log holds for a tenant, as an append to it would. */
  record(input: { tenantId: string; bytes: number }): void {
    this.#bytes.set(input.tenantId, input.bytes);
  }

  async getEventLogBytes({ tenantId }: { tenantId: string }): Promise<number> {
    return this.#bytes.get(tenantId) ?? 0;
  }
}
