/**
 * Discovery worker — runs as a child process to import pipeline files
 * without blocking the main Express event loop.
 *
 * Pipeline imports pull in the full langwatch codebase (services, singletons, etc.),
 * which is too heavy to do in-process. This worker outputs discovery results as JSON.
 *
 * Usage: tsx --tsconfig ../langwatch/tsconfig.json src/server/services/dejaview/discoveryWorker.ts
 */

import "./env-defaults.ts";

async function main() {
  try {
    const { discoverProjections, discoverEventHandlers, buildPipelineAggregateTypeMap } =
      await import("./pipelineDiscovery.ts");

    const [projections, handlers, aggregateTypeMap] = await Promise.all([
      discoverProjections(),
      discoverEventHandlers(),
      buildPipelineAggregateTypeMap(),
    ]);

    // Serialize projection/handler metadata (functions can't be serialized)
    const result = {
      projections: projections.map((p) => ({
        id: p.id,
        pipelineName: p.pipelineName,
        projectionName: p.projectionName,
        eventTypes: [...p.definition.eventTypes],
        filePath: p.filePath,
      })),
      handlers: handlers.map((h) => ({
        id: h.id,
        pipelineName: h.pipelineName,
        handlerName: h.handlerName,
        eventTypes: [...(h.eventTypes ?? h.definition.eventTypes)],
        filePath: h.filePath,
      })),
      pipelineAggregateTypes: aggregateTypeMap,
    };

    // Output JSON to stdout for parent process
    process.stdout.write(JSON.stringify(result));
    process.exit(0);
  } catch (error) {
    console.error("Discovery failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
