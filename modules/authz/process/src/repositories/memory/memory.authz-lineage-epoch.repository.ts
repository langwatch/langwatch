import { AuthzLineageEpochRepository } from "../authz-lineage-epoch.repository.ts";
import type { AuthzMemoryStore } from "./authz-memory.store.ts";

/** The lineage signal a process without Redis keeps, for as long as it runs. */
export class MemoryAuthzLineageEpochRepository extends AuthzLineageEpochRepository {
  static create(options: { memory: AuthzMemoryStore }): MemoryAuthzLineageEpochRepository {
    return new MemoryAuthzLineageEpochRepository(options.memory);
  }

  private constructor(private readonly memory: AuthzMemoryStore) {
    super();
  }

  async findEpoch({ organizationId }: { organizationId: string }): Promise<number | null> {
    return this.memory.lineageEpochs.get(organizationId) ?? 0;
  }

  async bump({ organizationId }: { organizationId: string }): Promise<void> {
    this.memory.lineageEpochs.set(
      organizationId,
      (this.memory.lineageEpochs.get(organizationId) ?? 0) + 1,
    );
  }
}
