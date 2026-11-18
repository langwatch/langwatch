import type { StorageMeterRepository } from "../storage-meter.repository.ts";

/** The memory tier's event-log meter: bytes a test records per tenant, zero where none were. */
export class MemoryStorageMeterRepository implements StorageMeterRepository {
  static create(): MemoryStorageMeterRepository {
    return new MemoryStorageMeterRepository();
  }

  readonly #bytes = new Map<string, number>();
  readonly #dated: { tenantId: string; bytes: number; atMs: number }[] = [];

  private constructor() {}

  /** Records what the event log holds for a tenant, as an append to it would. */
  record(input: { tenantId: string; bytes: number }): void {
    this.#bytes.set(input.tenantId, input.bytes);
  }

  /** Records bytes a tenant's events occupy from one time, for reads before a cutoff. */
  recordAt(input: { tenantId: string; bytes: number; atMs: number }): void {
    this.#dated.push({ ...input });
  }

  /** Undated bytes count only without a cutoff; dated ones count when older than it. */
  async getEventLogBytes({
    tenantId,
    beforeMs,
  }: {
    tenantId: string;
    beforeMs?: number | undefined;
  }): Promise<number> {
    const dated = this.#dated
      .filter((row) => row.tenantId === tenantId)
      .filter((row) => beforeMs === undefined || row.atMs < beforeMs)
      .reduce((sum, row) => sum + row.bytes, 0);
    return beforeMs === undefined ? (this.#bytes.get(tenantId) ?? 0) + dated : dated;
  }
}
