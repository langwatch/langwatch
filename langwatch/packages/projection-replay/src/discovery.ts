import path from "node:path";
import { pathToFileURL } from "node:url";
import fg from "fast-glob";
import type { FoldProjectionDefinition } from "../../../src/server/event-sourcing/library/projections/foldProjection.types";
import type { Event } from "../../../src/server/event-sourcing/library/domain/types";
import { pipelineRoot } from "./paths";

export interface DiscoveredFoldProjection {
  projectionName: string;
  pipelineName: string;
  source: "pipeline" | "global";
  definition: FoldProjectionDefinition<any, Event>;
  /** Queue name for this projection (needed for drain step). */
  queueName: string;
}

/**
 * Discovers all fold projections from pipeline definitions and the global registry.
 */
export async function discoverAllFoldProjections(): Promise<DiscoveredFoldProjection[]> {
  const results: DiscoveredFoldProjection[] = [];

  // 1. Discover from pipeline.ts files
  const pattern = path.join(pipelineRoot, "**/pipeline.ts");
  const files = await fg(pattern, { absolute: true });

  for (const file of files) {
    try {
      const url = pathToFileURL(file).href;
      const moduleExports = await import(url);

      for (const exported of Object.values(moduleExports)) {
        if (isStaticPipelineDefinition(exported)) {
          const pipelineName = (exported as any).metadata.name as string;

          for (const [projectionName, { definition }] of (exported as any).foldProjections as Map<
            string,
            { definition: FoldProjectionDefinition<any, Event> }
          >) {
            results.push({
              projectionName,
              pipelineName,
              source: "pipeline",
              definition,
              queueName: `{${pipelineName}/projection/${projectionName}}`,
            });
          }
          break;
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const short = path.relative(pipelineRoot, file);
      console.error(`  [skip] ${short}: ${msg.split("\n")[0]}`);
    }
  }

  // 2. Discover from global registry
  try {
    const registryModule = await import(
      "../../../src/server/event-sourcing/projections/global/registry"
    );
    const registry = registryModule.getGlobalProjectionRegistry();

    const registryAny = registry as any;
    const foldProjections = registryAny.foldProjections as
      | Map<string, FoldProjectionDefinition<any, Event>>
      | undefined;

    if (foldProjections) {
      for (const [name, definition] of foldProjections) {
        results.push({
          projectionName: name,
          pipelineName: "global_projections",
          source: "global",
          definition,
          queueName: `{global_projections/projection/${name}}`,
        });
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`  [skip] global registry: ${msg.split("\n")[0]}`);
  }

  return results;
}

/**
 * Find a specific fold projection by name.
 */
export async function findProjection(
  name: string,
): Promise<DiscoveredFoldProjection | null> {
  const all = await discoverAllFoldProjections();
  return all.find((p) => p.projectionName === name) ?? null;
}

function isStaticPipelineDefinition(exported: unknown): boolean {
  if (typeof exported !== "object" || exported === null) return false;
  const def = exported as Record<string, unknown>;
  return (
    typeof def.metadata === "object" &&
    def.metadata !== null &&
    typeof (def.metadata as any).name === "string" &&
    typeof (def.metadata as any).aggregateType === "string" &&
    def.foldProjections instanceof Map
  );
}
