import type { EventHandler } from "../../../../src/server/event-sourcing/library/domain/handlers/eventHandler";
import type { Event } from "../../../../src/server/event-sourcing/library/domain/types";

/**
 * Metadata for an event handler discovered from a pipeline.
 *
 * @example
 * const handler: DiscoveredEventHandler = { ... };
 */
export interface DiscoveredEventHandler {
  id: string;
  pipelineName: string;
  handlerName: string;
  HandlerClass: new () => EventHandler<Event>;
  eventTypes?: readonly string[];
  filePath?: string;
}








