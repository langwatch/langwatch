import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import type { EventStream } from "../streams/eventStream";
import type {
  Event,
  EventHandlerCheckpoint,
  Projection,
} from "../domain/types";
import { EventUtils } from "../utils/event.utils";
import { DEFAULT_UPDATE_LOCK_TTL_MS } from "./eventSourcingService.types";
import type {
  EventSourcingOptions,
  EventSourcingServiceOptions,
  UpdateProjectionOptions,
  ReplayEventsOptions,
} from "./eventSourcingService.types";
import type { ProjectionDefinition } from "../projection.types";
import type {
  EventHandlerDefinition,
  EventHandlerDefinitions,
} from "../eventHandler.types";
import type { AggregateType } from "../domain/aggregateType";
import type { TenantId } from "../domain/tenantId";
import type { EventStore } from "../stores/eventStore.types";
import type { EventStoreReadContext } from "../stores/eventStore.types";
import type { DistributedLock } from "../utils/distributedLock";
import type { EventPublisher } from "../publishing/eventPublisher.types";
import type { EventHandlerCheckpointStore } from "../stores/eventHandlerCheckpointStore.types";
import type { EventSourcedQueueProcessor } from "../queues";
import { createLogger } from "~/utils/logger";

/**
 * Main service that orchestrates event sourcing.
 * Coordinates between event stores, projection stores, and event handlers.
 */
export class EventSourcingService<
  EventType extends Event = Event,
  ProjectionType extends Projection = Projection,
