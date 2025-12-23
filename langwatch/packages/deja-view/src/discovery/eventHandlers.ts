import path from "node:path";
import { pathToFileURL } from "node:url";
import fg from "fast-glob";
import type { EventHandler } from "../../../../src/server/event-sourcing/library/domain/handlers/eventHandler";
import type { Event } from "../../../../src/server/event-sourcing/library/domain/types";
import { pipelineRoot } from "../paths";
import type { DiscoveredEventHandler } from "./eventHandlers.types";
import { discoverPipelines } from "./pipelines";

function isEventHandler(exported: unknown): exported is new () => EventHandler<Event> {
  if (typeof exported !== "function") return false;
  const hasHandle =
    typeof (exported as { prototype?: unknown }).prototype === "object" &&
    typeof (exported as { prototype: { handle?: unknown } }).prototype.handle ===
      "function";
  return Boolean(hasHandle);
}

async function importModule(modulePath: string): Promise<Record<string, unknown>> {
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

/**
 * Discovers event handlers by using pipeline discovery and scanning handler files.
 * Uses pipeline context to match handlers to their pipelines.
 *
 * @example
 * const handlers = await discoverEventHandlers();
 */
export async function discoverEventHandlers(): Promise<DiscoveredEventHandler[]> {
  // Discover all pipelines to get pipeline context
  const pipelines = await discoverPipelines();
  // Build a map of directory name -> pipeline for matching
  const pipelineByDir = new Map<string, typeof pipelines[0]>();
  for (const pipeline of pipelines) {
    // Extract directory name from pipeline file path
    const dirName = path.basename(path.dirname(pipeline.pipelineFilePath));
    pipelineByDir.set(dirName, pipeline);
  }

  // Build a map of pipeline -> handler names from pipeline definitions
  // We need to access the internal structure, but since it's not directly exposed,
  // we'll scan handler files and match them to pipelines
  const pattern = path.join(pipelineRoot, "**/handlers/*.ts");
  const files = await fg(pattern, { absolute: true });

  const resultsMap = new Map<string, DiscoveredEventHandler>();

  for (const file of files) {
    try {
      const moduleExports = await importModule(file);
      // Extract directory name from file path (e.g., .../trace-processing/handlers/...)
      const dirName = path.basename(path.dirname(path.dirname(file)));
      const fileBase = path.parse(file).name;

      // Find pipeline by directory name
      const pipeline = pipelineByDir.get(dirName);
      if (!pipeline) {
        // No pipeline found for this directory, skip
        continue;
      }

      const pipelineName = pipeline.name;

      for (const [exportName, exported] of Object.entries(moduleExports)) {
        if (!isEventHandler(exported)) continue;
        const handlerName = exportName || fileBase;
        const id = `${pipelineName}:${handlerName}`;

        // Create handler instance to check event types
        const handlerInstance = new exported();
        const eventTypes = handlerInstance.getEventTypes?.();

        // Deduplicate by id to avoid duplicate handlers
        if (!resultsMap.has(id)) {
          resultsMap.set(id, {
            id,
            pipelineName,
            handlerName,
            HandlerClass: exported,
            eventTypes,
            filePath: file,
          });
        }
      }
    } catch (error) {
      // Skip files that can't be imported
      continue;
    }
  }

  return Array.from(resultsMap.values());
}

