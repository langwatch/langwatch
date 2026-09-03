import type { EventingTracePipelineAdapter } from "../adapters/eventing.trace-pipeline.adapter";
import type { TraceDeferredOriginSchedulerPort } from "../adapters/eventing.deferred-origin.adapter";

/**
 * The exact definition Trace's own builder produces, commands and projections
 * included. Declaring the port against `RegisteredCommand` instead would erase
 * the union to its constraint, and `eventSourcing.register()` would then hand
 * every caller an index-signature command map — `recordSpan` typed as
 * `MappedCommand<Record<string, unknown>> | undefined` rather than as itself.
 * The process root composes subscribers on top of this builder, and every
 * `with*Subscriber` returns `this`, so the composed definition has this type.
 */
export type TraceProcessingPipelineDefinition = ReturnType<
  ReturnType<EventingTracePipelineAdapter["build"]>["build"]
>;

/** Process-composed Trace pipeline definition, built before registration. */
export abstract class TraceProcessingPipelinePort {
  abstract build(options: {
    deferredOrigins: TraceDeferredOriginSchedulerPort;
  }): TraceProcessingPipelineDefinition;
}
