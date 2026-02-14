import type { MapProjectionDefinition } from "../../../../src/server/event-sourcing/library/projections/mapProjection.types";
import type { Event } from "../../../../src/server/event-sourcing/library/domain/types";

/**
 * Metadata for a map projection (formerly event handler) discovered from a pipeline.
 */
export interface DiscoveredEventHandler {
  id: string;
  pipelineName: string;
  handlerName: string;
  definition: MapProjectionDefinition<any, Event>;
  eventTypes?: readonly string[];
  filePath?: string;
}
