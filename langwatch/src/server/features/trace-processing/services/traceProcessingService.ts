import { createEventSourcingPipeline, type EventSourcingService } from "../library";

import type { SpanEvent, TraceProjection } from "../types";
import type { EventStore } from "../repositories/eventStore";
import type { ProjectionStore } from "../repositories/projectionStore";
import type { EventHandler } from "../eventHandlers/eventHandler";

export type TraceProcessingService = EventSourcingService<string, SpanEvent, TraceProjection>;

export function createTraceProcessingService(
  dependencies: {
    eventStore: EventStore;
    projectionStore: ProjectionStore;
    eventHandler: EventHandler;
  }
): TraceProcessingService {
  return createEventSourcingPipeline({
    eventStore: dependencies.eventStore,
    projectionStore: dependencies.projectionStore,
    eventHandler: dependencies.eventHandler,
  });
}
