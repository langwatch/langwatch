import type { Event } from "../../../../src/server/event-sourcing/library/domain/types";
import * as eventSourcingLibrary from "../../../../src/server/event-sourcing/library/index.js";
import type { ProjectionTimelineTypes } from "./projectionTimeline.types";

// ESM importing CJS - the module might be wrapped in a default export. hacky
const lib = (eventSourcingLibrary as any).default ?? eventSourcingLibrary;
const EventStream = lib.EventStream;

/**
 * Builds projection timelines by replaying events through discovered projection handlers.
 * Tracks staleness when events don't affect a projection (carry forward previous state).
 *
 * @example
 * const timelines = buildProjectionTimelines({ events, projections, pipelineAggregateTypes });
 */
export function buildProjectionTimelines({
  events,
  projections,
  pipelineAggregateTypes,
}: ProjectionTimelineTypes["Input"] & {
  pipelineAggregateTypes: Record<string, string>;
}): ProjectionTimelineTypes["Timeline"][] {
  const orderedEvents = [...events].sort((a, b) => a.timestamp - b.timestamp);

  return projections.map((projection) => {
    const handler = new projection.HandlerClass();
    const eventsByAggregate: Record<string, Event[]> = {};
    const steps: ProjectionTimelineTypes["Step"][] = [];

    // Get the expected aggregate type for this projection's pipeline
    const expectedAggregateType = pipelineAggregateTypes[projection.pipelineName];

    let lastState: ProjectionTimelineTypes["Snapshot"][] = [];

    orderedEvents.forEach((event, index) => {
      // Check if this event affects this projection
      const eventAffectsProjection =
        !expectedAggregateType || event.aggregateType === expectedAggregateType;

      if (eventAffectsProjection) {
        // Event affects this projection - compute new state
        const aggregateEvents = eventsByAggregate[event.aggregateId] ?? [];
        aggregateEvents.push(event);
        eventsByAggregate[event.aggregateId] = aggregateEvents;

        const projectionStateByAggregate: ProjectionTimelineTypes["Snapshot"][] =
          Object.entries(eventsByAggregate).map(
            ([aggregateId, aggregateEventList]) => {
              const stream = new EventStream(
                aggregateId,
                aggregateEventList[0]?.tenantId ?? event.tenantId,
                aggregateEventList,
                { ordering: "timestamp" },
              );
              const value = handler.handle(stream);

              // Handle both sync and async results
              if (value instanceof Promise) {
                // For async, we can't await here, so return a placeholder
                // In practice, projection handlers should be synchronous for deja-view
                throw new Error("Async projection handlers are not supported in deja-view");
              }

              // TypeScript narrowing: value is now definitely not a Promise
              const projection = value as { aggregateId: string; tenantId: string; version: string; data: unknown };

              return {
                aggregateId: projection.aggregateId,
                tenantId: projection.tenantId,
                version: projection.version,
                data: projection.data,
              };
            },
          );

        lastState = projectionStateByAggregate;

        steps.push({
          eventIndex: index,
          eventId: event.id,
          eventType: event.type,
          stale: false,
          projectionStateByAggregate,
        });
      } else {
        // Event doesn't affect this projection - carry forward previous state
        steps.push({
          eventIndex: index,
          eventId: event.id,
          eventType: event.type,
          stale: true,
          projectionStateByAggregate: lastState,
        });
      }
    });

    return {
      projection,
      steps,
    };
  });
}

