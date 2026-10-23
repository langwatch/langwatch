import {
  type ProcessFleetReading,
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

  async save(readings: ProcessFleetReading[]): Promise<void> {
    this.store.processFleetReadings = readings;
  }

  async findAll(): Promise<ProcessFleetReading[]> {
    return this.store.processFleetReadings;
  }
}
