import { generate } from "@langwatch/ksuid";

import type { EventStream } from "../library";
import type { EventHandler } from "./eventHandler";
import type { SpanEvent, TraceProjection } from "../types";
import { buildTraceProjection } from "../utils/buildTraceProjection";

export class TraceProjectionEventHandler implements EventHandler {
  handle(stream: EventStream<string, SpanEvent>): TraceProjection {
    const projectionData = buildTraceProjection(stream);

    return {
      id: generate("projection").toString(),
      aggregateId: stream.getAggregateId(),
      version: Date.now(),
      data: projectionData,
    };
  }
}
