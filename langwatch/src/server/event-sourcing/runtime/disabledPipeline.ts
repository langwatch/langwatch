import { createLogger } from "~/utils/logger/server";
import type { AggregateType, Event, ParentLink, Projection } from "../library";
import type { EventSourcedQueueProcessor } from "../library/queues";
import type { EventSourcingService } from "../library/services/eventSourcingService";
import type {
  PipelineMetadata,
  PipelineWithCommandHandlers,
  RegisteredPipeline,
} from "./pipeline/types";

const logger = createLogger("langwatch:event-sourcing:disabled");

/**
 * A no-op queue processor that logs errors when commands are sent.
 */
class DisabledQueueProcessor<
  Payload,
> implements EventSourcedQueueProcessor<Payload> {
  constructor(
    private readonly pipelineName: string,
    private readonly commandName: string,
  ) {}

  async send(payload: Payload): Promise<void> {
    logger.error(
      {
        pipeline: this.pipelineName,
        command: this.commandName,
        payloadKeys: Object.keys(payload as object),
      },
      "Command DROPPED: event sourcing is disabled. Check ENABLE_EVENT_SOURCING env var and Redis/ClickHouse availability.",
    );
  }

  async close(): Promise<void> {
    // No-op
  }

  async waitUntilReady(): Promise<void> {
    // No-op - disabled queue is always "ready"
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

  getCommandQueues() {
    return new Map();
  }
}

/**
 * A disabled pipeline that logs warnings but doesn't throw errors.
 * Used when ENABLE_EVENT_SOURCING=false.
 */
export class DisabledPipeline<
  EventType extends Event = Event,
  ProjectionTypes extends Record<string, Projection> = Record<
    string,
    Projection
  >,
> implements RegisteredPipeline<EventType, ProjectionTypes> {
  readonly name: string;
  readonly aggregateType: AggregateType;
  readonly service: EventSourcingService<EventType, ProjectionTypes>;
  readonly commands: Record<string, EventSourcedQueueProcessor<any>>;
  readonly parentLinks: ParentLink<EventType>[] = [];
  readonly metadata: PipelineMetadata;

  constructor(
    name: string,
    aggregateType: AggregateType,
    metadata: PipelineMetadata,
  ) {
    this.name = name;
    this.aggregateType = aggregateType;
    this.metadata = metadata;
    this.service = new DisabledEventSourcingService(
      name,
    ) as unknown as EventSourcingService<EventType, ProjectionTypes>;

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
  ProjectionTypes extends Record<string, Projection> = Record<
    string,
    Projection
  >,
> {
  private _name = "unknown";
  private _aggregateType: AggregateType = "unknown" as AggregateType;
  private _hasLoggedWarning = false;
  private _projections: Array<{ name: string; handlerClassName: string }> = [];
  private _eventHandlers: Array<{
    name: string;
    handlerClassName: string;
    eventTypes?: string[];
  }> = [];
  private _commands: Array<{ name: string; handlerClassName: string }> = [];

  private logWarningOnce(): void {
    if (!this._hasLoggedWarning) {
      logger.info(
        { pipeline: this._name, aggregateType: this._aggregateType },
        "Building disabled pipeline: event sourcing is disabled",
      );
      this._hasLoggedWarning = true;
    }
  }

  withName(name: string): this {
    this._name = name;
    return this;
  }

  withAggregateType(aggregateType: AggregateType): this {
    this._aggregateType = aggregateType;
    return this;
  }

  withProjection(name: string, HandlerClass: { name: string }): this {
    this._projections.push({
      name,
      handlerClassName: HandlerClass.name,
    });
    return this;
  }

  withEventPublisher(): this {
    return this;
  }

  withEventHandler(
    name: string,
    HandlerClass: { name: string },
    options?: { eventTypes?: string[] },
  ): this {
    this._eventHandlers.push({
      name,
      handlerClassName: HandlerClass.name,
      eventTypes: options?.eventTypes,
    });
    return this;
  }

  withCommand(name: string, HandlerClass: { name: string }): this {
    this._commands.push({
      name,
      handlerClassName: HandlerClass.name,
    });
    return this;
  }

  withParentLink(): this {
    return this;
  }

  build(): PipelineWithCommandHandlers<
    RegisteredPipeline<EventType, ProjectionTypes>,
    Record<string, EventSourcedQueueProcessor<any>>
  > {
    this.logWarningOnce();

    const metadata: PipelineMetadata = {
      name: this._name,
      aggregateType: this._aggregateType,
      projections: this._projections,
      eventHandlers: this._eventHandlers,
      commands: this._commands,
    };

    const pipeline = new DisabledPipeline<EventType, ProjectionTypes>(
      this._name,
      this._aggregateType,
      metadata,
    );
    return pipeline as PipelineWithCommandHandlers<
      RegisteredPipeline<EventType, ProjectionTypes>,
      Record<string, EventSourcedQueueProcessor<any>>
    >;
  }
}
