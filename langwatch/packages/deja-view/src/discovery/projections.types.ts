import type { FoldProjectionDefinition } from "../../../../src/server/event-sourcing/projections/foldProjection.types";
import type { Event } from "../../../../src/server/event-sourcing/domain/types";

/**
 * Metadata for a fold projection discovered from a pipeline.
 */
export interface DiscoveredProjection {
  id: string;
  pipelineName: string;
  projectionName: string;
  filePath: string;
  definition: FoldProjectionDefinition<any, Event>;
}

/**
 * Builds a map of pipeline names to their aggregate types.
 * Uses pipeline metadata to build the map without requiring runtime dependencies.
 */
export async function buildPipelineAggregateTypeMap(): Promise<
  Record<string, string>
> {
  const { discoverPipelines } = await import("./pipelines");
  const pipelines = await discoverPipelines();
  const map: Record<string, string> = {};
  for (const pipeline of pipelines) {
    const aggregateType =
      pipeline.pipeline.metadata?.aggregateType ?? pipeline.aggregateType;
    map[pipeline.name] = aggregateType;
  }
  return map;
}
