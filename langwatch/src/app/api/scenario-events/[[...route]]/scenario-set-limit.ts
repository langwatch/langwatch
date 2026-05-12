import { getApp } from "~/server/app-layer/app";
import { resolveOrganizationId } from "~/server/organizations/resolveOrganizationId";
import { ScenarioEventType } from "~/server/scenarios/scenario-event.enums";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:api:scenario-events:scenario-set-limit");

export interface ScenarioSetLimitContext {
  project: { id: string };
  event: { type: string; scenarioSetId?: string };
}

/**
 * Checks the scenario set limit for SCENARIO_RUN_STARTED events only.
 *
 * For all other event types, this is a no-op. For RUN_STARTED events,
 * resolves the organization from the project, then delegates to
 * UsageService.checkScenarioSetLimit. If the limit is exceeded,
 * the ScenarioSetLimitExceededError propagates to the caller.
 */
export async function checkScenarioSetLimitForRunStarted(
  ctx: ScenarioSetLimitContext,
): Promise<void> {
  if (ctx.event.type !== ScenarioEventType.RUN_STARTED) {
    return;
  }

  const scenarioSetId = ctx.event.scenarioSetId;
  if (!scenarioSetId) {
    return;
  }

  // Internal suite runs use a known set ID — not subject to external set limits
  if (scenarioSetId.startsWith("__internal__") && scenarioSetId.endsWith("__suite")) {
    return;
  }

  const organizationId = await resolveOrganizationId(ctx.project.id);
  if (!organizationId) {
    logger.warn(
      { projectId: ctx.project.id },
      "Could not resolve organizationId for scenario set limit check",
    );
    return;
  }

  await getApp().usage.checkScenarioSetLimit({
    organizationId,
    scenarioSetId,
  });
}
