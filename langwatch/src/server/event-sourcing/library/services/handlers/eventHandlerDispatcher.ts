import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { createLogger } from "~/utils/logger/server";
import type { FeatureFlagServiceInterface } from "../../../../featureFlag/types";
import type { AggregateType } from "../../domain/aggregateType";
import type { Event } from "../../domain/types";
import type { EventHandlerDefinition } from "../../eventHandler.types";
import type { EventStoreReadContext } from "../../stores/eventStore.types";
import { isComponentDisabled } from "../../utils/killSwitch";
import {
  ErrorCategory,
  handleError,
} from "../errorHandling";
import type { QueueProcessorManager } from "../queues/queueProcessorManager";

/**
 * Dispatches events to registered event handlers.
 * Handles both synchronous and asynchronous (queue-based) dispatch modes.
 */
export class EventHandlerDispatcher<EventType extends Event = Event> {
  private readonly tracer = getLangWatchTracer(
    "langwatch.trace-processing.event-handler-dispatcher",
  );
  private readonly logger = createLogger(
    "langwatch:event-sourcing:event-handler-dispatcher",
  );
  private readonly aggregateType: AggregateType;
  private readonly eventHandlers?: Map<
    string,
    EventHandlerDefinition<EventType>
  >;
  private readonly queueManager: QueueProcessorManager<EventType>;
  private readonly featureFlagService?: FeatureFlagServiceInterface;

  constructor({
    aggregateType,
    eventHandlers,
    queueManager,
    featureFlagService,
  }: {
    aggregateType: AggregateType;
    eventHandlers?: Map<string, EventHandlerDefinition<EventType>>;
    queueManager: QueueProcessorManager<EventType>;
    featureFlagService?: FeatureFlagServiceInterface;
  }) {
    this.aggregateType = aggregateType;
    this.eventHandlers = eventHandlers;
    this.queueManager = queueManager;
    this.featureFlagService = featureFlagService;
  }

  /**
   * Dispatches events to registered event handlers.
   *
   * If queue processors are available, events are dispatched asynchronously via queues.
   * Otherwise, handlers are executed synchronously (fallback for backwards compatibility).
   *
   * **Concurrency:** Handlers are processed in registration order.
   * With queues, handlers process events concurrently up to their concurrency limits.
   * Without queues, handlers execute sequentially per event.
   *
   * **Failure Modes:**
   * - Handler errors are logged but don't fail the dispatch operation
   * - Queue dispatch errors are logged but don't fail (queue processor handles retries)
   * - Dependent handlers still execute even if a dependency fails (they should handle missing data gracefully)
   */
  async dispatchEventsToHandlers(
    events: readonly EventType[],
    context: EventStoreReadContext<EventType>,
  ): Promise<void> {
    if (!this.eventHandlers || this.eventHandlers.size === 0) {
      return;
    }

    return await this.tracer.withActiveSpan(
      "EventHandlerDispatcher.dispatchEventsToHandlers",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "aggregate.type": this.aggregateType,
          "event.count": events.length,
          "tenant.id": context.tenantId,
          "handler.count": this.eventHandlers.size,
          "dispatch.mode":
            this.queueManager.getHandlerQueueProcessors().size > 0
              ? "async"
              : "sync",
        },
      },
      async () => {
        // If queue processors are available, use async queue-based dispatch
        if (this.queueManager.getHandlerQueueProcessors().size > 0) {
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
      "EventHandlerDispatcher.dispatchEventsToQueues",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "aggregate.type": this.aggregateType,
          "event.count": events.length,
          "handler.count": this.queueManager.getHandlerQueueProcessors().size,
        },
      },
      async (span) => {
        const sortedHandlers = this.getHandlerNames();

        // Dispatch events to queues in registration order (actual processing order maintained by queue workers)
        for (const event of events) {
          for (const handlerName of sortedHandlers) {
            const handlerDef = this.eventHandlers?.get(handlerName);
            if (!handlerDef) {
              continue;
            }

            // Check kill switch - if enabled, skip event handler processing
            const disabled = await isComponentDisabled({
              featureFlagService: this.featureFlagService,
              aggregateType: this.aggregateType,
              componentType: "eventHandler",
              componentName: handlerName,
              tenantId: event.tenantId,
              customKey: handlerDef.options.killSwitch?.customKey,
              logger: this.logger,
            });
            if (disabled) {
              continue; // Skip this handler
            }

            // Get event types this handler is interested in
            const handlerEventTypes = this.getHandlerEventTypes(handlerDef);

            // Filter by event type if handler specifies event types
            if (handlerEventTypes && handlerEventTypes.length > 0) {
              if (!handlerEventTypes.includes(event.type)) {
                continue;
              }
            }

            const queueProcessor =
              this.queueManager.getHandlerQueueProcessor(handlerName);
            if (!queueProcessor) {
              this.logger.warn(
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
      "EventHandlerDispatcher.dispatchEventsSynchronously",
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
        const sortedHandlers = this.getHandlerNames();

        for (const event of events) {
          for (const handlerName of sortedHandlers) {
            const handlerDef = this.eventHandlers?.get(handlerName);
            if (!handlerDef) {
              continue;
            }

            // Check kill switch - if enabled, skip event handler processing
            const disabled = await isComponentDisabled({
              featureFlagService: this.featureFlagService,
              aggregateType: this.aggregateType,
              componentType: "eventHandler",
              componentName: handlerName,
              tenantId: event.tenantId,
              customKey: handlerDef.options.killSwitch?.customKey,
              logger: this.logger,
            });
            if (disabled) {
              continue; // Skip this handler
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

              // Handler errors are non-critical - log but continue processing
              handleError(error, ErrorCategory.NON_CRITICAL, this.logger, {
                handlerName,
                eventType: event.type,
                aggregateId: String(event.aggregateId),
                tenantId: event.tenantId,
              });
            }
          }
        }
      },
    );
  }

  /**
   * Gets handler names in registration order.
   *
   * @returns Handler names in registration order
   */
  private getHandlerNames(): string[] {
    if (!this.eventHandlers || this.eventHandlers.size === 0) {
      return [];
    }
    return Array.from(this.eventHandlers.entries())
      .filter(([, handlerDef]) => !handlerDef.options.disabled)
      .map(([name]) => name);
  }

  /**
   * Handles a single event with a handler (synchronous fallback mode).
   * No checkpoints or validation - just calls the handler with OTel span.
   */
  async handleEvent(
    handlerName: string,
    handlerDef: EventHandlerDefinition<EventType>,
    event: EventType,
    _context: EventStoreReadContext<EventType>,
  ): Promise<void> {
    await this.tracer.withActiveSpan(
      "EventHandlerDispatcher.handleEvent",
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
  ): readonly EventType["type"][] | undefined {
    const { handler, options } = handlerDef;

    return options.eventTypes ?? handler.getEventTypes?.();
  }
}
