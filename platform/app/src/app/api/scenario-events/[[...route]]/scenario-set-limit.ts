import { createLogger } from "@langwatch/observability";
import { VOICE_CALL_SCENARIO_SET_ID } from "~/server/agents/voice/voice-agent.config";
import { getApp } from "~/server/app-layer/app";
import { resolveOrganizationId } from "~/server/organizations/resolveOrganizationId";
import { AGENT_TEST_SET_SUFFIX } from "~/server/scenarios/agent-test-scenario";
import { isInternalSetId } from "~/server/scenarios/internal-set-id";
import { ScenarioEventType } from "~/server/scenarios/scenario-event.enums";

const logger = createLogger("langwatch:api:scenario-events:scenario-set-limit");

export interface ScenarioSetLimitContext {
  project: { id: string };
  event: { type: string; scenarioSetId?: string };
}

/**
 * Whether a set counts as a simulation against the plan's cap. Platform-owned
 * sets (internal suite and on-platform runs, agent tests, voice calls) are
 * left out, matching what the distinct-set count leaves out.
 */
export function isCountedScenarioSet(scenarioSetId: string): boolean {
  return (
    !isInternalSetId(scenarioSetId) &&
    !scenarioSetId.endsWith(AGENT_TEST_SET_SUFFIX) &&
    scenarioSetId !== VOICE_CALL_SCENARIO_SET_ID
  );
}

/**
 * Checks the simulation (scenario set) cap when a run starts.
 *
 * Only RUN_STARTED events are checked, and only for sets the organization has
 * not run before, so existing simulations keep running on a plan whose cap
 * they already exceed. A refusal is a LimitExceededError (403 with
 * limitType, current and max).
 */
export async function checkScenarioSetLimitForRunStarted(
  ctx: ScenarioSetLimitContext,
): Promise<void> {
  if (ctx.event.type !== ScenarioEventType.RUN_STARTED) return;

  const scenarioSetId = ctx.event.scenarioSetId;
  if (!scenarioSetId || !isCountedScenarioSet(scenarioSetId)) return;

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
