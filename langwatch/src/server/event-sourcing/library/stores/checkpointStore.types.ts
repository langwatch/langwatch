import type { AggregateType } from "../domain/aggregateType";
import type { TenantId } from "../domain/tenantId";
import type { Event, ProcessorCheckpoint } from "../domain/types";

/**
 * Store interface for managing processor checkpoints (event handlers and projections).
 *
 * Checkpoints track per-event processing status, enabling:
 * - Resuming processing after queue failures per aggregate
 * - Preventing duplicate processing (idempotency)
 * - Stopping processing when failures occur for a specific aggregate
 * - Replay from specific points per aggregate
 *
 * Checkpoints use `tenantId:pipelineName:componentName:aggregateType:aggregateId` as the unique key.
 * One checkpoint per aggregate tracks the last processed event's details.
 * Key construction is centralized in saveCheckpointSafely - stores only receive/use keys, not construct them.
 *
 * **Implementation Requirements:**
 * - MUST enforce tenant isolation
 * - MUST validate tenantId using validateTenantId() before all operations
 * - For write/clear operations, MUST verify that the provided tenantId matches:
 *   - The tenantId embedded in the checkpointKey (for all operations)
 *   - The event.tenantId (for saveCheckpoint operations)
 * - SHOULD prevent mutation of stored checkpoints
 */
export interface CheckpointStore {
  /**
   * Saves a checkpoint for a processor and event.
   * Uses the provided checkpointKey (format: `tenantId:pipelineName:processorName:aggregateType:aggregateId`).
   * Key construction is handled by saveCheckpointSafely.
   *
   * @param tenantId - The tenant ID (must match event.tenantId and the tenantId in checkpointKey)
   * @param checkpointKey - The full checkpoint key (tenantId:pipelineName:componentName:aggregateType:aggregateId)
   * @param componentType - The type of component ('handler' or 'projection')
   * @param event - The event being checkpointed
   * @param status - The processing status ('processed', 'failed', or 'pending')
   * @param sequenceNumber - The sequence number of the event within the aggregate (1-indexed)
   * @param errorMessage - Optional error message if status is 'failed'
   * @throws {Error} If tenantId is missing, invalid, or doesn't match event.tenantId or the tenantId in checkpointKey
   */
  saveCheckpoint<EventType extends Event>(
    tenantId: TenantId,
    checkpointKey: string,
    componentType: "handler" | "projection",
    event: EventType,
    status: "processed" | "failed" | "pending",
    sequenceNumber: number,
    errorMessage?: string,
  ): Promise<void>;

  /**
   * Loads the checkpoint for a specific processor and event.
   * Uses the provided checkpointKey (format: `tenantId:pipelineName:processorName:aggregateType:aggregateId`).
   * Key construction is handled by saveCheckpointSafely.
   *
   * @param checkpointKey - The full checkpoint key (tenantId:pipelineName:processorName:aggregateType:aggregateId)
   * @returns The checkpoint if it exists, null otherwise
   */
  loadCheckpoint(checkpointKey: string): Promise<ProcessorCheckpoint | null>;

  /**
   * Gets the last successfully processed event for a processor and aggregate.
   * Used to determine where to resume processing after failures.
   *
   * @param pipelineName - The pipeline name for checkpoint isolation
   * @param componentName - The name of the component (handler or projection)
   * @param componentType - The type of component ('handler' or 'projection')
   * @param tenantId - The tenant ID
   * @param aggregateType - The aggregate type
   * @param aggregateId - The aggregate ID
   * @returns The checkpoint for the last processed event, or null if none exists
   * @throws {Error} If tenantId is missing or invalid
   */
  getLastProcessedEvent(
    pipelineName: string,
    componentName: string,
    componentType: "handler" | "projection",
    tenantId: TenantId,
    aggregateType: AggregateType,
    aggregateId: string,
  ): Promise<ProcessorCheckpoint | null>;

  /**
   * Gets the checkpoint for a specific sequence number for a processor and aggregate.
   * With per-aggregate checkpoints, this loads the aggregate checkpoint and checks if
   * the last processed sequence number is >= the requested sequence number.
   * Used to verify that a previous event (by sequence number) has been processed
   * before processing the current event, ensuring strict ordering.
   *
   * @param pipelineName - The pipeline name for checkpoint isolation
   * @param componentName - The name of the component (handler or projection)
   * @param componentType - The type of component ('handler' or 'projection')
   * @param tenantId - The tenant ID
   * @param aggregateType - The aggregate type
   * @param aggregateId - The aggregate ID
   * @param sequenceNumber - The sequence number to verify (1-indexed)
   * @returns The checkpoint if it exists, has status 'processed', and sequenceNumber >= requested sequenceNumber, null otherwise
   * @throws {Error} If tenantId is missing or invalid
   */
  getCheckpointBySequenceNumber(
    pipelineName: string,
    componentName: string,
    componentType: "handler" | "projection",
    tenantId: TenantId,
    aggregateType: AggregateType,
    aggregateId: string,
    sequenceNumber: number,
  ): Promise<ProcessorCheckpoint | null>;

  /**
   * Checks if any events have failed processing for a processor and aggregate.
   * Used to stop processing subsequent events when failures occur.
   *
   * @param pipelineName - The pipeline name for checkpoint isolation
   * @param componentName - The name of the component (handler or projection)
   * @param componentType - The type of component ('handler' or 'projection')
   * @param tenantId - The tenant ID
   * @param aggregateType - The aggregate type
   * @param aggregateId - The aggregate ID
   * @returns True if any events have failed, false otherwise
   * @throws {Error} If tenantId is missing or invalid
   */
  hasFailedEvents(
    pipelineName: string,
    componentName: string,
    componentType: "handler" | "projection",
    tenantId: TenantId,
    aggregateType: AggregateType,
    aggregateId: string,
  ): Promise<boolean>;

  /**
   * Gets all failed events for a processor and aggregate.
   * Used for debugging and recovery scenarios.
   *
   * @param pipelineName - The pipeline name for checkpoint isolation
   * @param componentName - The name of the component (handler or projection)
   * @param componentType - The type of component ('handler' or 'projection')
   * @param tenantId - The tenant ID
   * @param aggregateType - The aggregate type
   * @param aggregateId - The aggregate ID
   * @returns Array of checkpoints for failed events, empty array if none
   * @throws {Error} If tenantId is missing or invalid
   */
  getFailedEvents(
    pipelineName: string,
    componentName: string,
    componentType: "handler" | "projection",
    tenantId: TenantId,
    aggregateType: AggregateType,
    aggregateId: string,
  ): Promise<ProcessorCheckpoint[]>;

  /**
   * Clears the checkpoint for a specific processor and event.
   * Used for recovery scenarios when reprocessing events.
   * Uses the provided checkpointKey (format: `tenantId:pipelineName:processorName:aggregateType:aggregateId`).
   * Key construction is handled by saveCheckpointSafely.
   *
   * @param tenantId - The tenant ID (must match the tenantId in checkpointKey)
   * @param checkpointKey - The full checkpoint key (tenantId:pipelineName:processorName:aggregateType:aggregateId)
   * @throws {Error} If tenantId is missing, invalid, or doesn't match the tenantId in checkpointKey
   */
  clearCheckpoint(tenantId: TenantId, checkpointKey: string): Promise<void>;
}
