import type { TenantId } from "../../../library/domain/tenantId";

/**
 * Checkpoint record format used by repositories for data storage.
 * This is the raw format stored in the database/memory.
 */
export interface CheckpointRecord {
  CheckpointKey: string; // tenantId:pipelineName:processorName:aggregateType:aggregateId
  ProcessorName: string;
  ProcessorType: "handler" | "projection";
  EventId: string;
  Status: "processed" | "failed" | "pending";
  EventTimestamp: number;
  SequenceNumber: number;
  ProcessedAt: number | null;
  FailedAt: number | null;
  ErrorMessage: string | null;
  TenantId: string;
  AggregateType: string;
  AggregateId: string;
}

/**
 * Repository interface for checkpoint data access.
 * Handles raw CRUD operations without business logic.
 *
 * **Pure Data Access**: This interface only handles raw read/write operations.
 * All business logic (key construction, validation, transformation) must be
 * handled by the store layer that uses this repository.
 */
export interface CheckpointRepository {
  /**
   * Gets a checkpoint record by checkpoint key.
   * Returns raw record without validation or transformation.
   * @param tenantId - Tenant ID for primary index optimization (first column in ORDER BY)
   */
  getCheckpointRecord(
    checkpointKey: string,
    tenantId: TenantId,
  ): Promise<CheckpointRecord | null>;

  /**
   * Gets the last processed checkpoint record for a checkpoint key.
   * Returns raw record without validation or transformation.
   * Only returns records with Status = 'processed'.
   * @param tenantId - Tenant ID for primary index optimization (first column in ORDER BY)
   */
  getLastProcessedCheckpointRecord(
    checkpointKey: string,
    tenantId: TenantId,
  ): Promise<CheckpointRecord | null>;

  /**
   * Gets a checkpoint record by sequence number for a checkpoint key.
   * Returns raw record without validation or transformation.
   * Only returns records where SequenceNumber >= sequenceNumber and Status != 'failed'.
   * @param tenantId - Tenant ID for primary index optimization (first column in ORDER BY)
   */
  getCheckpointRecordBySequenceNumber(
    checkpointKey: string,
    sequenceNumber: number,
    tenantId: TenantId,
  ): Promise<CheckpointRecord | null>;

  /**
   * Checks if any failed checkpoint records exist for a checkpoint key.
   * Returns raw boolean without validation.
   * @param tenantId - Tenant ID for primary index optimization (first column in ORDER BY)
   */
  hasFailedCheckpointRecords(
    checkpointKey: string,
    tenantId: TenantId,
  ): Promise<boolean>;

  /**
   * Gets all failed checkpoint records for a checkpoint key.
   * Returns raw records without validation or transformation.
   * @param tenantId - Tenant ID for primary index optimization (first column in ORDER BY)
   */
  getFailedCheckpointRecords(
    checkpointKey: string,
    tenantId: TenantId,
  ): Promise<CheckpointRecord[]>;

  /**
   * Inserts a checkpoint record into storage.
   * Does not validate or transform records.
   */
  insertCheckpointRecord(record: CheckpointRecord): Promise<void>;

  /**
   * Deletes a checkpoint record from storage.
   * Does not validate.
   * @param tenantId - Tenant ID for primary index optimization (first column in ORDER BY)
   */
  deleteCheckpointRecord(
    checkpointKey: string,
    tenantId: TenantId,
  ): Promise<void>;
}
