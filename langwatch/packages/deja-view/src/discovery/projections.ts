import path from "node:path";
import type { DiscoveredProjection } from "./projections.types";
import { discoverPipelines } from "./pipelines";

/**
 * Discovers projection handler classes by reading static pipeline definitions.
 * The static pipeline definitions already contain the handler classes, so we just
 * extract them directly without needing to scan files or match by name.
 *
 * This approach works even when runtime dependencies (ClickHouse, Redis) are unavailable.
 *
 * @example
 * const projections = await discoverProjections();
 */
export async function discoverProjections(): Promise<DiscoveredProjection[]> {
  // Discover all pipelines to get their static definitions
  const pipelines = await discoverPipelines();

  const results: DiscoveredProjection[] = [];

  for (const pipeline of pipelines) {
    const pipelineName = pipeline.pipeline.metadata.name;
    const pipelineDir = path.dirname(pipeline.pipelineFilePath);

    // The static pipeline definition already has the handler classes in the projections Map!
    // Just iterate over them directly
    for (const [projectionName, projectionDef] of pipeline.pipeline.projections) {
      const id = `${pipelineName}:${projectionName}`;

      results.push({
        id,
        pipelineName,
        projectionName,
        filePath: path.join(pipelineDir, "projections"), // Approximate path to projections directory
        HandlerClass: projectionDef.HandlerClass,
      });
    }
  }

  return results;
}
