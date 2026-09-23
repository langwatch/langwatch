import type { SubscriberSpec } from "@langwatch/eventing";
import {
  SCENARIO_CREATED_EVENT_TYPE,
  type ScenarioCreatedEventData,
  type ScenarioLifecycleEvent,
} from "@langwatch/scenario-contract";

/** How long a created scenario's announcement is remembered against redelivery. */
const ANNOUNCED_WINDOW_SECONDS = 7 * 24 * 60 * 60;

export type ScenarioCreatedNurturingDeps = Readonly<{
  /** Billing's product analytics and nurturing for a created scenario. */
  announce: (signal: ScenarioCreatedEventData) => Promise<void>;
  /** True the first time a key is seen inside the window. */
  claim: (key: string, ttlSeconds: number) => Promise<boolean>;
}>;

/**
 * Tells billing a scenario was created, at most once as main did: the claim is
 * taken before billing is called, so a redelivered event announces nothing.
 */
export function createScenarioCreatedNurturingSubscriber(
  deps: ScenarioCreatedNurturingDeps,
): SubscriberSpec<ScenarioLifecycleEvent> & { fold?: never; map?: never } {
  return {
    events: [SCENARIO_CREATED_EVENT_TYPE],
    async handler(event: ScenarioLifecycleEvent): Promise<void> {
      const key = `scenario_created:${String(event.tenantId)}:${event.aggregateId}`;
      if (!(await deps.claim(key, ANNOUNCED_WINDOW_SECONDS))) return;
      await deps.announce(event.data);
    },
  };
}
