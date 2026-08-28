import type { Projection, RegisteredCommand, StaticPipelineDefinition } from "@langwatch/eventing";
import type { TraceProcessingEvent } from "@langwatch/trace-contract";
import type { TraceDeferredOriginSchedulerPort } from "../adapters/eventing.deferred-origin.adapter";

/** Process-composed Trace pipeline definition, built before registration. */
export abstract class TraceProcessingPipelinePort {
  abstract build(options: {
    deferredOrigins: TraceDeferredOriginSchedulerPort;
  }): StaticPipelineDefinition<TraceProcessingEvent, Record<string, Projection>, RegisteredCommand>;
}
