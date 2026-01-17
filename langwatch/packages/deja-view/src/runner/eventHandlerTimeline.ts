import type { DiscoveredEventHandler } from "../discovery/eventHandlers.types";
import type { Event } from "../lib/types";
import type { EventHandlerTimelineTypes } from "./eventHandlerTimeline.types";

/**
 * Builds event handler timelines by checking which events each handler processes.
 * Calls getDisplayData() if available to get display data for visualization.
 * Note: This function is synchronous and will not await async getDisplayData results.
 * Async display data will be undefined and can be enhanced in the future.
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
    const handlerInstance = new handler.HandlerClass();
    const steps: EventHandlerTimelineTypes["Step"][] = [];

    // Get event types this handler processes
    const handlerEventTypes =
      handler.eventTypes ?? handlerInstance.getEventTypes?.();

    for (let index = 0; index < orderedEvents.length; index++) {
      const event = orderedEvents[index];
      if (!event) continue;

      // Check if this handler processes this event
      const processed =
        !handlerEventTypes || handlerEventTypes.includes(event.type);

      let displayData: unknown | undefined;

      if (processed && handlerInstance.getDisplayData) {
        try {
          // Cast event to library Event type for getDisplayData
          const data = handlerInstance.getDisplayData(event as any);
          // Handle both sync and async getDisplayData
          // For now, we only handle sync results. Async results would need
          // this function to be async and await all promises, which would
          // significantly slow down timeline building.
          if (data instanceof Promise) {
            // Async getDisplayData - skip for now (could be enhanced)
            displayData = undefined;
          } else {
            displayData = data;
          }
        } catch {
          // If getDisplayData fails, just don't show display data
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
