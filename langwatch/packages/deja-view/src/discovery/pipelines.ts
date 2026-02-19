import path from "node:path";
import { pathToFileURL } from "node:url";
import fg from "fast-glob";
import type {
  AggregateType,
  StaticPipelineDefinition,
} from "../../../../src/server/event-sourcing";
import type { Event } from "../../../../src/server/event-sourcing/domain/types";
import { pipelineRoot } from "../paths";

/**
 * Metadata extracted from a discovered pipeline.
 * Now uses static definitions instead of registered pipelines.
 */
export interface DiscoveredPipeline {
  name: string;
  aggregateType: AggregateType;
  pipeline: StaticPipelineDefinition<Event, any>;
  pipelineFilePath: string;
}

/**
 * Discovers all pipelines by scanning for pipeline.ts files and importing static definitions.
 * This works without runtime dependencies (ClickHouse/Redis) since pipelines are now
 * defined statically using `definePipeline()`.
 *
 * @example
 * const pipelines = await discoverPipelines();
 */
export async function discoverPipelines(): Promise<DiscoveredPipeline[]> {
  const pattern = path.join(pipelineRoot, "**/pipeline.ts");
  const files = await fg(pattern, { absolute: true });

  const results: DiscoveredPipeline[] = [];

  for (const file of files) {
    try {
      const moduleExports = await importPipeline(file);

      // Look for exported static pipeline definition
      for (const [_exportName, exported] of Object.entries(moduleExports)) {
        if (isStaticPipelineDefinition(exported)) {
          results.push({
            name: exported.metadata.name,
            aggregateType: exported.metadata.aggregateType,
            pipeline: exported,
            pipelineFilePath: file,
          });
          // Only take the first pipeline export per file
          break;
        }
      }
    } catch (error) {
      // Pipeline may not be available in all environments
      // Silently skip and continue
      if (error instanceof Error) {
        // Log in debug mode if needed, but don't fail discovery
        console.log(error);
      }
    }
  }

  return results;
}

/**
 * Checks if an exported value is a StaticPipelineDefinition.
 */
function isStaticPipelineDefinition(
  exported: unknown,
): exported is StaticPipelineDefinition<Event, any> {
  if (typeof exported !== "object" || exported === null) return false;
  const definition = exported as Record<string, unknown>;
  return (
    typeof definition.metadata === "object" &&
    definition.metadata !== null &&
    typeof (definition.metadata as any).name === "string" &&
    typeof (definition.metadata as any).aggregateType === "string" &&
    definition.projections instanceof Map &&
    definition.mapProjections instanceof Map &&
    Array.isArray(definition.commands)
  );
}

/**
 * Imports a pipeline module, handling both .ts and .js extensions.
 */
async function importPipeline(
  modulePath: string,
): Promise<Record<string, unknown>> {
  const url = pathToFileURL(modulePath).href;
  try {
    return await import(url);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code?: string }).code === "ERR_UNKNOWN_FILE_EXTENSION"
    ) {
      const jsPath = modulePath.replace(/\.ts$/, ".js");
      return await import(pathToFileURL(jsPath).href);
    }
    throw error;
  }
}
