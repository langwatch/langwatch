import { generate } from "@langwatch/ksuid";

import type { EventStream, Event, Projection } from "../../../library";
import { createTenantId } from "../../../library";
import type { EventHandler } from "../../../library";
import type { SpanEvent } from "../types/spanEvent";

/**
 * No-op event handler for span-processing pipeline.
 * Spans are event-only and don't require projections, but the pipeline
 * builder requires an event handler to be provided.
 *
 * NOTE(afr): We should refactor this requirement.
 */
export class SpanProjectionEventHandler
  implements EventHandler<string, SpanEvent, Projection<string>>
{
  async handle(
    stream: EventStream<string, Event<string, unknown>>,
  ): Promise<Projection<string>> {
    const aggregateId = stream.getAggregateId();

    const firstEvent = stream.getEvents()[0];
    if (!firstEvent) {
      throw new Error("Event stream is empty");
    }

    const tenantId = firstEvent.tenantId;
    if (!tenantId) {
      throw new Error("Event has no tenantId");
    }

    const tenantIdString = String(tenantId);

    // Return a mini mocky projection since spans don't need projections
    return {
      id: generate("projection").toString(),
      aggregateId,
      tenantId: createTenantId(tenantIdString),
      version: Date.now(),
      data: {},
    };
  }
}
