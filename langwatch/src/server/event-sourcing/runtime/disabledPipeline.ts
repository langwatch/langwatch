import { createLogger } from "~/utils/logger/server";
import type { AggregateType, Event, ParentLink, Projection } from "../library";
import type { EventSourcedQueueProcessor } from "../library/queues";
import type { EventSourcingService } from "../library/services/eventSourcingService";
import type {
  PipelineMetadata,
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
