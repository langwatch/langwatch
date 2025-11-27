import { createLogger } from "~/utils/logger";
import type { AggregateType, Event, Projection } from "../library";
import type {
  EventSourcedQueueProcessor,
  EventSourcedQueueDefinition,
} from "../library/queues";
import type { EventSourcingService } from "../library/services/eventSourcingService";
import type {
  RegisteredPipeline,
  PipelineWithCommandHandlers,
} from "./pipeline/types";

const logger = createLogger("langwatch:event-sourcing:disabled");

/**
 * A no-op queue processor that logs warnings when commands are sent.
 */
class DisabledQueueProcessor<Payload>
  implements EventSourcedQueueProcessor<Payload>
{
  constructor(
    private readonly pipelineName: string,
    private readonly commandName: string,
  ) {}

  async send(_payload: Payload): Promise<void> {
    logger.warn(
      { pipeline: this.pipelineName, command: this.commandName },
      "Command ignored: event sourcing is disabled (ENABLE_EVENT_SOURCING=false)",
    );
  }

  async close(): Promise<void> {
    // No-op
  }
}

/**
 * A no-op service that logs warnings when methods are called.
 */
class DisabledEventSourcingService {
  constructor(private readonly pipelineName: string) {}

  async storeEvents(): Promise<void> {
    logger.warn(
      { pipeline: this.pipelineName },
      "storeEvents ignored: event sourcing is disabled",
    );
  }

  getQueueManager() {
    return {
      initializeCommandQueues: () => {},
      getCommandQueueProcessors: () => new Map(),
    };
  }
}

/**
 * A disabled pipeline that logs warnings but doesn't throw errors.
 * Used when ENABLE_EVENT_SOURCING=false.
 */
export class DisabledPipeline<
  EventType extends Event = Event,
  ProjectionType extends Projection = Projection,
> implements RegisteredPipeline<EventType, ProjectionType>
{
  readonly name: string;
  readonly aggregateType: AggregateType;
  readonly service: EventSourcingService<EventType, ProjectionType>;
  readonly commands: Record<string, EventSourcedQueueProcessor<any>>;

  constructor(name: string, aggregateType: AggregateType) {
    this.name = name;
    this.aggregateType = aggregateType;
    this.service = new DisabledEventSourcingService(
      name,
    ) as unknown as EventSourcingService<EventType, ProjectionType>;

    // Create a proxy that returns DisabledQueueProcessor for any command
    this.commands = new Proxy(
      {} as Record<string, EventSourcedQueueProcessor<any>>,
      {
        get: (_, commandName) => {
          return new DisabledQueueProcessor(name, String(commandName));
        },
      },
    );
  }
}

/**
 * Builder that mimics PipelineBuilder API but builds DisabledPipeline.
 * Allows code to use the same builder pattern without errors when event sourcing is disabled.
 */
export class DisabledPipelineBuilder<
  EventType extends Event = Event,
  ProjectionType extends Projection = Projection,
> {
  private _name = "unknown";
  private _aggregateType: AggregateType = "unknown" as AggregateType;
  private _hasLoggedWarning = false;

  private logWarningOnce(): void {
    if (!this._hasLoggedWarning) {
      logger.warn(
        { pipeline: this._name },
        "Building disabled pipeline: event sourcing is disabled (ENABLE_EVENT_SOURCING=false)",
      );
      this._hasLoggedWarning = true;
    }
  }

  withName(
    name: string,
  ): DisabledPipelineBuilderWithName<EventType, ProjectionType> {
    this._name = name;
    return new DisabledPipelineBuilderWithName(name);
  }

  build(): never {
    throw new Error("Pipeline name is required");
  }
}

export class DisabledPipelineBuilderWithName<
  EventType extends Event = Event,
  ProjectionType extends Projection = Projection,
> {
  constructor(private readonly _name: string) {}

  withAggregateType(
    aggregateType: AggregateType,
  ): DisabledPipelineBuilderWithNameAndType<EventType, ProjectionType> {
    return new DisabledPipelineBuilderWithNameAndType(
      this._name,
      aggregateType,
    );
  }

  build(): never {
    throw new Error("Aggregate type is required");
  }
}

export class DisabledPipelineBuilderWithNameAndType<
  EventType extends Event = Event,
  ProjectionType extends Projection = Projection,
> {
  private _hasLoggedWarning = false;

  constructor(
    private readonly _name: string,
    private readonly _aggregateType: AggregateType,
  ) {}

  private logWarningOnce(): void {
    if (!this._hasLoggedWarning) {
      logger.info(
        { pipeline: this._name, aggregateType: this._aggregateType },
        "Building disabled pipeline: event sourcing is disabled",
      );
      this._hasLoggedWarning = true;
    }
  }

  withProjection(): this {
    return this;
  }

  withEventPublisher(): this {
    return this;
  }

  withEventHandler(): this {
    return this;
  }

  withCommand(): this {
    return this;
  }

  build(): PipelineWithCommandHandlers<
    RegisteredPipeline<EventType, ProjectionType>,
    Record<string, EventSourcedQueueProcessor<any>>
  > {
    this.logWarningOnce();
    const pipeline = new DisabledPipeline<EventType, ProjectionType>(
      this._name,
      this._aggregateType,
    );
    return pipeline as unknown as PipelineWithCommandHandlers<
      RegisteredPipeline<EventType, ProjectionType>,
      Record<string, EventSourcedQueueProcessor<any>>
    >;
  }
}
