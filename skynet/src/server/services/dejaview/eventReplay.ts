import type {
  DejaViewEvent,
} from "./clickhouse.ts";
import type {
  DiscoveredProjection,
  DiscoveredEventHandler,
} from "./pipelineDiscovery.ts";

export interface ProjectionSnapshot {
  aggregateId: string;
  tenantId: string;
  version: string;
  data: unknown;
}

export interface ProjectionStep {
  eventIndex: number;
  eventId: string;
  eventType: string;
  stale: boolean;
  projectionStateByAggregate: ProjectionSnapshot[];
}

export interface ProjectionTimeline {
  projection: { id: string; pipelineName: string; projectionName: string };
  steps: ProjectionStep[];
}

export interface EventHandlerStep {
  eventIndex: number;
  eventId: string;
  eventType: string;
  processed: boolean;
  displayData?: unknown;
}

export interface EventHandlerTimeline {
  handler: { id: string; pipelineName: string; handlerName: string; eventTypes?: readonly string[] };
  steps: EventHandlerStep[];
}

export function buildProjectionTimelines({
  events,
  projections,
  pipelineAggregateTypes,
}: {
  events: DejaViewEvent[];
  projections: DiscoveredProjection[];
  pipelineAggregateTypes: Record<string, string>;
}): ProjectionTimeline[] {
  const orderedEvents = [...events].sort((a, b) => a.timestamp - b.timestamp);

  return projections.map((projection) => {
    const fold = projection.definition;
    // Incremental state per aggregate — avoids O(n²) recomputation
    const stateByAggregate: Record<string, { state: unknown; tenantId: string }> = {};
    const steps: ProjectionStep[] = [];
    const expectedAggregateType = pipelineAggregateTypes[projection.pipelineName];
    let lastSnapshots: ProjectionSnapshot[] = [];

    orderedEvents.forEach((event, index) => {
      const eventAffectsProjection =
        !expectedAggregateType || event.aggregateType === expectedAggregateType;

      if (eventAffectsProjection) {
        // Initialize state for new aggregate
        if (!stateByAggregate[event.aggregateId]) {
          stateByAggregate[event.aggregateId] = {
            state: fold.init(),
            tenantId: String(event.tenantId),
          };
        }

        // Apply event incrementally
        const entry = stateByAggregate[event.aggregateId]!;
        if (fold.eventTypes.includes(event.type)) {
          entry.state = fold.apply(entry.state, event);
        }

        // Build snapshot list from current running states
        const projectionStateByAggregate: ProjectionSnapshot[] =
          Object.entries(stateByAggregate).map(([aggregateId, { state, tenantId }]) => ({
            aggregateId,
            tenantId,
            version: "computed",
            data: state,
          }));

        lastSnapshots = projectionStateByAggregate;
        steps.push({
          eventIndex: index,
          eventId: event.id,
          eventType: event.type,
          stale: false,
          projectionStateByAggregate,
        });
      } else {
        steps.push({
          eventIndex: index,
          eventId: event.id,
          eventType: event.type,
          stale: true,
          projectionStateByAggregate: lastSnapshots,
        });
      }
    });

    return {
      projection: {
        id: projection.id,
        pipelineName: projection.pipelineName,
        projectionName: projection.projectionName,
      },
      steps,
    };
  });
}

export function buildEventHandlerTimelines({
  events,
  handlers,
}: {
  events: DejaViewEvent[];
  handlers: DiscoveredEventHandler[];
}): EventHandlerTimeline[] {
  const orderedEvents = [...events].sort((a, b) => a.timestamp - b.timestamp);

  return handlers.map((handler) => {
    const steps: EventHandlerStep[] = [];
    const handlerEventTypes = handler.eventTypes ?? handler.definition.eventTypes;

    for (let index = 0; index < orderedEvents.length; index++) {
      const event = orderedEvents[index];
      if (!event) continue;

      const processed = !handlerEventTypes || handlerEventTypes.includes(event.type);
      let displayData: unknown | undefined;

      if (processed) {
        try {
          displayData = handler.definition.map(event);
        } catch {
          displayData = undefined;
        }
      }

      steps.push({
        eventIndex: index,
        eventId: event.id,
        eventType: event.type,
        processed,
        displayData,
      });
    }

    return {
      handler: {
        id: handler.id,
        pipelineName: handler.pipelineName,
        handlerName: handler.handlerName,
        eventTypes: handler.eventTypes,
      },
      steps,
    };
  });
}
