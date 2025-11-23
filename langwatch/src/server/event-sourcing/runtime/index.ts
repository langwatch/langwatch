import type { Event, Projection, AggregateType } from "../library";
import { EventSourcingService } from "../library";
import type {
  EventSourcingPipelineDefinition,
  RegisteredPipeline,
} from "./pipeline";
import { ProcessorCheckpointStoreMemory } from "./stores/processorCheckpointStoreMemory";
import { ProcessorCheckpointStoreClickHouse } from "./stores/processorCheckpointStoreClickHouse";
import { CheckpointRepositoryClickHouse } from "./stores/repositories/checkpointRepositoryClickHouse";
import { CheckpointRepositoryMemory } from "./stores/repositories/checkpointRepositoryMemory";
import { getClickHouseClient } from "../../../utils/clickhouse";

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
    // Create checkpoint store for event handlers and projections
    // Always use Memory store in test environment, otherwise use ClickHouse if available
    const checkpointStore =
      (definition.eventHandlers ?? definition.projections)
        ? (() => {
            // Always use Memory store in test environment
            if (process.env.NODE_ENV === "test" || process.env.VITEST) {
              return new ProcessorCheckpointStoreMemory(
                new CheckpointRepositoryMemory(),
              );
            }
            const clickHouseClient = getClickHouseClient();
            return clickHouseClient
              ? new ProcessorCheckpointStoreClickHouse(
                  new CheckpointRepositoryClickHouse(clickHouseClient),
                )
              : new ProcessorCheckpointStoreMemory(
                  new CheckpointRepositoryMemory(),
                );
          })()
        : void 0;

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

export {
  EventSourcedQueueProcessorBullmq,
  EventSourcedQueueProcessorMemory,
  type QueueProcessorFactory,
  DefaultQueueProcessorFactory,
  BullmqQueueProcessorFactory,
  MemoryQueueProcessorFactory,
  defaultQueueProcessorFactory,
} from "./queue";

export { PipelineBuilder } from "./pipeline";
export type {
  EventSourcingPipelineDefinition,
  RegisteredPipeline,
  PipelineWithCommandHandlers,
} from "./pipeline";

export { eventSourcing } from "./eventSourcing";
export type { EventSourcing } from "./eventSourcing";
