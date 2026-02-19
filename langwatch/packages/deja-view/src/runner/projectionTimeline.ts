import type { Event } from "../../../../src/server/event-sourcing/domain/types";
import type { ProjectionTimelineTypes } from "./projectionTimeline.types";

/**
 * Builds projection timelines by replaying events through fold projection definitions.
 * Uses the pure init() + apply() functions to compute state at each step.
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
    const fold = projection.definition;
    const eventsByAggregate: Record<string, Event[]> = {};
    const steps: ProjectionTimelineTypes["Step"][] = [];

    // Get the expected aggregate type for this projection's pipeline
    const expectedAggregateType =
      pipelineAggregateTypes[projection.pipelineName];

    let lastState: ProjectionTimelineTypes["Snapshot"][] = [];

    orderedEvents.forEach((event, index) => {
      // Check if this event affects this projection
      const eventAffectsProjection =
        !expectedAggregateType || event.aggregateType === expectedAggregateType;

      if (eventAffectsProjection) {
        // Event affects this projection - compute new state via fold
        const aggregateEvents = eventsByAggregate[event.aggregateId] ?? [];
        aggregateEvents.push(event);
        eventsByAggregate[event.aggregateId] = aggregateEvents;

        const projectionStateByAggregate: ProjectionTimelineTypes["Snapshot"][] =
          Object.entries(eventsByAggregate).map(
            ([aggregateId, aggregateEventList]) => {
              // Replay all events through the fold: init() then apply() each event
              let state = fold.init();
              for (const evt of aggregateEventList) {
                if (fold.eventTypes.includes(evt.type)) {
                  state = fold.apply(state, evt);
                }
              }

              return {
                aggregateId,
                tenantId: String(aggregateEventList[0]?.tenantId ?? event.tenantId),
                version: "computed",
                data: state,
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
