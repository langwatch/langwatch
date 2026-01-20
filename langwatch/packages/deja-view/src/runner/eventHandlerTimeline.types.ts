import type { DiscoveredEventHandler } from "../discovery/eventHandlers.types";
import type { Event } from "../lib/types";

/**
 * Grouped event handler timeline types, exported as a single symbol per file.
 *
 * @example
 * type Timeline = EventHandlerTimelineTypes["Timeline"];
 */
export type EventHandlerTimelineTypes = {
  Step: {
    eventIndex: number;
    eventId: string;
    eventType: string;
    processed: boolean;
    displayData?: unknown;
  };
  Timeline: {
    handler: DiscoveredEventHandler;
    steps: EventHandlerTimelineTypes["Step"][];
  };
  Input: {
    events: Event[];
    handlers: DiscoveredEventHandler[];
  };
};
