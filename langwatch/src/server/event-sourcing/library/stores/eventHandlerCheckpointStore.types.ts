import type { Event, ProcessorCheckpoint } from "../domain/types";
import type { TenantId } from "../domain/tenantId";
import type { AggregateType } from "../domain/aggregateType";

/**
 * Store interface for managing processor checkpoints (event handlers and projections).
 *
 * Checkpoints track per-event processing status, enabling:
 * - Resuming processing after queue failures per aggregate
 * - Preventing duplicate processing (idempotency)
 * - Stopping processing when failures occur for a specific aggregate
 * - Replay from specific points per aggregate
 *
 * Checkpoints use `processorName:eventId` as the unique key, where processorName is either
 * a handler name or projection name.
 *
 * **Implementation Requirements:**
 * - MUST enforce tenant isolation
 * - MUST validate tenantId using validateTenantId() before operations
 * - SHOULD prevent mutation of stored checkpoints
 */
export interface ProcessorCheckpointStore {
  /**
   * Saves a checkpoint for a processor and event.
   * Uses `processorName:eventId` as the unique key.
   *
   * @param processorName - The name of the processor (handler or projection)
   * @param processorType - The type of processor ('handler' or 'projection')
   * @param event - The event being checkpointed
   * @param status - The processing status ('processed', 'failed', or 'pending')
   * @param sequenceNumber - The sequence number of the event within the aggregate (1-indexed)
   * @param errorMessage - Optional error message if status is 'failed'
   * @throws {Error} If tenantId is missing or invalid
   */
  saveCheckpoint<EventType extends Event>(
    processorName: string,
    processorType: "handler" | "projection",
    event: EventType,
    status: "processed" | "failed" | "pending",
    sequenceNumber: number,
    errorMessage?: string,
  ): Promise<void>;

  /**
   * Loads the checkpoint for a specific processor and event.
   * Uses `processorName:eventId` as the lookup key.
   *
   * @param processorName - The name of the processor (handler or projection)
   * @param processorType - The type of processor ('handler' or 'projection')
   * @param eventId - The unique event identifier
   * @returns The checkpoint if it exists, null otherwise
   */
  loadCheckpoint(
    processorName: string,
    processorType: "handler" | "projection",
    eventId: string,
  ): Promise<ProcessorCheckpoint | null>;

  /**
   * Gets the last successfully processed event for a processor and aggregate.
   * Used to determine where to resume processing after failures.
   *
   * @param processorName - The name of the processor (handler or projection)
   * @param processorType - The type of processor ('handler' or 'projection')
   * @param tenantId - The tenant ID
   * @param aggregateType - The aggregate type
   * @param aggregateId - The aggregate ID
   * @returns The checkpoint for the last processed event, or null if none exists
   * @throws {Error} If tenantId is missing or invalid
   */
  getLastProcessedEvent(
    processorName: string,
    processorType: "handler" | "projection",
    tenantId: TenantId,
    aggregateType: AggregateType,
    aggregateId: string,
  ): Promise<ProcessorCheckpoint | null>;

  /**
   * Gets the checkpoint for a specific sequence number for a processor and aggregate.
   * Used to verify that a previous event (by sequence number) has been processed
   * before processing the current event, ensuring strict ordering.
   *
   * @param processorName - The name of the processor (handler or projection)
   * @param processorType - The type of processor ('handler' or 'projection')
   * @param tenantId - The tenant ID
   * @param aggregateType - The aggregate type
   * @param aggregateId - The aggregate ID
   * @param sequenceNumber - The sequence number to look up (1-indexed)
   * @returns The checkpoint if it exists and has status 'processed', null otherwise
   * @throws {Error} If tenantId is missing or invalid
   */
  getCheckpointBySequenceNumber(
    processorName: string,
    processorType: "handler" | "projection",
    tenantId: TenantId,
    aggregateType: AggregateType,
    aggregateId: string,
    sequenceNumber: number,
  ): Promise<ProcessorCheckpoint | null>;

  /**
   * Checks if any events have failed processing for a processor and aggregate.
   * Used to stop processing subsequent events when failures occur.
   *
   * @param processorName - The name of the processor (handler or projection)
   * @param processorType - The type of processor ('handler' or 'projection')
   * @param tenantId - The tenant ID
   * @param aggregateType - The aggregate type
   * @param aggregateId - The aggregate ID
   * @returns True if any events have failed, false otherwise
   * @throws {Error} If tenantId is missing or invalid
   */
  hasFailedEvents(
    processorName: string,
    processorType: "handler" | "projection",
    tenantId: TenantId,
    aggregateType: AggregateType,
    aggregateId: string,
  ): Promise<boolean>;

  /**
   * Gets all failed events for a processor and aggregate.
   * Used for debugging and recovery scenarios.
   *
   * @param processorName - The name of the processor (handler or projection)
   * @param processorType - The type of processor ('handler' or 'projection')
   * @param tenantId - The tenant ID
   * @param aggregateType - The aggregate type
   * @param aggregateId - The aggregate ID
   * @returns Array of checkpoints for failed events, empty array if none
   * @throws {Error} If tenantId is missing or invalid
   */
  getFailedEvents(
    processorName: string,
    processorType: "handler" | "projection",
    tenantId: TenantId,
    aggregateType: AggregateType,
    aggregateId: string,
  ): Promise<ProcessorCheckpoint[]>;

  /**
   * Clears the checkpoint for a specific processor and event.
   * Used for recovery scenarios when reprocessing events.
   *
   * @param processorName - The name of the processor (handler or projection)
   * @param processorType - The type of processor ('handler' or 'projection')
   * @param eventId - The unique event identifier
   */
  clearCheckpoint(
    processorName: string,
    processorType: "handler" | "projection",
    eventId: string,
  ): Promise<void>;
}
