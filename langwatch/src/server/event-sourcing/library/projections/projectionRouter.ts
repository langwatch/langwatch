import { SpanKind } from "@opentelemetry/api";
import type IORedis from "ioredis";
import type { Cluster } from "ioredis";
import { getLangWatchTracer } from "langwatch";
import type { FeatureFlagServiceInterface } from "~/server/featureFlag/types";
import { createLogger } from "~/utils/logger/server";
import type { AggregateType } from "../domain/aggregateType";
import type { Event, Projection } from "../domain/types";
import type {
  EventStoreReadContext,
} from "../stores/eventStore.types";
import { EventUtils } from "../utils/event.utils";
import { isComponentDisabled } from "../utils/killSwitch";
import {
  ConfigurationError,
  categorizeError,
  handleError,
} from "../services/errorHandling";
import type { QueueManager } from "../services/queues/queueManager";
import type { FoldProjectionDefinition } from "./foldProjection.types";
import { FoldProjectionExecutor } from "./foldProjectionExecutor";
import type { MapProjectionDefinition } from "./mapProjection.types";
import { MapProjectionExecutor } from "./mapProjectionExecutor";
import type { ProjectionStoreContext } from "./projectionStoreContext";

/**
 * Central router that registers fold and map projections and dispatches events.
 *
 * - FoldProjections: enqueued to GroupQueue (per-aggregate ordering), incremental only
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
    private readonly pipelineName: string,
    private readonly queueManager: QueueManager<EventType>,
    private readonly featureFlagService?: FeatureFlagServiceInterface,
    private readonly redisConnection?: IORedis | Cluster,
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
   * Each fold projection gets a GroupQueue that processes events incrementally.
   */
  initializeFoldQueues(): void {
    if (this.foldProjections.size === 0) return;

    const projectionDefs: Record<string, {
      name: string;
      groupKeyFn?: (event: EventType) => string;
      options?: { killSwitch?: { customKey?: string } };
    }> = {};

    for (const [name, fold] of this.foldProjections) {
      projectionDefs[name] = {
        name,
        groupKeyFn: fold.key,
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

        await this.processFoldProjectionEvent(
          projectionName,
          fold,
          triggerEvent,
          { tenantId: triggerEvent.tenantId },
        );
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

        const errors: Error[] = [];

        // Dispatch to fold projections
        if (this.foldProjections.size > 0) {
          try {
            await this.dispatchToFoldProjections(events, context);
          } catch (e) {
            if (e instanceof AggregateError) {
              errors.push(...(e.errors as Error[]));
            } else {
              errors.push(e instanceof Error ? e : new Error(String(e)));
            }
          }
        }

        // Dispatch to map projections
        if (this.mapProjections.size > 0) {
          try {
            await this.dispatchToMapProjections(events, context);
          } catch (e) {
            if (e instanceof AggregateError) {
              errors.push(...(e.errors as Error[]));
            } else {
              errors.push(e instanceof Error ? e : new Error(String(e)));
            }
          }
        }

        if (errors.length > 0) {
          throw new AggregateError(
            errors,
            `${errors.length} projection(s) failed during dispatch`,
          );
        }
      },
    );
  }

  private async dispatchToFoldProjections(
    events: readonly EventType[],
    context: EventStoreReadContext<EventType>,
  ): Promise<void> {
    const hasProjectionQueues = this.queueManager.hasProjectionQueues();
    const errors: Error[] = [];

    if (hasProjectionQueues) {
      // Async dispatch via queues
      for (const event of events) {
        for (const projectionName of this.foldProjections.keys()) {
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
              errors.push(error instanceof Error ? error : new Error(String(error)));
            }
          }
        }
      }
    } else {
      // Inline sync processing
      for (const event of events) {
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
              aggregateId: String(event.aggregateId),
              tenantId: context.tenantId,
            });
            errors.push(error instanceof Error ? error : new Error(String(error)));
          }
        }
      }
    }

    if (errors.length > 0) {
      throw new AggregateError(errors, `${errors.length} fold projection(s) failed during dispatch`);
    }
  }

  private async dispatchToMapProjections(
    events: readonly EventType[],
    context: EventStoreReadContext<EventType>,
  ): Promise<void> {
    const hasHandlerQueues = this.queueManager.hasHandlerQueues();
    const errors: Error[] = [];

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
              errors.push(error instanceof Error ? error : new Error(String(error)));
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
            errors.push(error instanceof Error ? error : new Error(String(error)));
          }
        }
      }
    }

    if (errors.length > 0) {
      throw new AggregateError(errors, `${errors.length} map projection(s) failed during dispatch`);
    }
  }

  /**
   * Processes a single event for a fold projection (incremental).
   * The fold state in the store serves as the checkpoint — no separate checkpoint tracking needed.
   */
  private async processFoldProjectionEvent(
    projectionName: string,
    fold: FoldProjectionDefinition<any, EventType>,
    event: EventType,
    context: EventStoreReadContext<EventType>,
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

        // Check kill switch
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

        const key = fold.key ? fold.key(event) : undefined;
        const storeContext: ProjectionStoreContext = {
          aggregateId: String(event.aggregateId),
          tenantId: event.tenantId,
          key,
        };

        await this.foldExecutor.execute(fold, event, storeContext);
      },
    );
  }

  // --- Read methods used by EventSourcingService ---

  /**
   * Gets a fold projection by name for a given aggregate.
   */
  async getProjectionByName<ProjectionName extends keyof ProjectionTypes & string>(
    projectionName: ProjectionName,
    aggregateId: string,
    context: EventStoreReadContext<EventType>,
    options?: { key?: string },
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

    const lookupKey = options?.key ?? aggregateId;
    const storeContext: ProjectionStoreContext = {
      aggregateId,
      tenantId: context.tenantId,
    };

    const state = await fold.store.get(lookupKey, storeContext);
    if (state === null) return null;

    return {
      id: `${projectionName}:${context.tenantId}:${aggregateId}`,
      aggregateId,
      tenantId: context.tenantId,
      version: fold.version,
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
    options?: { key?: string },
  ): Promise<boolean> {
    const projection = await this.getProjectionByName(projectionName, aggregateId, context, options);
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
}
