import type { EventHandlerCheckpoint } from "../domain/types";
import type { TenantId } from "../domain/tenantId";
import type { AggregateType } from "../domain/aggregateType";

/**
 * Store interface for managing event handler checkpoints.
 *
 * Checkpoints track the last processed event for each handler per aggregate, enabling:
 * - Resuming processing after queue failures per aggregate
 * - Replay from specific points per aggregate
 * - Idempotent processing per aggregate
 *
 * **Implementation Requirements:**
 * - MUST enforce tenant isolation
 * - MUST validate tenantId using validateTenantId() before operations
 * - SHOULD prevent mutation of stored checkpoints
 */
export interface EventHandlerCheckpointStore {
  /**
   * Saves a checkpoint for a handler and aggregate.
   *
   * @param handlerName - The name of the handler
   * @param tenantId - The tenant ID
   * @param aggregateType - The aggregate type
   * @param aggregateId - The aggregate ID
   * @param checkpoint - The checkpoint to save
   * @throws {Error} If tenantId is missing or invalid
   */
  saveCheckpoint(
    handlerName: string,
    tenantId: TenantId,
    aggregateType: AggregateType,
    aggregateId: string,
    checkpoint: EventHandlerCheckpoint,
  ): Promise<void>;

  /**
   * Loads the checkpoint for a handler and aggregate.
   *
   * @param handlerName - The name of the handler
   * @param tenantId - The tenant ID
   * @param aggregateType - The aggregate type
   * @param aggregateId - The aggregate ID
   * @returns The checkpoint if it exists, null otherwise
   * @throws {Error} If tenantId is missing or invalid
   */
  loadCheckpoint(
    handlerName: string,
    tenantId: TenantId,
    aggregateType: AggregateType,
    aggregateId: string,
  ): Promise<EventHandlerCheckpoint | null>;

  /**
   * Clears the checkpoint for a handler and aggregate.
   *
   * @param handlerName - The name of the handler
   * @param tenantId - The tenant ID
   * @param aggregateType - The aggregate type
   * @param aggregateId - The aggregate ID
   * @throws {Error} If tenantId is missing or invalid
   */
  clearCheckpoint(
    handlerName: string,
    tenantId: TenantId,
    aggregateType: AggregateType,
    aggregateId: string,
  ): Promise<void>;
}
