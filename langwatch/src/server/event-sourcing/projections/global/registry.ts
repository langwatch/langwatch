import type { Event } from "../../library/domain/types";
import { ProjectionRegistry } from "../../library/projections/projectionRegistry";
import { tenantDailyEventCountProjection } from "./tenantDailyEventCount.foldProjection";

/**
 * Global projection registry singleton.
 * Receives events from all pipelines and dispatches to cross-pipeline projections.
 */
let globalRegistry: ProjectionRegistry<Event> | null = null;

export function getGlobalProjectionRegistry(): ProjectionRegistry<Event> {
  if (!globalRegistry) {
    globalRegistry = new ProjectionRegistry<Event>();
    globalRegistry.registerFoldProjection(tenantDailyEventCountProjection);
  }
  return globalRegistry;
}

export function resetGlobalProjectionRegistry(): void {
  globalRegistry = null;
}
