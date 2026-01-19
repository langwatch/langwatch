import type { ProjectionHandlerClass } from "../../../../src/server/event-sourcing/library/domain/handlers/projectionHandlerClass";
import type {
  Event,
  Projection,
} from "../../../../src/server/event-sourcing/library/domain/types";

/**
 * Metadata for a projection discovered on disk.
 *
 * @example
 * const projection: DiscoveredProjection = { ... };
 */
export interface DiscoveredProjection {
  id: string;
  pipelineName: string;
  projectionName: string;
  filePath: string;
  HandlerClass: ProjectionHandlerClass<Event, Projection>;
}

/**
 * Builds a map of pipeline names to their aggregate types.
 * Uses pipeline metadata to build the map without requiring runtime dependencies.
 *
 * @example
 * const map = await buildPipelineAggregateTypeMap();
 * const expectedType = map["trace_processing"]; // "trace"
 */
export async function buildPipelineAggregateTypeMap(): Promise<
  Record<string, string>
> {
  const { discoverPipelines } = await import("./pipelines");
  const pipelines = await discoverPipelines();
  const map: Record<string, string> = {};
  for (const pipeline of pipelines) {
    // Use metadata for aggregate type - works even when runtime is disabled
    const aggregateType =
      pipeline.pipeline.metadata?.aggregateType ?? pipeline.aggregateType;
    map[pipeline.name] = aggregateType;
  }
  return map;
}
