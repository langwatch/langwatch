import { createLogger } from "~/utils/logger";
import type { AggregateType, Event, Projection } from "../library";
import { EventSourcingService } from "../library";
import type {
  EventSourcingPipelineDefinition,
  RegisteredPipeline,
} from "./pipeline";

const pipelineLogger = createLogger("langwatch:event-sourcing:pipeline");

export class EventSourcingPipeline<
  EventType extends Event = Event,
  ProjectionType extends Projection = Projection,
> implements RegisteredPipeline<EventType, ProjectionType>
{
  public readonly name!: string;
  public readonly aggregateType!: AggregateType;
  public readonly service!: EventSourcingService<EventType, ProjectionType>;

  constructor(
    definition: EventSourcingPipelineDefinition<EventType, ProjectionType>,
  ) {
    // Use Object.defineProperty to make properties truly readonly at runtime
    Object.defineProperty(this, "name", {
      value: definition.name,
      writable: false,
      enumerable: true,
      configurable: false,
    });
    Object.defineProperty(this, "aggregateType", {
      value: definition.aggregateType,
      writable: false,
      enumerable: true,
      configurable: false,
    });

    // Checkpoint store is now provided by the builder (from EventSourcingRuntime)
    // or explicitly injected for testing
    const checkpointStore = definition.processorCheckpointStore;

    pipelineLogger.debug(
      {
        pipelineName: definition.name,
        checkpointStoreType: checkpointStore
          ? checkpointStore.constructor.name
          : "none",
        checkpointStoreSource: checkpointStore ? "provided" : "none",
      },
      "Initialized event-sourcing pipeline",
    );

    Object.defineProperty(this, "service", {
      value: new EventSourcingService<EventType, ProjectionType>({
        pipelineName: definition.name,
        aggregateType: definition.aggregateType,
        eventStore: definition.eventStore,
        projections: definition.projections,
        eventPublisher: definition.eventPublisher,
        eventHandlers: definition.eventHandlers,
        processorCheckpointStore: checkpointStore,
        queueProcessorFactory: definition.queueProcessorFactory,
        distributedLock: definition.distributedLock,
        handlerLockTtlMs: definition.handlerLockTtlMs,
        updateLockTtlMs: definition.updateLockTtlMs,
      }),
      writable: false,
      enumerable: true,
      configurable: false,
    });
  }
}

export type { EventSourcingConfig } from "./config";
export { createEventSourcingConfig } from "./config";
export { DisabledPipeline, DisabledPipelineBuilder } from "./disabledPipeline";
export type { EventSourcing } from "./eventSourcing";
export { eventSourcing } from "./eventSourcing";

export {
  EventSourcingRuntime,
  getEventSourcingRuntime,
  resetEventSourcingRuntime,
} from "./eventSourcingRuntime";
export type {
  EventSourcingPipelineDefinition,
  PipelineBuilderOptions,
  PipelineWithCommandHandlers,
  RegisteredPipeline,
} from "./pipeline";
export { PipelineBuilder } from "./pipeline";
export {
  BullmqQueueProcessorFactory,
  DefaultQueueProcessorFactory,
  defaultQueueProcessorFactory,
  EventSourcedQueueProcessorBullmq,
  EventSourcedQueueProcessorMemory,
  MemoryQueueProcessorFactory,
  type QueueProcessorFactory,
} from "./queue";
