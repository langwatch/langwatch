import type { NurturingApi } from "@langwatch/enterprise-nurturing-contract";
import type { SubscriberSpec } from "@langwatch/eventing";
import {
  SCENARIO_CREATED_EVENT_TYPE,
  type ScenarioLifecycleEvent,
} from "@langwatch/scenario-contract";

export type ScenarioCreatedNurturingDeps = Pick<NurturingApi, "recordSignal">;

/** Tells nurturing a scenario was created (§9); it sends the signal once per event. */
export function createScenarioCreatedNurturingSubscriber(
  nurturing: ScenarioCreatedNurturingDeps,
): SubscriberSpec<ScenarioLifecycleEvent> & { fold?: never; map?: never } {
  return {
    events: [SCENARIO_CREATED_EVENT_TYPE],
    handler: (event: ScenarioLifecycleEvent) =>
      nurturing.recordSignal({
        kind: "scenario_created",
        sourceEventId: event.id,
        tenantId: String(event.tenantId),
        occurredAt: event.occurredAt,
        ...event.data,
      }),
  };
}
