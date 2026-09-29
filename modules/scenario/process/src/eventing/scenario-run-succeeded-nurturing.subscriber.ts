import type { NurturingApi } from "@langwatch/enterprise-nurturing-contract";
import type { SubscriberSpec } from "@langwatch/eventing";
import {
  SIMULATION_RUN_EVENT_TYPES,
  type SimulationProcessingEvent,
} from "@langwatch/scenario-contract";

import { isConnectedAgentRunSucceeded } from "../rules/scenario-run-milestones.rules.ts";

export type ScenarioRunSucceededNurturingDeps = Pick<NurturingApi, "recordSignal">;

/**
 * Tells nurturing a connected agent's run finished with a verdict, against the
 * admin the finished event carries (§9); one signal per event.
 */
export function createScenarioRunSucceededNurturingSubscriber(
  nurturing: ScenarioRunSucceededNurturingDeps,
): SubscriberSpec<SimulationProcessingEvent> & { fold?: never; map?: never } {
  return {
    events: [SIMULATION_RUN_EVENT_TYPES.FINISHED],
    when: (event) => isConnectedAgentRunSucceeded(event),
    async handler(event: SimulationProcessingEvent): Promise<void> {
      if (!isConnectedAgentRunSucceeded(event)) return;
      const admin = event.data.organizationAdmin;
      if (!admin) return;
      await nurturing.recordSignal({
        kind: "scenario_run_succeeded",
        sourceEventId: event.id,
        tenantId: String(event.tenantId),
        occurredAt: event.occurredAt,
        userId: admin.userId,
        projectId: String(event.tenantId),
        scenarioId: event.data.scenarioId,
        runId: event.data.scenarioRunId,
        onboardingVariant: admin.onboardingVariant,
      });
    },
  };
}
