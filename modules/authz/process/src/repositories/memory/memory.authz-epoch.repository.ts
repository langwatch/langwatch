import { AuthzEpochRepository } from "../authz-epoch.repository.ts";
import type { AuthzMemoryStore } from "./authz-memory.store.ts";

/** The epoch a process without Redis keeps, for as long as it runs. */
export class MemoryAuthzEpochRepository extends AuthzEpochRepository {
  static create(options: { memory: AuthzMemoryStore }): MemoryAuthzEpochRepository {
    return new MemoryAuthzEpochRepository(options.memory);
  }

  private constructor(private readonly memory: AuthzMemoryStore) {
    super();
  }

  async findEpoch({ organizationId }: { organizationId: string }): Promise<number | null> {
    return this.memory.epochs.get(organizationId) ?? null;
  }

  async bump({ organizationId }: { organizationId: string }): Promise<void> {
    this.memory.epochs.set(organizationId, (this.memory.epochs.get(organizationId) ?? 0) + 1);
  }
}
