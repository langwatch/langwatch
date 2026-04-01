import path from "node:path";
import { pathToFileURL } from "node:url";
import fg from "fast-glob";
import type { Event } from "../../../src/server/event-sourcing/domain/types";
import type { FoldProjectionDefinition } from "../../../src/server/event-sourcing/projections/foldProjection.types";
import { pipelineRoot } from "./paths";

export interface DiscoveredFoldProjection {
  projectionName: string;
  pipelineName: string;
  aggregateType: string;
  source: "pipeline" | "global";
  definition: FoldProjectionDefinition<any, Event>;
  /** Pause key for the GroupQueue (used in drain step). */
  pauseKey: string;
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
          const metadata = (exported as any).metadata as {
            name: string;
            aggregateType: string;
          };
          const pipelineName = metadata.name;
          const aggregateType = metadata.aggregateType;

          for (const [projectionName, { definition }] of (exported as any).foldProjections as Map<
            string,
            { definition: FoldProjectionDefinition<any, Event> }
          >) {
            results.push({
              projectionName,
              pipelineName,
              aggregateType,
              source: "pipeline",
              definition,
              pauseKey: `${pipelineName}/projection/${projectionName}`,
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

  // 2. Discover global fold projections (registered directly, not via pipeline files)
  try {
    const globalModule = await import(
      "../../../src/server/event-sourcing/projections/global/projectDailySdkUsage.foldProjection"
    );
    const projection = globalModule.projectDailySdkUsageProjection;
    if (projection && typeof projection.name === "string") {
      results.push({
        projectionName: projection.name,
        pipelineName: "global_projections",
        aggregateType: "global",
        source: "global",
        definition: projection,
        pauseKey: `global_projections/projection/${projection.name}`,
      });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`  [skip] global projections: ${msg.split("\n")[0]}`);
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
