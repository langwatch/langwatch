import path from "node:path";
import { pathToFileURL } from "node:url";
import fg from "fast-glob";
import type { FoldProjectionDefinition } from "../../../../src/server/event-sourcing/library/projections/foldProjection.types";
import type { Event } from "../../../../src/server/event-sourcing/library/domain/types";
import { globalProjectionsRoot } from "../paths";
import { discoverPipelines } from "./pipelines";
import type { DiscoveredProjection } from "./projections.types";

/**
 * Discovers fold projections from both pipeline definitions and global projections.
 *
 * @example
 * const projections = await discoverProjections();
 */
export async function discoverProjections(): Promise<DiscoveredProjection[]> {
  const [pipelineProjections, globalProjections] = await Promise.all([
    discoverPipelineProjections(),
    discoverGlobalProjections(),
  ]);

  return [...pipelineProjections, ...globalProjections];
}

/**
 * Discovers fold projections from static pipeline definitions.
 */
async function discoverPipelineProjections(): Promise<DiscoveredProjection[]> {
  const pipelines = await discoverPipelines();
  const results: DiscoveredProjection[] = [];

  for (const pipeline of pipelines) {
    const pipelineName = pipeline.pipeline.metadata.name;
    const pipelineDir = path.dirname(pipeline.pipelineFilePath);

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

/**
 * Type guard for FoldProjectionDefinition exports.
 */
function isFoldProjectionDefinition(
  exported: unknown,
): exported is FoldProjectionDefinition<any, Event> {
  if (typeof exported !== "object" || exported === null) return false;
  const def = exported as Record<string, unknown>;
  return (
    typeof def.name === "string" &&
    typeof def.version === "string" &&
    typeof def.init === "function" &&
    typeof def.apply === "function" &&
    Array.isArray(def.eventTypes)
  );
}

/**
 * Discovers global fold projections by scanning *.foldProjection.ts files.
 * Global projections live outside pipelines and receive events from all pipelines.
 */
async function discoverGlobalProjections(): Promise<DiscoveredProjection[]> {
  const pattern = path.join(globalProjectionsRoot, "*.foldProjection.ts");
  const files = await fg(pattern, { absolute: true });
  const results: DiscoveredProjection[] = [];

  for (const file of files) {
    try {
      const url = pathToFileURL(file).href;
      const moduleExports = await import(url);

      for (const [_exportName, exported] of Object.entries(moduleExports)) {
        if (isFoldProjectionDefinition(exported)) {
          const id = `global:${exported.name}`;
          results.push({
            id,
            pipelineName: "global",
            projectionName: exported.name,
            filePath: globalProjectionsRoot,
            definition: exported,
          });
          break;
        }
      }
    } catch {
      // Global projection may depend on unavailable modules — skip silently
    }
  }

  return results;
}
