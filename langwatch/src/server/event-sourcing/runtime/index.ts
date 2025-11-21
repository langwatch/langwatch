import type { Event, Projection, AggregateType } from "../library";
import { EventSourcingService } from "../library";
import type {
  EventSourcingPipelineDefinition,
  RegisteredPipeline,
} from "./pipeline";
import { EventHandlerCheckpointStoreMemory } from "./stores/eventHandlerCheckpointStoreMemory";
import { EventHandlerCheckpointStoreClickHouse } from "./stores/eventHandlerCheckpointStoreClickHouse";
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
    // Create checkpoint store for event handlers
    // Use ClickHouse if available (for production), otherwise use memory (for dev/test)
    const checkpointStore = definition.eventHandlers
      ? (() => {
          const clickHouseClient = getClickHouseClient();
          return clickHouseClient
            ? new EventHandlerCheckpointStoreClickHouse(clickHouseClient)
            : new EventHandlerCheckpointStoreMemory();
        })()
      : void 0;

    Object.defineProperty(this, "service", {
      value: new EventSourcingService<EventType, ProjectionType>({
        aggregateType: definition.aggregateType,
        eventStore: definition.eventStore,
        projections: definition.projections,
        eventPublisher: definition.eventPublisher,
        eventHandlers: definition.eventHandlers,
        eventHandlerCheckpointStore: checkpointStore,
        queueProcessorFactory: definition.queueProcessorFactory,
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
