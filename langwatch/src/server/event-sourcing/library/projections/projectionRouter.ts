import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import type { FeatureFlagServiceInterface } from "~/server/featureFlag/types";
import { createLogger } from "~/utils/logger/server";
import type { AggregateType } from "../domain/aggregateType";
import type { TenantId } from "../domain/tenantId";
import type { Event, Projection } from "../domain/types";
import type { EventSourcedQueueProcessor } from "../queues";
import type { CheckpointStore } from "../stores/checkpointStore.types";
import type {
  EventStore,
  EventStoreReadContext,
} from "../stores/eventStore.types";
import type {
  ProjectionStore,
  ProjectionStoreReadContext,
} from "../stores/projectionStore.types";
import { EventUtils } from "../utils/event.utils";
import { isComponentDisabled } from "../utils/killSwitch";
import type { ProjectionBatchProcessor } from "../services/batch/projectionBatchProcessor";
import { saveCheckpointSafely } from "../services/checkpoints/saveCheckpointSafely";
import {
  ConfigurationError,
  categorizeError,
  handleError,
  isNoEventsFoundError,
  NoEventsFoundError,
} from "../services/errorHandling";
import type { ProjectionValidator } from "../services/validation/projectionValidator";
import type { QueueManager } from "../services/queues/queueManager";
import type { FoldProjectionDefinition } from "./foldProjection.types";
import { FoldProjectionExecutor } from "./foldProjectionExecutor";
import type { MapProjectionDefinition } from "./mapProjection.types";
import { MapProjectionExecutor } from "./mapProjectionExecutor";
import type { ProjectionStoreContext } from "./projectionStoreContext";

/**
 * Central router that registers fold and map projections and dispatches events.
 *
 * Replaces both ProjectionUpdater.updateProjectionsForAggregates() and
 * EventHandlerDispatcher.dispatchEventsToHandlers(). Provides a unified
 * dispatch path for all projections.
 *
 * - FoldProjections: enqueued to GroupQueue (per-aggregate ordering)
 * - MapProjections: enqueued to SimpleQueue (per-event, no ordering)
 */
export class ProjectionRouter<
  EventType extends Event = Event,
  ProjectionTypes extends Record<string, Projection> = Record<string, Projection>,
