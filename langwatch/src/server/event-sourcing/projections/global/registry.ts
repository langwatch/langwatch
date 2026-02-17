import type { Event } from "../../library/domain/types";
import { ProjectionRegistry } from "../../library/projections/projectionRegistry";
import { projectDailyBillableEventsProjection } from "./projectDailyBillableEvents.foldProjection";
import { projectDailySdkUsageProjection } from "./projectDailySdkUsage.foldProjection";

/**
 * Global projection registry singleton.
 * Receives events from all pipelines and dispatches to cross-pipeline projections.
 */
let globalRegistry: ProjectionRegistry<Event> | null = null;

export function getGlobalProjectionRegistry(): ProjectionRegistry<Event> {
  if (!globalRegistry) {
    globalRegistry = new ProjectionRegistry<Event>();

    const isSaas =
      process.env.IS_SAAS === "1" ||
      process.env.IS_SAAS?.toLowerCase() === "true";
    if (isSaas) {
      globalRegistry.registerFoldProjection(projectDailySdkUsageProjection);
      globalRegistry.registerFoldProjection(
        projectDailyBillableEventsProjection,
      );
    }
  }
  return globalRegistry;
}

export function resetGlobalProjectionRegistry(): void {
  globalRegistry = null;
}
