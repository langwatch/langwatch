import path from "node:path";
import { discoverPipelines } from "./pipelines";
import type { DiscoveredProjection } from "./projections.types";

/**
 * Discovers fold projections by reading static pipeline definitions.
 * The static pipeline definitions contain the projection definitions directly.
 *
 * This approach works even when runtime dependencies (ClickHouse, Redis) are unavailable.
 *
 * @example
 * const projections = await discoverProjections();
 */
export async function discoverProjections(): Promise<DiscoveredProjection[]> {
  const pipelines = await discoverPipelines();

  const results: DiscoveredProjection[] = [];

  for (const pipeline of pipelines) {
    const pipelineName = pipeline.pipeline.metadata.name;
    const pipelineDir = path.dirname(pipeline.pipelineFilePath);

    // Read fold projections from the static pipeline definition
    for (const [projectionName, { definition }] of pipeline.pipeline
      .foldProjections) {
      const id = `${pipelineName}:${projectionName}`;

      results.push({
        id,
        pipelineName,
        projectionName,
        filePath: path.join(pipelineDir, "projections"),
        definition,
      });
    }
  }

  return results;
}
