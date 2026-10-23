import {
  type ProcessFleetSnapshot,
  ProcessFleetReadingsRepository,
} from "../process-fleet-readings.repository.ts";
import type { MemoryOpsStore } from "./memory.ops.store.ts";

/** The shared fleet readings in memory. */
export class MemoryProcessFleetReadingsRepository extends ProcessFleetReadingsRepository {
  static create({ store }: { store: MemoryOpsStore }): MemoryProcessFleetReadingsRepository {
    return new MemoryProcessFleetReadingsRepository(store);
  }

  private constructor(private readonly store: MemoryOpsStore) {
    super();
  }

  async save(snapshot: ProcessFleetSnapshot): Promise<void> {
    this.store.processFleetSnapshots.splice(0, this.store.processFleetSnapshots.length, snapshot);
  }

  async find(): Promise<ProcessFleetSnapshot | null> {
    return this.store.processFleetSnapshots[0] ?? null;
  }
}
