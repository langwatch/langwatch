import type { SeatSharingCheck } from "@langwatch/ops-contract";

import { SeatSharingCheckRepository } from "../seat-sharing-check.repository.ts";
import type { MemoryOpsStore } from "./memory.ops.store.ts";

/** The held check in memory, replaced as the Redis key is. */
export class MemorySeatSharingCheckRepository extends SeatSharingCheckRepository {
  static create({ store }: { store: MemoryOpsStore }): MemorySeatSharingCheckRepository {
    return new MemorySeatSharingCheckRepository(store);
  }

  private constructor(private readonly store: MemoryOpsStore) {
    super();
  }

  async save(check: SeatSharingCheck): Promise<void> {
    this.store.seatSharingChecks.splice(0, this.store.seatSharingChecks.length, check);
  }

  async find(): Promise<SeatSharingCheck[]> {
    return [...this.store.seatSharingChecks];
  }
}
