import type { createLogger } from "~/utils/logger";
import type { Event } from "../../domain/types";
import type { ProcessorCheckpointStore } from "../../stores/eventHandlerCheckpointStore.types";

/**
 * Detects failed events for an aggregate to prevent cascading failures.
 */
export class FailureDetector<EventType extends Event = Event> {
  constructor(
    private readonly processorCheckpointStore?: ProcessorCheckpointStore,
    private readonly pipelineName?: string,
    private readonly logger?: ReturnType<typeof createLogger>,
  ) {}

  /**
   * Checks if any previous events have failed processing for an aggregate.
   * If failures are detected, processing should be stopped to prevent cascading failures.
   *
   * @param processorName - Name of the processor (handler or projection)
   * @param processorType - Type of processor ("handler" or "projection")
   * @param event - The event being processed
   * @returns True if failures exist, false otherwise
   */
  async hasFailedEvents(
    processorName: string,
    processorType: "handler" | "projection",
    event: EventType,
  ): Promise<boolean> {
    if (!this.processorCheckpointStore || !this.pipelineName) {
      return false;
    }

    return await this.processorCheckpointStore.hasFailedEvents(
      this.pipelineName,
      processorName,
      processorType,
      event.tenantId,
      event.aggregateType,
      String(event.aggregateId),
    );
  }
}
