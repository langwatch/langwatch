import path from "node:path";
import type { DiscoveredEventHandler } from "./eventHandlers.types";
import { discoverPipelines } from "./pipelines";

/**
 * Discovers map projections (formerly event handlers) by reading static pipeline definitions.
 *
 * @example
 * const handlers = await discoverEventHandlers();
 */
export async function discoverEventHandlers(): Promise<
  DiscoveredEventHandler[]
> {
  const pipelines = await discoverPipelines();

  const results: DiscoveredEventHandler[] = [];

  for (const pipeline of pipelines) {
    const pipelineName = pipeline.pipeline.metadata.name;
    const pipelineDir = path.dirname(pipeline.pipelineFilePath);

    // Read map projections from the static pipeline definition
    for (const [name, { definition }] of pipeline.pipeline.mapProjections) {
      const id = `${pipelineName}:${name}`;

      results.push({
        id,
        pipelineName,
        handlerName: name,
        definition,
        eventTypes: definition.eventTypes,
        filePath: path.join(pipelineDir, "handlers"),
      });
    }
  }

  return results;
}
