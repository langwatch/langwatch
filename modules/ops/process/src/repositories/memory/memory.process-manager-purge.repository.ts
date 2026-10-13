import {
  ProcessManagerPurgeRepository,
  type ProcessManagerPurgeTarget,
} from "../process-manager-purge.repository.ts";

/** The memory process store keeps no outbox or inbox tables, so nothing is ever eligible. */
export class MemoryProcessManagerPurgeRepository extends ProcessManagerPurgeRepository {
  private constructor() {
    super();
  }

  static create(): MemoryProcessManagerPurgeRepository {
    return new MemoryProcessManagerPurgeRepository();
  }

  countEligible(_input: {
    target: ProcessManagerPurgeTarget;
    retentionDays: number;
  }): Promise<number> {
    return Promise.resolve(0);
  }

  deleteBatch(_input: {
    target: ProcessManagerPurgeTarget;
    retentionDays: number;
    batchSize: number;
  }): Promise<number> {
    return Promise.resolve(0);
  }

  vacuum(): Promise<void> {
    return Promise.resolve();
  }
}
