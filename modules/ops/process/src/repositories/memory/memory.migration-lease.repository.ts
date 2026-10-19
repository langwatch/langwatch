import type { MigrationLeaseRepository } from "@langwatch/system-migrations";
import { nowInstant } from "@langwatch/time";

/** The runner's named leases in one process's memory: a claim holds until released or expired. */
export class MemoryMigrationLeaseRepository implements MigrationLeaseRepository {
  readonly #expiresAt = new Map<string, number>();

  static create(): MemoryMigrationLeaseRepository {
    return new MemoryMigrationLeaseRepository();
  }

  private constructor() {}

  async acquire({ name, ttlMs }: { name: string; ttlMs: number }): Promise<boolean> {
    const now = nowInstant().epochMilliseconds;
    if ((this.#expiresAt.get(name) ?? 0) > now) return false;
    this.#expiresAt.set(name, now + ttlMs);
    return true;
  }

  async renew({ name, ttlMs }: { name: string; ttlMs: number }): Promise<boolean> {
    const now = nowInstant().epochMilliseconds;
    if ((this.#expiresAt.get(name) ?? 0) <= now) return false;
    this.#expiresAt.set(name, now + ttlMs);
    return true;
  }

  async release({ name }: { name: string }): Promise<void> {
    this.#expiresAt.delete(name);
  }
}