> {
  private readonly tracer = getLangWatchTracer(
    "langwatch.event-sourcing.projection-router",
  );
  private readonly logger = createLogger(
    "langwatch:event-sourcing:projection-router",
  );
  private readonly foldExecutor = new FoldProjectionExecutor();
  private readonly mapExecutor = new MapProjectionExecutor();

  private readonly foldProjections = new Map<string, FoldProjectionDefinition<any, EventType>>();
  private readonly mapProjections = new Map<string, MapProjectionDefinition<any, EventType>>();

  constructor(
    private readonly aggregateType: AggregateType,
    private readonly eventStore: EventStore<EventType>,
    private readonly pipelineName: string,
    private readonly queueManager: QueueManager<EventType>,
    private readonly checkpointStore?: CheckpointStore,
    private readonly featureFlagService?: FeatureFlagServiceInterface,
    private readonly validator?: ProjectionValidator<EventType>,
    private readonly ordering: "timestamp" | "as-is" = "timestamp",
  ) {}

  registerFoldProjection(projection: FoldProjectionDefinition<any, EventType>): void {
    if (this.foldProjections.has(projection.name)) {
      throw new ConfigurationError(
        "ProjectionRouter",
        `Fold projection with name "${projection.name}" already registered`,
        { projectionName: projection.name },
      );
    }
    this.foldProjections.set(projection.name, projection);
  }

  registerMapProjection(projection: MapProjectionDefinition<any, EventType>): void {
    if (this.mapProjections.has(projection.name)) {
      throw new ConfigurationError(
        "ProjectionRouter",
        `Map projection with name "${projection.name}" already registered`,
        { projectionName: projection.name },
      );
    }
    this.mapProjections.set(projection.name, projection);
  }

  /**
   * Initialize queue processors for fold projections.
   * Wires each fold projection's queue to route through batch processing (if available)
   * or single-event processing.
   */
  initializeFoldQueues(
    batchProcessor?: ProjectionBatchProcessor<EventType>,
  ): void {
    if (this.foldProjections.size === 0) return;

    // Build a ProjectionDefinition-like object for QueueManager compatibility
    const projectionDefs: Record<string, {
      name: string;
      store: ProjectionStore<any>;
      handler: { handle: (stream: any) => any };
      options?: any;
    }> = {};

    for (const [name, fold] of this.foldProjections) {
      projectionDefs[name] = {
        name,
        // Wrap FoldProjectionStore as a legacy ProjectionStore for QueueManager
        store: this.wrapFoldStoreAsProjectionStore(fold),
        handler: { handle: () => null }, // placeholder, not used in new path
        options: fold.options,
      };
    }

    this.queueManager.initializeProjectionQueues(
      projectionDefs,
      async (projectionName, triggerEvent, _context) => {
        const fold = this.foldProjections.get(projectionName);
        if (!fold) {
          throw new ConfigurationError(
            "ProjectionRouter",
            `Fold projection "${projectionName}" not found`,
            { projectionName },
          );
        }

        if (batchProcessor) {
          await batchProcessor.processUnprocessedEvents(
            triggerEvent,
            projectionName,
            "projection",
            async (event, sequenceNumber, context) => {
              await this.processFoldProjectionEvent(
                projectionName,
                fold,
                event,
                context,
                { sequenceNumber },
              );
            },
          );
        } else {
          await this.processFoldProjectionEvent(
            projectionName,
            fold,
            triggerEvent,
            { tenantId: triggerEvent.tenantId },
          );
        }
      },
    );
  }

  /**
   * Initialize queue processors for map projections.
   */
  initializeMapQueues(): void {
    if (this.mapProjections.size === 0) return;

    const handlerDefs: Record<string, {
      name: string;
      handler: { handle: (event: EventType) => Promise<void> };
      options: any;
    }> = {};

    for (const [name, mapProj] of this.mapProjections) {
      handlerDefs[name] = {
        name,
        handler: {
          handle: async (event: EventType) => {
            const context: ProjectionStoreContext = {
              aggregateId: String(event.aggregateId),
              tenantId: event.tenantId,
            };
            await this.mapExecutor.execute(mapProj, event, context);
          },
        },
        options: {
          eventTypes: mapProj.eventTypes as readonly string[],
          killSwitch: mapProj.options?.killSwitch,
          concurrency: mapProj.options?.concurrency,
          disabled: mapProj.options?.disabled,
        },
      };
    }

    this.queueManager.initializeHandlerQueues(
      handlerDefs,
      async (handlerName, event, _context) => {
        const handlerDef = handlerDefs[handlerName];
        if (!handlerDef) {
          throw new ConfigurationError(
            "ProjectionRouter",
            `Map projection handler "${handlerName}" not found`,
            { handlerName },
          );
        }
        await handlerDef.handler.handle(event);
      },
    );
  }

  /**
   * Dispatches events to all matching fold and map projections.
   */
  async dispatch(
    events: readonly EventType[],
    context: EventStoreReadContext<EventType>,
  ): Promise<void> {
    return await this.tracer.withActiveSpan(
      "ProjectionRouter.dispatch",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "aggregate.type": this.aggregateType,
          "event.count": events.length,
          "tenant.id": context.tenantId,
          "fold.count": this.foldProjections.size,
          "map.count": this.mapProjections.size,
        },
      },
      async () => {
        EventUtils.validateTenantId(context, "ProjectionRouter.dispatch");

        // Dispatch to fold projections
        if (this.foldProjections.size > 0) {
          await this.dispatchToFoldProjections(events, context);
        }

        // Dispatch to map projections
        if (this.mapProjections.size > 0) {
          await this.dispatchToMapProjections(events, context);
        }
      },
    );
  }

  private async dispatchToFoldProjections(
    events: readonly EventType[],
    context: EventStoreReadContext<EventType>,
  ): Promise<void> {
    const hasProjectionQueues = this.queueManager.hasProjectionQueues();

    if (hasProjectionQueues) {
      // Async dispatch via queues
      for (const event of events) {
        for (const projectionName of this.foldProjections.keys()) {
          // Check for prior failures
          if (this.checkpointStore) {
            const hasFailures = await this.checkpointStore.hasFailedEvents(
              this.pipelineName,
              projectionName,
              "projection",
              event.tenantId,
              this.aggregateType,
              String(event.aggregateId),
            );
            if (hasFailures) {
              this.logger.warn(
                {
                  projectionName,
                  eventId: event.id,
                  aggregateId: String(event.aggregateId),
                },
                "Skipping fold dispatch due to previous failures",
              );
              continue;
            }
          }

          const queueProcessor = this.queueManager.getProjectionQueue(projectionName);
          if (queueProcessor) {
            try {
              await queueProcessor.send(event);
            } catch (error) {
              this.logger.error(
                {
                  projectionName,
                  eventId: event.id,
                  error: error instanceof Error ? error.message : String(error),
                },
                "Failed to dispatch event to fold projection queue",
              );
            }
          }
        }
      }
    } else {
      // Inline sync processing
      const eventsByAggregate = new Map<string, EventType[]>();
      for (const event of events) {
        const aggregateId = String(event.aggregateId);
        if (!eventsByAggregate.has(aggregateId)) {
          eventsByAggregate.set(aggregateId, []);
        }
        eventsByAggregate.get(aggregateId)!.push(event);
      }

      for (const aggregateId of eventsByAggregate.keys()) {
        const eventsForAggregate = eventsByAggregate.get(aggregateId)!;
        for (const event of eventsForAggregate) {
          for (const [projectionName, fold] of this.foldProjections) {
            try {
              await this.processFoldProjectionEvent(
                projectionName,
                fold,
                event,
                context,
              );
            } catch (error) {
              const category = categorizeError(error);
              handleError(error, category, this.logger, {
                projectionName,
                aggregateId,
                tenantId: context.tenantId,
              });
            }
          }
        }
      }
    }
  }

  private async dispatchToMapProjections(
    events: readonly EventType[],
    context: EventStoreReadContext<EventType>,
  ): Promise<void> {
    const hasHandlerQueues = this.queueManager.hasHandlerQueues();

    if (hasHandlerQueues) {
      // Async dispatch via queues
      for (const event of events) {
        for (const [name, mapProj] of this.mapProjections) {
          if (mapProj.options?.disabled) continue;

          const disabled = await isComponentDisabled({
            featureFlagService: this.featureFlagService,
            aggregateType: this.aggregateType,
            componentType: "eventHandler",
            componentName: name,
            tenantId: event.tenantId,
            customKey: mapProj.options?.killSwitch?.customKey,
            logger: this.logger,
          });
          if (disabled) continue;

          // Filter by event type
          if (mapProj.eventTypes.length > 0 && !mapProj.eventTypes.includes(event.type)) {
            continue;
          }

          const queueProcessor = this.queueManager.getHandlerQueue(name);
          if (queueProcessor) {
            try {
              await queueProcessor.send(event);
            } catch (error) {
              this.logger.error(
                {
                  handlerName: name,
                  eventId: event.id,
                  error: error instanceof Error ? error.message : String(error),
                },
                "Failed to dispatch event to map projection queue",
              );
            }
          }
        }
      }
    } else {
      // Inline sync processing
      for (const event of events) {
        for (const [name, mapProj] of this.mapProjections) {
          if (mapProj.options?.disabled) continue;

          const disabled = await isComponentDisabled({
            featureFlagService: this.featureFlagService,
            aggregateType: this.aggregateType,
            componentType: "eventHandler",
            componentName: name,
            tenantId: event.tenantId,
            customKey: mapProj.options?.killSwitch?.customKey,
            logger: this.logger,
          });
          if (disabled) continue;

          if (mapProj.eventTypes.length > 0 && !mapProj.eventTypes.includes(event.type)) {
            continue;
          }

          try {
            const storeContext: ProjectionStoreContext = {
              aggregateId: String(event.aggregateId),
              tenantId: event.tenantId,
            };
            await this.mapExecutor.execute(mapProj, event, storeContext);
          } catch (error) {
            handleError(error, categorizeError(error), this.logger, {
              handlerName: name,
              eventType: event.type,
              aggregateId: String(event.aggregateId),
              tenantId: event.tenantId,
            });
          }
        }
      }
    }
  }

  /**
   * Processes a single event for a fold projection.
   * Implements per-event checkpointing with failure detection.
   */
  private async processFoldProjectionEvent(
    projectionName: string,
    fold: FoldProjectionDefinition<any, EventType>,
    event: EventType,
    context: EventStoreReadContext<EventType>,
    options?: { sequenceNumber?: number },
  ): Promise<void> {
    await this.tracer.withActiveSpan(
      "ProjectionRouter.processFoldProjectionEvent",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "projection.name": projectionName,
          "event.id": event.id,
          "event.type": event.type,
          "event.aggregate_id": String(event.aggregateId),
        },
      },
      async () => {
        EventUtils.validateTenantId(context, "processFoldProjectionEvent");

        let sequenceNumber: number;
        let allEvents: readonly EventType[] | undefined;

        if (options?.sequenceNumber !== undefined) {
          sequenceNumber = options.sequenceNumber;
        } else {
          // Sync path: check kill switch and validate
          const disabled = await isComponentDisabled({
            featureFlagService: this.featureFlagService,
            aggregateType: this.aggregateType,
            componentType: "projection",
            componentName: projectionName,
            tenantId: event.tenantId,
            customKey: fold.options?.killSwitch?.customKey,
            logger: this.logger,
          });
          if (disabled) return;

          allEvents = await this.eventStore.getEvents(
            String(event.aggregateId),
            context,
            this.aggregateType,
          );

          if (this.validator) {
            const validated = await this.validator.validateEventProcessing(
              projectionName,
              "projection",
              event,
              context,
              { events: allEvents },
            );

            if (validated === null) {
              this.logger.debug(
                { projectionName, eventId: event.id },
                "Skipping fold processing (already processed or has failures)",
              );
              return;
            }
            sequenceNumber = validated;
          } else {
            sequenceNumber = 0;
          }
        }

        // Checkpoint lifecycle: pending → fold execution → processed/failed
        try {
          await saveCheckpointSafely({
            checkpointStore: this.checkpointStore,
            pipelineName: this.pipelineName,
            componentName: projectionName,
            componentType: "projection",
            event,
            status: "pending",
            sequenceNumber,
          });

          if (!allEvents) {
            allEvents = await this.eventStore.getEvents(
              String(event.aggregateId),
              context,
              this.aggregateType,
            );
          }

          if (allEvents.length === 0) {
            throw new NoEventsFoundError(
              String(event.aggregateId),
              context.tenantId,
              { projectionName },
            );
          }

          const storeContext: ProjectionStoreContext = {
            aggregateId: String(event.aggregateId),
            tenantId: event.tenantId,
          };

          await this.foldExecutor.execute(fold, allEvents, storeContext);

          await saveCheckpointSafely({
            checkpointStore: this.checkpointStore,
            pipelineName: this.pipelineName,
            componentName: projectionName,
            componentType: "projection",
            event,
            status: "processed",
            sequenceNumber,
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          const isNoEvents = isNoEventsFoundError(error);

          if (isNoEvents) {
            this.logger.debug(
              { projectionName, eventId: event.id },
              "Fold projection processing delayed; events not yet visible, will retry",
            );
          } else {
            await saveCheckpointSafely({
              checkpointStore: this.checkpointStore,
              pipelineName: this.pipelineName,
              componentName: projectionName,
              componentType: "projection",
              event,
              status: "failed",
              sequenceNumber,
              errorMessage,
            });

            this.logger.error(
              { projectionName, eventId: event.id, error: errorMessage },
              "Failed to process fold projection event",
            );
          }

          throw error;
        }
      },
    );
  }

  // --- Delegation methods used by EventSourcingService ---

  /**
   * Updates a fold projection by name for a given aggregate.
   * Used for manual updates (recovery, reprocessing).
   */
  async updateProjectionByName<ProjectionName extends keyof ProjectionTypes & string>(
    projectionName: ProjectionName,
    aggregateId: string,
    context: EventStoreReadContext<EventType>,
    options?: { events?: readonly EventType[]; projectionStoreContext?: ProjectionStoreReadContext },
  ): Promise<{ projection: ProjectionTypes[ProjectionName]; events: readonly EventType[] } | null> {
    EventUtils.validateTenantId(context, "updateProjectionByName");

    const fold = this.foldProjections.get(projectionName);
    if (!fold) {
      const availableNames = Array.from(this.foldProjections.keys()).join(", ");
      throw new ConfigurationError(
        "ProjectionRouter",
        `Fold projection "${projectionName}" not found. Available: ${availableNames || "none"}`,
        { projectionName },
      );
    }

    let events: readonly EventType[];
    if (options?.events) {
      events = options.events;
    } else {
      events = await this.eventStore.getEvents(
        aggregateId,
        context,
        this.aggregateType,
      );
    }

    if (events.length === 0) {
      throw new NoEventsFoundError(
        aggregateId,
        context.tenantId,
        { projectionName },
      );
    }

    const storeContext: ProjectionStoreContext = {
      aggregateId,
      tenantId: context.tenantId,
    };

    const state = await this.foldExecutor.execute(fold, events, storeContext);

    if (state === null) {
      return null;
    }

    // Build a Projection-shaped result for backward compatibility
    const projection = {
      id: `${projectionName}:${context.tenantId}:${aggregateId}`,
      aggregateId,
      tenantId: context.tenantId,
      version: new Date().toISOString().split("T")[0]!,
      data: state,
    } as ProjectionTypes[ProjectionName];

    return { projection, events };
  }

  /**
   * Gets a fold projection by name for a given aggregate.
   */
  async getProjectionByName<ProjectionName extends keyof ProjectionTypes & string>(
    projectionName: ProjectionName,
    aggregateId: string,
    context: EventStoreReadContext<EventType>,
  ): Promise<ProjectionTypes[ProjectionName] | null> {
    EventUtils.validateTenantId(context, "getProjectionByName");

    const fold = this.foldProjections.get(projectionName);
    if (!fold) {
      const availableNames = Array.from(this.foldProjections.keys()).join(", ");
      throw new ConfigurationError(
        "ProjectionRouter",
        `Fold projection "${projectionName}" not found. Available: ${availableNames || "none"}`,
        { projectionName },
      );
    }

    const storeContext: ProjectionStoreContext = {
      aggregateId,
      tenantId: context.tenantId,
    };

    const state = await fold.store.get(aggregateId, storeContext);
    if (state === null) return null;

    return {
      id: `${projectionName}:${context.tenantId}:${aggregateId}`,
      aggregateId,
      tenantId: context.tenantId,
      version: new Date().toISOString().split("T")[0]!,
      data: state,
    } as ProjectionTypes[ProjectionName];
  }

  /**
   * Checks if a fold projection exists for a given aggregate.
   */
  async hasProjectionByName<ProjectionName extends keyof ProjectionTypes & string>(
    projectionName: ProjectionName,
    aggregateId: string,
    context: EventStoreReadContext<EventType>,
  ): Promise<boolean> {
    const projection = await this.getProjectionByName(projectionName, aggregateId, context);
    return projection !== null;
  }

  /**
   * Gets the list of registered fold projection names.
   */
  getProjectionNames(): string[] {
    return Array.from(this.foldProjections.keys());
  }

  get hasFoldProjections(): boolean {
    return this.foldProjections.size > 0;
  }

  get hasMapProjections(): boolean {
    return this.mapProjections.size > 0;
  }

  /**
   * Wraps a FoldProjectionStore as a legacy ProjectionStore for QueueManager compatibility.
   */
  private wrapFoldStoreAsProjectionStore(
    fold: FoldProjectionDefinition<any, EventType>,
  ): ProjectionStore<any> {
    return {
      getProjection: async (aggregateId: string, context: ProjectionStoreReadContext) => {
        const storeContext: ProjectionStoreContext = {
          aggregateId,
          tenantId: context.tenantId,
        };
        const state = await fold.store.get(aggregateId, storeContext);
        if (state === null) return null;
        return {
          id: `${fold.name}:${context.tenantId}:${aggregateId}`,
          aggregateId,
          tenantId: context.tenantId,
          version: new Date().toISOString().split("T")[0]!,
          data: state,
        };
      },
      storeProjection: async (projection: any, context: ProjectionStoreReadContext) => {
        const storeContext: ProjectionStoreContext = {
          aggregateId: projection.aggregateId,
          tenantId: context.tenantId,
        };
        await fold.store.store(projection.data, storeContext);
      },
    };
  }
}
