import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import fg from "fast-glob";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Navigate from skynet/src/server/services/dejaview/ to langwatch/src/server/event-sourcing/pipelines/
const PIPELINE_ROOT = path.resolve(
  __dirname,
  "../../../../..",
  "langwatch",
  "src",
  "server",
  "event-sourcing",
  "pipelines"
);

export interface DiscoveredProjection {
  id: string;
  pipelineName: string;
  projectionName: string;
  filePath: string;
  definition: {
    init: () => unknown;
    apply: (state: unknown, event: unknown) => unknown;
    eventTypes: readonly string[];
  };
}

export interface DiscoveredEventHandler {
  id: string;
  pipelineName: string;
  handlerName: string;
  definition: {
    map: (event: unknown) => unknown;
    eventTypes: readonly string[];
  };
  eventTypes?: readonly string[];
  filePath?: string;
}

interface StaticPipelineDefinition {
  metadata: {
    name: string;
    aggregateType: string;
  };
  foldProjections: Map<string, { definition: DiscoveredProjection["definition"] }>;
  mapProjections: Map<string, { definition: DiscoveredEventHandler["definition"] }>;
  commands: unknown[];
}

interface DiscoveredPipeline {
  name: string;
  aggregateType: string;
  pipeline: StaticPipelineDefinition;
  pipelineFilePath: string;
}

function isStaticPipelineDefinition(value: unknown): value is StaticPipelineDefinition {
  if (typeof value !== "object" || value === null) return false;
  const def = value as Record<string, unknown>;
  return (
    typeof def.metadata === "object" &&
    def.metadata !== null &&
    typeof (def.metadata as Record<string, unknown>).name === "string" &&
    typeof (def.metadata as Record<string, unknown>).aggregateType === "string" &&
    def.foldProjections instanceof Map &&
    def.mapProjections instanceof Map &&
    Array.isArray(def.commands)
  );
}

/**
 * Creates a deep proxy that satisfies any interface at runtime.
 * Used to call pipeline factory functions without real dependencies.
 * The proxy returns itself for any property access or function call.
 */
function createStubProxy(): unknown {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      // Allow Symbol.toPrimitive and toString for logging
      if (prop === Symbol.toPrimitive) return () => "stub";
      if (prop === "toString") return () => "stub";
      if (prop === Symbol.iterator) return undefined;
      return proxy;
    },
    apply() {
      return proxy;
    },
    construct() {
      return proxy as object;
    },
  };

  const proxy: unknown = new Proxy(function () {}, handler);
  return proxy;
}

async function importPipeline(modulePath: string): Promise<Record<string, unknown>> {
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

let cachedPipelines: DiscoveredPipeline[] | null = null;

async function discoverPipelines(): Promise<DiscoveredPipeline[]> {
  if (cachedPipelines) return cachedPipelines;

  const pattern = path.join(PIPELINE_ROOT, "**/pipeline.ts");
  const files = await fg(pattern, { absolute: true });
  const results: DiscoveredPipeline[] = [];

  for (const file of files) {
    try {
      const moduleExports = await importPipeline(file);

      for (const [exportName, exported] of Object.entries(moduleExports)) {
        // First check if it's already a static definition (direct export)
        if (isStaticPipelineDefinition(exported)) {
          results.push({
            name: exported.metadata.name,
            aggregateType: exported.metadata.aggregateType,
            pipeline: exported,
            pipelineFilePath: file,
          });
          break;
        }

        // If it's a factory function (e.g., createTraceProcessingPipeline(deps)),
        // call it with a stub proxy to get the static definition
        if (typeof exported === "function" && exportName.startsWith("create")) {
          try {
            const stubDeps = createStubProxy();
            const result = exported(stubDeps);
            if (isStaticPipelineDefinition(result)) {
              results.push({
                name: result.metadata.name,
                aggregateType: result.metadata.aggregateType,
                pipeline: result,
                pipelineFilePath: file,
              });
              break;
            }
          } catch {
            // Factory call failed — skip this export
          }
        }
      }
    } catch (error) {
      console.warn(`Deja View: failed to import pipeline ${file}:`, error instanceof Error ? error.message : error);
    }
  }

  cachedPipelines = results;
  return results;
}

export async function discoverProjections(): Promise<DiscoveredProjection[]> {
  const pipelines = await discoverPipelines();
  const results: DiscoveredProjection[] = [];

  for (const pipeline of pipelines) {
    const pipelineName = pipeline.pipeline.metadata.name;
    const pipelineDir = path.dirname(pipeline.pipelineFilePath);

    for (const [projectionName, { definition }] of pipeline.pipeline.foldProjections) {
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

export async function discoverEventHandlers(): Promise<DiscoveredEventHandler[]> {
  const pipelines = await discoverPipelines();
  const results: DiscoveredEventHandler[] = [];

  for (const pipeline of pipelines) {
    const pipelineName = pipeline.pipeline.metadata.name;
    const pipelineDir = path.dirname(pipeline.pipelineFilePath);

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

export async function buildPipelineAggregateTypeMap(): Promise<Record<string, string>> {
  const pipelines = await discoverPipelines();
  const map: Record<string, string> = {};
  for (const pipeline of pipelines) {
    map[pipeline.name] = pipeline.pipeline.metadata?.aggregateType ?? pipeline.aggregateType;
  }
  return map;
}

export async function discoverLinks(): Promise<Map<string, { aggregateType: string; childLinks: { fromAggregateType: string; toAggregateType: string }[] }>> {
  const pipelines = await discoverPipelines();
  const linkMap = new Map<string, { aggregateType: string; childLinks: { fromAggregateType: string; toAggregateType: string }[] }>();

  for (const pipeline of pipelines) {
    if (!linkMap.has(pipeline.aggregateType)) {
      linkMap.set(pipeline.aggregateType, {
        aggregateType: pipeline.aggregateType,
        childLinks: [],
      });
    }
  }

  return linkMap;
}