> {
  private readonly tracer = getLangWatchTracer(
    "langwatch.trace-processing.event-sourcing-service",
  );
  private readonly logger?: ReturnType<typeof createLogger>;

  private readonly aggregateType: AggregateType;
  private readonly eventStore: EventStore<EventType>;
  private readonly projections?: Map<
    string,
    ProjectionDefinition<EventType, any>
  >;
  private readonly eventPublisher?: EventPublisher<EventType>;
  private readonly eventHandlers?: Map<
    string,
    EventHandlerDefinition<EventType>
  >;
  private readonly eventHandlerCheckpointStore?: EventHandlerCheckpointStore;
  private readonly options: EventSourcingOptions<EventType>;
  private readonly distributedLock?: DistributedLock;
  private readonly updateLockTtlMs: number;
  private readonly queueProcessorFactory?: EventSourcingServiceOptions<
    EventType,
    ProjectionType
  >["queueProcessorFactory"];
  // Queue processors for event handlers (one per handler)
  private readonly handlerQueueProcessors = new Map<
    string,
    EventSourcedQueueProcessor<EventType>
  >();

  constructor({
    aggregateType,
    eventStore,
    projections,
    eventPublisher,
    eventHandlers,
    eventHandlerCheckpointStore,
    serviceOptions,
    logger,
    distributedLock,
    updateLockTtlMs = DEFAULT_UPDATE_LOCK_TTL_MS,
    queueProcessorFactory,
  }: EventSourcingServiceOptions<EventType, ProjectionType> & {
    eventHandlerCheckpointStore?: EventHandlerCheckpointStore;
  }) {
    this.aggregateType = aggregateType;
    this.eventStore = eventStore;
    this.projections = projections
      ? new Map(Object.entries(projections))
      : void 0;
    this.eventPublisher = eventPublisher;
    this.eventHandlers = eventHandlers
      ? new Map(Object.entries(eventHandlers))
      : void 0;
    this.eventHandlerCheckpointStore = eventHandlerCheckpointStore;
    this.options = serviceOptions ?? {};
    this.logger =
      logger ??
      createLogger("langwatch.trace-processing.event-sourcing-service");
    this.distributedLock = distributedLock;
    this.updateLockTtlMs = updateLockTtlMs;
    this.queueProcessorFactory = queueProcessorFactory;

    // Warn in production if distributed lock is not provided
    if (process.env.NODE_ENV === "production" && !distributedLock && logger) {
      logger.warn(
        {
          aggregateType,
        },
        "[SECURITY] EventSourcingService initialized without distributed lock in production. Concurrent updates of the same aggregate projection may result in lost updates (last write wins). Consider providing a DistributedLock implementation.",
      );
    }

    // Warn in production if queue factory is not provided (handlers will be synchronous)
    if (
      process.env.NODE_ENV === "production" &&
      !queueProcessorFactory &&
      eventHandlers &&
      Object.keys(eventHandlers).length > 0 &&
      logger
    ) {
      logger.warn(
        {
          aggregateType,
        },
        "[PERFORMANCE] EventSourcingService initialized without queue processor factory in production. Event handlers will be executed synchronously, blocking event storage. Consider providing a QueueProcessorFactory for async processing.",
      );
    }

    // Initialize queue processors for event handlers if factory is provided
    if (queueProcessorFactory && eventHandlers) {
      this.initializeHandlerQueues(eventHandlers);
    }
  }

  /**
   * Stores events using the pipeline's aggregate type.
   *
   * This method automatically uses the aggregate type configured for this pipeline,
   * preventing copy/paste mistakes where the wrong aggregate type is passed.
   *
   * **Execution Flow:**
   * 1. Events are stored in the event store (must succeed)
   * 2. Events are published to the event publisher (if configured) - errors are logged but don't fail
   * 3. Events are dispatched to event handlers (if configured) - errors are logged but don't fail
   * 4. Projections are automatically updated - errors are logged but don't fail
   *
   * **Concurrency:** Safe for concurrent calls with different aggregateIds. Concurrent calls for the same
   * aggregateId are safe at the event store level, but projection updates may conflict (use distributedLock).
   *
   * **Failure Modes:**
   * - Event store failures throw and prevent storage
   * - Publisher/handler/projection failures are logged but don't prevent storage
   * - Invalid tenantId throws before any operations
   *
   * **Performance:** O(n) where n is the number of events. Projection updates are O(m) where m is the
   * number of projections × number of unique aggregateIds in the event batch.
   *
   * @param events - Events to store
   * @param context - Security context with required tenantId
   * @throws {Error} If tenantId is invalid or event store operation fails
   */
  async storeEvents(
    events: readonly EventType[],
    context: EventStoreReadContext<EventType>,
  ): Promise<void> {
    return await this.tracer.withActiveSpan(
      "EventSourcingService.storeEvents",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "aggregate.type": this.aggregateType,
          "event.count": events.length,
          "tenant.id": context.tenantId,
          "event.types": [...new Set(events.map((e) => e.type))].join(","),
        },
      },
      async (span) => {
        EventUtils.validateTenantId(context, "storeEvents");

        // Enrich events with trace context if missing (for debugging)
        const enrichedEvents = events.map((event) => {
          const enrichedMetadata =
            EventUtils.buildEventMetadataWithCurrentProcessingTraceparent(
              event.metadata,
            );
          if (enrichedMetadata === event.metadata) {
            return event;
          }
          return {
            ...event,
            metadata: enrichedMetadata,
          } as EventType;
        });

        span.addEvent("event_store.store.start");
        await this.eventStore.storeEvents(
          enrichedEvents,
          context,
          this.aggregateType,
        );
        span.addEvent("event_store.store.complete");

        // Publish events after successful storage
        if (this.eventPublisher && enrichedEvents.length > 0) {
          span.addEvent("publisher.publish.start");
          try {
            await this.eventPublisher.publish(enrichedEvents, context);
            span.addEvent("publisher.publish.complete");
          } catch (error) {
            span.addEvent("publisher.publish.error", {
              "error.message":
                error instanceof Error ? error.message : String(error),
            });
            // Log publishing errors but don't fail the storage operation
            if (this.logger) {
              this.logger.error(
                {
                  aggregateType: this.aggregateType,
                  eventCount: enrichedEvents.length,
                  error: error instanceof Error ? error.message : String(error),
                },
                "Failed to publish events to external system",
              );
            }
          }
        }

        // Dispatch events to handlers after successful storage
        if (this.eventHandlers && enrichedEvents.length > 0) {
          span.addEvent("handler.dispatch.start");
          await this.dispatchEventsToHandlers(enrichedEvents, context);
          span.addEvent("handler.dispatch.complete");
        }

        if (this.projections && enrichedEvents.length > 0) {
          span.addEvent("projection.update.start");
          await this.updateProjectionsForAggregates(enrichedEvents, context);
          span.addEvent("projection.update.complete");
        }
      },
    );
  }

  /**
   * Initializes queue processors for all registered event handlers.
   * Each handler gets its own queue processor for async processing.
   */
  private initializeHandlerQueues(
    eventHandlers: EventHandlerDefinitions<EventType>,
  ): void {
    if (!this.queueProcessorFactory) {
      return;
    }

    // Topological sort ensures queues are created in dependency order
    const sortedHandlers = this.topologicalSortHandlersFromMap(
      new Map(Object.entries(eventHandlers)),
    );

    for (const handlerName of sortedHandlers) {
      const handlerDef = eventHandlers[handlerName];
      if (!handlerDef) {
        continue;
      }

      const queueName = `${this.aggregateType}_handler_${handlerName}`;

      const queueProcessor = this.queueProcessorFactory.create<EventType>({
        name: queueName,
        makeJobId: handlerDef.options.makeJobId ?? this.createDefaultJobId,
        delay: handlerDef.options.delay,
        options: handlerDef.options.concurrency
          ? { concurrency: handlerDef.options.concurrency }
          : void 0,
        spanAttributes: handlerDef.options.spanAttributes,
        process: async (event: EventType) => {
          await this.handleEvent(handlerName, handlerDef, event, {
            tenantId: event.tenantId,
          });
        },
      });

      this.handlerQueueProcessors.set(handlerName, queueProcessor);
    }
  }

  /**
   * Creates a default job ID for event handler processing.
   * Format: `${tenantId}:${aggregateId}:${timestamp}:${eventType}:${handlerName}`
   */
  private createDefaultJobId = (event: EventType): string => {
    return `${event.tenantId}:${String(event.aggregateId)}:${event.timestamp}:${event.type}:${this.aggregateType}`;
  };

  /**
   * Dispatches events to registered event handlers.
   *
   * If queue processors are available, events are dispatched asynchronously via queues.
   * Otherwise, handlers are executed synchronously (fallback for backwards compatibility).
   *
   * **Concurrency:** Handlers are processed in dependency order (topologically sorted).
   * With queues, handlers process events concurrently up to their concurrency limits.
   * Without queues, handlers execute sequentially per event.
   *
   * **Failure Modes:**
   * - Handler errors are logged but don't fail the dispatch operation
   * - Queue dispatch errors are logged but don't fail (queue processor handles retries)
   * - Dependent handlers still execute even if a dependency fails (they should handle missing data gracefully)
   */
  private async dispatchEventsToHandlers(
    events: readonly EventType[],
    context: EventStoreReadContext<EventType>,
  ): Promise<void> {
    if (!this.eventHandlers || this.eventHandlers.size === 0) {
      return;
    }

    return await this.tracer.withActiveSpan(
      "EventSourcingService.dispatchEventsToHandlers",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "aggregate.type": this.aggregateType,
          "event.count": events.length,
          "tenant.id": context.tenantId,
          "handler.count": this.eventHandlers.size,
          "dispatch.mode":
            this.handlerQueueProcessors.size > 0 ? "async" : "sync",
        },
      },
      async () => {
        // If queue processors are available, use async queue-based dispatch
        if (this.handlerQueueProcessors.size > 0) {
          await this.dispatchEventsToQueues(events);
          return;
        }

        // Fallback: synchronous dispatch (for backwards compatibility or when no queue factory provided)
        await this.dispatchEventsSynchronously(events, context);
      },
    );
  }

  /**
   * Dispatches events to handler queues asynchronously.
   * Events are queued immediately and processed asynchronously by workers.
   */
  private async dispatchEventsToQueues(
    events: readonly EventType[],
  ): Promise<void> {
    return await this.tracer.withActiveSpan(
      "EventSourcingService.dispatchEventsToQueues",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "aggregate.type": this.aggregateType,
          "event.count": events.length,
          "handler.count": this.handlerQueueProcessors.size,
        },
      },
      async (span) => {
        const sortedHandlers = this.topologicalSortHandlers();

        // Dispatch events to queues in dependency order (actual processing order maintained by queue workers)
        for (const event of events) {
          for (const handlerName of sortedHandlers) {
            const handlerDef = this.eventHandlers?.get(handlerName);
            if (!handlerDef) {
              continue;
            }

            // Get event types this handler is interested in
            const handlerEventTypes = this.getHandlerEventTypes(handlerDef);

            // Filter by event type if handler specifies event types
            if (handlerEventTypes && handlerEventTypes.length > 0) {
              if (!handlerEventTypes.includes(event.type)) {
                continue;
              }
            }

            const queueProcessor = this.handlerQueueProcessors.get(handlerName);
            if (!queueProcessor) {
              this.logger?.warn(
                {
                  handlerName,
                  eventType: event.type,
                },
                "Queue processor not found for handler, skipping",
              );
              continue;
            }

            try {
              span.addEvent("handler.queue.send", {
                "handler.name": handlerName,
                "event.type": event.type,
                "event.id": event.id,
                "event.aggregate_id": String(event.aggregateId),
              });
              await queueProcessor.send(event);
            } catch (error) {
              span.addEvent("handler.queue.send.error", {
                "handler.name": handlerName,
                "event.type": event.type,
                "error.message":
                  error instanceof Error ? error.message : String(error),
              });
              // Queue processor handles retries internally
              if (this.logger) {
                this.logger.error(
                  {
                    handlerName,
                    eventType: event.type,
                    aggregateId: String(event.aggregateId),
                    tenantId: event.tenantId,
                    error:
                      error instanceof Error ? error.message : String(error),
                  },
                  "Failed to dispatch event to handler queue",
                );
              }
            }
          }
        }
      },
    );
  }

  /**
   * Dispatches events to handlers synchronously (fallback mode).
   * Used when no queue processor factory is provided.
   */
  private async dispatchEventsSynchronously(
    events: readonly EventType[],
    context: EventStoreReadContext<EventType>,
  ): Promise<void> {
    return await this.tracer.withActiveSpan(
      "EventSourcingService.dispatchEventsSynchronously",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "aggregate.type": this.aggregateType,
          "event.count": events.length,
          "tenant.id": context.tenantId,
          "handler.count": this.eventHandlers?.size ?? 0,
        },
      },
      async (span) => {
        const sortedHandlers = this.topologicalSortHandlers();

        for (const event of events) {
          for (const handlerName of sortedHandlers) {
            const handlerDef = this.eventHandlers?.get(handlerName);
            if (!handlerDef) {
              continue;
            }

            const handlerEventTypes = this.getHandlerEventTypes(handlerDef);

            if (handlerEventTypes && handlerEventTypes.length > 0) {
              if (!handlerEventTypes.includes(event.type)) {
                continue;
              }
            }

            try {
              span.addEvent("handler.handle.start", {
                "handler.name": handlerName,
                "event.type": event.type,
                "event.id": event.id,
                "event.aggregate_id": String(event.aggregateId),
              });
              await this.handleEvent(handlerName, handlerDef, event, context);
              span.addEvent("handler.handle.complete", {
                "handler.name": handlerName,
              });
            } catch (error) {
              span.addEvent("handler.handle.error", {
                "handler.name": handlerName,
                "event.type": event.type,
                "error.message":
                  error instanceof Error ? error.message : String(error),
              });
              if (this.logger) {
                this.logger.error(
                  {
                    handlerName,
                    eventType: event.type,
                    aggregateId: String(event.aggregateId),
                    tenantId: event.tenantId,
                    error:
                      error instanceof Error ? error.message : String(error),
                  },
                  "Failed to handle event in handler",
                );
              }
              // Dependent handlers still execute even if a dependency fails
            }
          }
        }
      },
    );
  }

  /**
   * Topologically sorts handlers based on their dependencies.
   *
   * Uses Kahn's algorithm to determine execution order (dependencies first).
   *
   * **Performance:** O(V + E) where V is the number of handlers and E is the number of dependencies.
   *
   * **Failure Modes:**
   * - Throws if circular dependencies are detected
   * - Throws if a handler depends on a non-existent handler
   *
   * @returns Handler names in execution order (dependencies first)
   * @throws {Error} If circular dependencies are detected or a dependency is missing
   */
  private topologicalSortHandlers(): string[] {
    if (!this.eventHandlers || this.eventHandlers.size === 0) {
      return [];
    }
    return this.topologicalSortHandlersFromMap(this.eventHandlers);
  }

  /**
   * Topologically sorts handlers from a map.
   * Returns handler names in execution order (dependencies first).
   * Throws an error if circular dependencies are detected.
   */
  private topologicalSortHandlersFromMap(
    handlers: Map<string, EventHandlerDefinition<EventType>>,
  ): string[] {
    if (handlers.size === 0) {
      return [];
    }

    return this.tracer.withActiveSpan(
      "EventSourcingService.topologicalSortHandlers",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "handler.count": handlers.size,
        },
      },
      (span) => {
        const startTime = Date.now();
        const handlerNames = Array.from(handlers.keys());
        const inDegree = new Map<string, number>();
        const dependencies = new Map<string, string[]>();
        let dependencyCount = 0;

        // Initialize in-degree and dependencies
        for (const handlerName of handlerNames) {
          inDegree.set(handlerName, 0);
          dependencies.set(handlerName, []);
        }

        // Build dependency graph
        span.addEvent("dependency_graph.build.start");
        for (const [handlerName, handlerDef] of handlers.entries()) {
          const dependsOn = handlerDef.options.dependsOn ?? [];
          for (const dependency of dependsOn) {
            if (!handlers.has(dependency)) {
              span.addEvent("dependency_graph.build.error", {
                "error.type": "missing_dependency",
                "handler.name": handlerName,
                "dependency.name": dependency,
              });
              throw new Error(
                `Handler "${handlerName}" depends on "${dependency}" which does not exist.`,
              );
            }
            inDegree.set(handlerName, (inDegree.get(handlerName) ?? 0) + 1);
            dependencies.get(dependency)!.push(handlerName);
            dependencyCount++;
          }
        }
        span.addEvent("dependency_graph.build.complete", {
          "dependency.count": dependencyCount,
        });

        span.setAttributes({
          "dependency.count": dependencyCount,
        });

        // Kahn's algorithm for topological sort
        // See: https://en.wikipedia.org/wiki/Topological_sorting#Kahn's_algorithm
        span.addEvent("topological_sort.start");
        const queue: string[] = [];
        const result: string[] = [];

        // Find all handlers with no dependencies
        for (const [handlerName, degree] of inDegree.entries()) {
          if (degree === 0) {
            queue.push(handlerName);
          }
        }

        // Process queue
        while (queue.length > 0) {
          const handlerName = queue.shift()!;
          result.push(handlerName);

          // Reduce in-degree of dependent handlers
          for (const dependent of dependencies.get(handlerName) ?? []) {
            const newDegree = (inDegree.get(dependent) ?? 0) - 1;
            inDegree.set(dependent, newDegree);
            if (newDegree === 0) {
              queue.push(dependent);
            }
          }
        }

        // Check for circular dependencies
        if (result.length !== handlerNames.length) {
          const remaining = handlerNames.filter(
            (name) => !result.includes(name),
          );
          span.addEvent("topological_sort.error", {
            "error.type": "circular_dependency",
            "remaining.handlers": remaining.join(","),
          });
          throw new Error(
            `Circular dependency detected in event handlers. Remaining handlers: ${remaining.join(
              ", ",
            )}`,
          );
        }

        const durationMs = Date.now() - startTime;
        span.addEvent("topological_sort.complete");
        span.setAttributes({
          "handler.execution_order": result.join(","),
          "sort.duration_ms": durationMs,
        });

        return result;
      },
    );
  }

  /**
   * Handles a single event with a handler and updates checkpoint on success.
   */
  private async handleEvent(
    handlerName: string,
    handlerDef: EventHandlerDefinition<EventType>,
    event: EventType,
    _context: EventStoreReadContext<EventType>,
  ): Promise<void> {
    await this.tracer.withActiveSpan(
      "EventSourcingService.handleEvent",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "handler.name": handlerName,
          "event.id": event.id,
          "event.aggregate_id": String(event.aggregateId),
          "event.timestamp": event.timestamp,
          "event.type": event.type,
          "event.tenant_id": event.tenantId,
        },
      },
      async () => {
        await handlerDef.handler.handle(event);

        if (this.eventHandlerCheckpointStore) {
          const eventId = this.createEventId(event);
          const aggregateId = String(event.aggregateId);
          const checkpoint: EventHandlerCheckpoint = {
            handlerName,
            tenantId: event.tenantId,
            aggregateType: this.aggregateType,
            lastProcessedAggregateId: aggregateId,
            lastProcessedTimestamp: event.timestamp,
            lastProcessedEventId: eventId,
          };

          try {
            await this.eventHandlerCheckpointStore.saveCheckpoint(
              handlerName,
              event.tenantId,
              this.aggregateType,
              aggregateId,
              checkpoint,
            );
          } catch (error) {
            this.logger?.error(
              {
                handlerName,
                aggregateId,
                eventId,
                error: error instanceof Error ? error.message : String(error),
              },
              "Failed to save checkpoint for event handler",
            );
          }
        }
      },
    );
  }

  /**
   * Gets the event types a handler is interested in.
   * Prefers options.eventTypes (explicit configuration) over handler.getEventTypes().
   * Returns undefined if handler should process all event types.
   */
  private getHandlerEventTypes(
    handlerDef: EventHandlerDefinition<EventType>,
  ): string[] | undefined {
    const { handler, options } = handlerDef;

    return options.eventTypes ?? handler.getEventTypes?.();
  }

  /**
   * Creates a unique identifier for an event.
   * Format: `${ksuid}:${aggregateId}:${timestamp}:${eventType}`
   */
  private createEventId(event: EventType): string {
    return `${EventUtils.generateEventId()}:${String(event.aggregateId)}:${event.timestamp}:${event.type}`;
  }

  /**
   * Updates a specific projection by name for a given aggregate.
   *
   * This method processes all events for the aggregate and updates the projection state.
   * Projections are automatically updated after events are stored via storeEvents(),
   * but this method can be used for manual updates (e.g., recovery or reprocessing).
   *
   * **Concurrency:** Uses distributed lock (if configured) to prevent concurrent updates of the same
   * aggregate projection. If lock acquisition fails, throws an error (caller should retry via queue).
   * Without a distributed lock, concurrent updates may result in lost updates (last write wins).
   *
   * **Performance:** O(n) where n is the number of events for the aggregate. Lock acquisition adds
   * network latency if using Redis-based locks.
   *
   * **Failure Modes:**
   * - Throws if projection name not found
   * - Throws if no events found for aggregate
   * - Throws if distributed lock cannot be acquired (if lock is configured)
   * - Throws if tenantId is invalid
   * - Projection store errors propagate (not caught)
   *
   * @param projectionName - The name of the projection to update
   * @param aggregateId - The aggregate to update projection for
   * @param context - Security context with required tenantId for event store access
   * @param options - Optional options including projection store context override
   * @returns The updated projection
   * @throws {Error} If projection name not found, no events found, lock acquisition fails, or tenantId is invalid
   */
  async updateProjectionByName<ProjectionName extends string>(
    projectionName: ProjectionName,
    aggregateId: string,
    context: EventStoreReadContext<EventType>,
    options?: UpdateProjectionOptions<EventType>,
  ): Promise<any> {
    if (!this.projections) {
      throw new Error(
        "EventSourcingService.updateProjectionByName requires multiple projections to be configured.",
      );
    }

    const projectionDef = this.projections.get(projectionName);
    if (!projectionDef) {
      const availableNames = Array.from(this.projections.keys()).join(", ");
      throw new Error(
        `Projection "${projectionName}" not found. Available projections: ${
          availableNames || "none"
        }`,
      );
    }

    return await this.tracer.withActiveSpan(
      "EventSourcingService.updateProjection",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "projection.name": projectionName,
          "aggregate.id": String(aggregateId),
          "tenant.id": context.tenantId,
        },
      },
      async (span) => {
        const lockKey = `update:${this.aggregateType}:${String(
          aggregateId,
        )}:${projectionName}`;
        const lockHandle = this.distributedLock
          ? await this.distributedLock.acquire(lockKey, this.updateLockTtlMs)
          : null;

        if (this.distributedLock && !lockHandle) {
          throw new Error(
            `Cannot acquire lock for projection update: ${lockKey}. Another process is updating this projection. Will retry.`,
          );
        }

        try {
          const startTime = Date.now();

          this.logger?.debug(
            {
              projectionName,
              aggregateId: String(aggregateId),
              tenantId: context.tenantId,
            },
            "Updating projection",
          );

          span.addEvent("event_store.fetch.start");
          const events = await this.eventStore.getEvents(
            aggregateId,
            context,
            this.aggregateType,
          );
          span.addEvent("event_store.fetch.complete", {
            "event.count": events.length,
          });

          if (events.length === 0) {
            throw new Error(
              `No events found for aggregate ${String(aggregateId)}`,
            );
          }

          const stream = this.createEventStream(
            aggregateId,
            context.tenantId,
            events,
          );
          const metadata = EventUtils.buildProjectionMetadata(stream);

          span.setAttributes({
            "event.count": metadata.eventCount,
            "event.first_timestamp": metadata.firstEventTimestamp ?? void 0,
            "event.last_timestamp": metadata.lastEventTimestamp ?? void 0,
          });

          this.logger?.debug(
            {
              projectionName,
              aggregateId: String(aggregateId),
              eventCount: metadata.eventCount,
            },
            "Loaded events for projection update",
          );

          span.addEvent("event_handler.handle.start");
          const projection = await projectionDef.handler.handle(stream);
          span.addEvent("event_handler.handle.complete");

          span.setAttributes({
            "projection.id": projection.id,
            "projection.version": projection.version,
          });

          const projectionContext = options?.projectionStoreContext ?? context;
          EventUtils.validateTenantId(
            projectionContext,
            "updateProjectionByName",
          );

          span.addEvent("projection_store.store.start");
          await projectionDef.store.storeProjection(
            projection,
            projectionContext,
          );
          span.addEvent("projection_store.store.complete");

          const durationMs = Date.now() - startTime;

          this.logger?.debug(
            {
              projectionName,
              aggregateId: String(aggregateId),
              projectionId: projection.id,
              projectionVersion: projection.version,
              eventCount: metadata.eventCount,
              durationMs,
            },
            "Projection update completed",
          );

          return projection;
        } finally {
          if (lockHandle) {
            try {
              await this.distributedLock!.release(lockHandle);
            } catch (error) {
              // Update already completed successfully; lock release failure is non-critical
              this.logger?.error(
                {
                  projectionName,
                  aggregateId: String(aggregateId),
                  tenantId: context.tenantId,
                  error: error instanceof Error ? error.message : String(error),
                },
                "Failed to release distributed lock after projection update",
              );
            }
          }
        }
      },
    );
  }

  /**
   * Updates all registered projections for aggregates affected by the given events.
   *
   * Groups events by aggregateId and updates each projection for each affected aggregate.
   * Each projection update uses distributed locking (if configured) to prevent concurrent updates.
   *
   * **Concurrency:** Projection updates for different aggregates run concurrently.
   * Updates for the same aggregate are serialized via distributed lock (if configured).
   *
   * **Failure Modes:**
   * - Errors in individual projection updates are logged but don't fail the operation
   * - Lock acquisition failures throw (but are caught and logged at this level)
   */
  private async updateProjectionsForAggregates(
    events: readonly EventType[],
    context: EventStoreReadContext<EventType>,
  ): Promise<void> {
    if (!this.projections || this.projections.size === 0) {
      return;
    }

    return await this.tracer.withActiveSpan(
      "EventSourcingService.updateProjectionsForAggregates",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "aggregate.type": this.aggregateType,
          "event.count": events.length,
          "tenant.id": context.tenantId,
          "projection.count": this.projections.size,
        },
      },
      async (span) => {
        const eventsByAggregate = new Map<string, EventType[]>();
        for (const event of events) {
          const aggregateId = String(event.aggregateId);
          if (!eventsByAggregate.has(aggregateId)) {
            eventsByAggregate.set(aggregateId, []);
          }
          eventsByAggregate.get(aggregateId)!.push(event);
        }

        span.setAttributes({
          "aggregate.count": eventsByAggregate.size,
        });

        for (const aggregateId of eventsByAggregate.keys()) {
          for (const projectionName of this.projections!.keys()) {
            try {
              span.addEvent("projection.update.aggregate.start", {
                "projection.name": projectionName,
                "aggregate.id": aggregateId,
              });
              await this.updateProjectionByName(
                projectionName,
                aggregateId,
                context,
              );
              span.addEvent("projection.update.aggregate.complete", {
                "projection.name": projectionName,
                "aggregate.id": aggregateId,
              });
            } catch (error) {
              span.addEvent("projection.update.aggregate.error", {
                "projection.name": projectionName,
                "aggregate.id": aggregateId,
                "error.message":
                  error instanceof Error ? error.message : String(error),
              });
              if (this.logger) {
                this.logger.error(
                  {
                    projectionName,
                    aggregateId,
                    tenantId: context.tenantId,
                    error:
                      error instanceof Error ? error.message : String(error),
                  },
                  "Failed to update projection after storing events",
                );
              }
            }
          }
        }
      },
    );
  }

  /**
   * Gets a specific projection by name for a given aggregate.
   *
   * @param projectionName - The name of the projection to retrieve
   * @param aggregateId - The aggregate to get projection for
   * @param context - Security context with required tenantId
   * @returns The projection, or null if not found
   * @throws Error if projection name not found or not configured
   */
  async getProjectionByName<ProjectionName extends string>(
    projectionName: ProjectionName,
    aggregateId: string,
    context: EventStoreReadContext<EventType>,
  ): Promise<unknown> {
    if (!this.projections) {
      throw new Error(
        "EventSourcingService.getProjectionByName requires multiple projections to be configured. Use getProjection for single projection pipelines.",
      );
    }

    const projectionDef = this.projections.get(projectionName);
    if (!projectionDef) {
      const availableNames = Array.from(this.projections.keys()).join(", ");
      throw new Error(
        `Projection "${projectionName}" not found. Available projections: ${
          availableNames || "none"
        }`,
      );
    }

    return await this.tracer.withActiveSpan(
      "EventSourcingService.getProjectionByName",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "aggregate.type": this.aggregateType,
          "projection.name": projectionName,
          "aggregate.id": aggregateId,
          "tenant.id": context.tenantId,
        },
      },
      async () => {
        const projectionContext = context;
        EventUtils.validateTenantId(projectionContext, "getProjectionByName");

        return await projectionDef.store.getProjection(
          aggregateId,
          projectionContext,
        );
      },
    );
  }

  /**
   * Checks if a specific projection exists for a given aggregate.
   *
   * @param projectionName - The name of the projection to check
   * @param aggregateId - The aggregate to check projection for
   * @param context - Security context with required tenantId
   * @returns True if the projection exists, false otherwise
   * @throws Error if projection name not found or not configured
   */
  async hasProjectionByName<ProjectionName extends string>(
    projectionName: ProjectionName,
    aggregateId: string,
    context: EventStoreReadContext<EventType>,
  ): Promise<boolean> {
    if (!this.projections) {
      throw new Error(
        "EventSourcingService.hasProjectionByName requires multiple projections to be configured. Use hasProjection for single projection pipelines.",
      );
    }

    const projectionDef = this.projections.get(projectionName);
    if (!projectionDef) {
      const availableNames = Array.from(this.projections.keys()).join(", ");
      throw new Error(
        `Projection "${projectionName}" not found. Available projections: ${
          availableNames || "none"
        }`,
      );
    }

    return await this.tracer.withActiveSpan(
      "EventSourcingService.hasProjectionByName",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "aggregate.type": this.aggregateType,
          "projection.name": projectionName,
          "aggregate.id": aggregateId,
          "tenant.id": context.tenantId,
        },
      },
      async (span) => {
        const projectionContext = context;
        EventUtils.validateTenantId(projectionContext, "hasProjectionByName");

        const projection = await projectionDef.store.getProjection(
          aggregateId,
          projectionContext,
        );
        const exists = projection !== null;
        span.setAttributes({
          "projection.exists": exists,
        });
        return exists;
      },
    );
  }

  /**
   * Gets the list of available projection names.
   *
   * @returns Array of projection names
   */
  getProjectionNames(): string[] {
    if (!this.projections) {
      return [];
    }
    return Array.from(this.projections.keys());
  }

  /**
   * Replays events up to a specific timestamp (time travel) for a specific projection.
   *
   * This allows updating projections as they existed at a point in time.
   *
   * **Status:** Not implemented - always throws "Not implemented" error.
   *
   * **Intended Behavior (when implemented):**
   * - Filters events by timestamp (upToTimestamp)
   * - Rebuilds projection from filtered events
   * - Returns projection as it would have existed at that point in time
   *
   * @param projectionName - Name of the projection to replay
   * @param aggregateId - The aggregate to replay events for
   * @param context - Security context with required tenantId for event store access
   * @param options - Options including upToTimestamp and projection store context
   * @returns The projection as it would have existed at the specified timestamp
   * @throws {Error} Always throws "Not implemented" error
   *
   * @example
   * ```typescript
   * // Replay events up to a specific point in time
   * const projection = await service.replayEvents("trace-summary", "trace-123", context, {
   *   upToTimestamp: Date.parse("2024-01-15T10:00:00Z"),
   * });
   * ```
   */
  async replayEvents<ProjectionName extends string>(
    _projectionName: ProjectionName,
    _aggregateId: string,
    _context: EventStoreReadContext<EventType>,
    _options?: ReplayEventsOptions<EventType>,
  ): Promise<any> {
    throw new Error("Not implemented");
  }

  /**
   * Replays events for a specific event handler.
   *
   * Useful for reprocessing events after handler changes or recovering from failures.
   *
   * **Status:** Not implemented - always throws "Not implemented" error.
   *
   * **Intended Behavior (when implemented):**
   * - Fetches events for the aggregate (optionally from a specific event ID)
   * - Re-executes the handler for each event
   * - Updates checkpoints after successful processing
   *
   * @param handlerName - Name of the handler to replay events for
   * @param aggregateId - The aggregate to replay events for
   * @param context - Security context with required tenantId
   * @param options - Options including fromEventId to start from a specific event
   * @returns Promise that resolves when replay is complete
   * @throws {Error} Always throws "Not implemented" error
   *
   * @example
   * ```typescript
   * // Replay all events for a handler
   * await service.replayEventsForHandler("clickhouse-writer", "trace-123", context);
   *
   * // Replay from a specific event ID
   * await service.replayEventsForHandler("clickhouse-writer", "trace-123", context, {
   *   fromEventId: "trace-123:1234567890:lw.obs.span.ingestion.recorded"
   * });
   * ```
   */
  async replayEventsForHandler(
    _handlerName: string,
    _aggregateId: string,
    _context: EventStoreReadContext<EventType>,
    _options?: {
      fromEventId?: string;
    },
  ): Promise<void> {
    throw new Error("Not implemented");
  }

  private createEventStream(
    aggregateId: string,
    tenantId: TenantId,
    events: readonly EventType[],
  ): EventStream<TenantId, EventType> {
    return EventUtils.createEventStream(
      aggregateId,
      tenantId,
      events,
      this.options.ordering ?? "timestamp",
    );
  }

  /**
   * Gracefully closes all queue processors for event handlers.
   * Should be called during application shutdown to ensure all queued jobs complete.
   */
  async close(): Promise<void> {
    const closePromises: Promise<void>[] = [];

    for (const [
      handlerName,
      queueProcessor,
    ] of this.handlerQueueProcessors.entries()) {
      this.logger?.debug(
        { handlerName },
        "Closing queue processor for event handler",
      );
      closePromises.push(queueProcessor.close());
    }

    await Promise.allSettled(closePromises);

    this.logger?.debug(
      { handlerCount: this.handlerQueueProcessors.size },
      "All event handler queue processors closed",
    );
  }
}
