import type { EventHandlerTimelineTypes } from "./eventHandlerTimeline.types";

/**
 * Builds event handler timelines by checking which events each map projection processes.
 * Uses the map projection's `map()` function to get display data for visualization.
 *
 * @example
 * const timelines = buildEventHandlerTimelines({ events, handlers });
 */
export function buildEventHandlerTimelines({
  events,
  handlers,
}: EventHandlerTimelineTypes["Input"]): EventHandlerTimelineTypes["Timeline"][] {
  const orderedEvents = [...events].sort((a, b) => a.timestamp - b.timestamp);

  return handlers.map((handler) => {
    const steps: EventHandlerTimelineTypes["Step"][] = [];

    // Get event types this map projection processes
    const handlerEventTypes = handler.eventTypes ?? handler.definition.eventTypes;

    for (let index = 0; index < orderedEvents.length; index++) {
      const event = orderedEvents[index];
      if (!event) continue;

      // Check if this map projection processes this event
      const processed =
        !handlerEventTypes || handlerEventTypes.includes(event.type);

      let displayData: unknown | undefined;

      if (processed) {
        try {
          // Use the map function to produce display data
          displayData = handler.definition.map(event as any);
        } catch {
          // If map fails, just don't show display data
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
      handler,
      steps,
    };
  });
}
