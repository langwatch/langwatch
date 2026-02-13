import type { createLogger } from "~/utils/logger/server";
import type { TenantId } from "../../../library/domain/tenantId";
import type {
  CheckpointRecord,
  CheckpointRepository,
} from "./checkpointRepository.types";

/**
 * In-memory implementation of CheckpointRepository.
 * Stores checkpoints in a Map keyed by CheckpointKey (tenantId:pipelineName:processorName:aggregateType:aggregateId).
 *
 * **WARNING: NOT THREAD-SAFE**
 * This implementation is NOT safe for concurrent access.
 */
export class CheckpointRepositoryMemory implements CheckpointRepository {
  // Key: CheckpointKey from record (tenantId:pipelineName:processorName:aggregateType:aggregateId)
  private readonly checkpoints = new Map<string, CheckpointRecord>();
  private readonly logger?: ReturnType<typeof createLogger>;

  constructor(logger?: ReturnType<typeof createLogger>) {
    this.logger = logger;
  }

  async getCheckpointRecord(
    checkpointKey: string,
    _tenantId: TenantId,
  ): Promise<CheckpointRecord | null> {
    const record = this.checkpoints.get(checkpointKey);
    if (!record) {
      return null;
    }
    // Return a copy to prevent mutation
    return { ...record };
  }

  async getLastProcessedCheckpointRecord(
    checkpointKey: string,
    _tenantId: TenantId,
  ): Promise<CheckpointRecord | null> {
    const record = this.checkpoints.get(checkpointKey);
    if (!record || record.Status !== "processed") {
      return null;
    }

    // Return a copy to prevent mutation
    return { ...record };
  }

  async getCheckpointRecordBySequenceNumber(
    checkpointKey: string,
    sequenceNumber: number,
    _tenantId: TenantId,
  ): Promise<CheckpointRecord | null> {
    const record = this.checkpoints.get(checkpointKey);

    this.logger?.debug(
      {
        checkpointKey,
        requestedSequenceNumber: sequenceNumber,
        recordExists: !!record,
        recordSequence: record?.SequenceNumber ?? null,
        recordStatus: record?.Status ?? null,
      },
      "getCheckpointRecordBySequenceNumber",
    );

    if (!record || record.SequenceNumber < sequenceNumber) {
      this.logger?.debug(
        {
          checkpointKey,
          requestedSequenceNumber: sequenceNumber,
          recordSequence: record?.SequenceNumber ?? null,
        },
        "No record or sequence too low",
      );
      return null;
    }

    // Accept if processed, or if pending with exact sequence match
    // With queue-level ordering (GroupQueue), if the previous event is "pending" with the exact
    // previous sequence, it means it's currently being processed (or just finished). Since GroupQueue
    // serializes processing per aggregate, the previous event must have finished.
    if (
      record.Status === "processed" ||
      (record.Status === "pending" && record.SequenceNumber === sequenceNumber)
    ) {
      this.logger?.debug(
        {
          checkpointKey,
          sequenceNumber,
          recordSequence: record.SequenceNumber,
          recordStatus: record.Status,
        },
        "Returning checkpoint",
      );
      // Return a copy to prevent mutation
      return { ...record };
    }

    this.logger?.debug(
      {
        checkpointKey,
        requestedSequenceNumber: sequenceNumber,
        recordSequence: record.SequenceNumber,
        recordStatus: record.Status,
      },
      "Record exists but doesn't match criteria",
    );

    return null;
  }

  async hasFailedCheckpointRecords(
    checkpointKey: string,
    _tenantId: TenantId,
  ): Promise<boolean> {
    const record = this.checkpoints.get(checkpointKey);
    return record?.Status === "failed";
  }

  async getFailedCheckpointRecords(
    checkpointKey: string,
    _tenantId: TenantId,
  ): Promise<CheckpointRecord[]> {
    const record = this.checkpoints.get(checkpointKey);
    if (!record || record.Status !== "failed") {
      return [];
    }

    // Return a copy to prevent mutation
    return [{ ...record }];
  }

  async insertCheckpointRecord(record: CheckpointRecord): Promise<void> {
    // Use CheckpointKey from record directly (tenantId:pipelineName:processorName:aggregateType:aggregateId)
    // Deep clone to prevent mutation
    this.logger?.debug(
      {
        checkpointKey: record.CheckpointKey,
        sequenceNumber: record.SequenceNumber,
        status: record.Status,
        eventId: record.EventId,
      },
      "insertCheckpointRecord",
    );
    this.checkpoints.set(
      record.CheckpointKey,
      JSON.parse(JSON.stringify(record)),
    );
  }

  async deleteCheckpointRecord(
    checkpointKey: string,
    _tenantId: TenantId,
  ): Promise<void> {
    this.checkpoints.delete(checkpointKey);
  }
}
