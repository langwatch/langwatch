import {
  SCENARIO_TAB_NAVIGATE_EVENT,
  type ScenarioTabNavigatePayload,
} from "./scenario-tab-events";
import {
  SCENARIO_TAB_REFRESH_MS,
  scenarioTabRegistry,
} from "./scenario-tab-registry";

export interface ScenarioTabRegistration {
  projectId: string;
  tabKey: string;
  tabId: string;
}

export interface ScenarioTabPresence {
  /**
   * A run handed to this tab while it was between subscriptions, ready to be
   * emitted the moment the new one starts. Null when nothing was waiting.
   */
  parkedNavigate: ScenarioTabNavigatePayload | null;
  /** Stop refreshing and retire the tab. Safe to call once, from a `finally`. */
  stop: () => Promise<void>;
}

/**
 * Keep a browser tab claimable for as long as its subscription lives.
 *
 * Presence is refreshed from the server rather than the browser: a background
 * tab's timers get throttled to once a minute, which would expire presence on
 * exactly the tab this feature exists to reuse.
 */
export async function startScenarioTabPresence(
  registration: ScenarioTabRegistration,
): Promise<ScenarioTabPresence> {
  await scenarioTabRegistry.register(registration);

  const refreshTimer = setInterval(() => {
    void scenarioTabRegistry.register(registration);
  }, SCENARIO_TAB_REFRESH_MS);

  // A handoff broadcast while this tab was reloading would have been lost,
  // even though the SDK was told it was delivered. Claim it now.
  const pending = await scenarioTabRegistry.takePendingNavigate({
    projectId: registration.projectId,
    tabKey: registration.tabKey,
  });

  return {
    parkedNavigate: pending
      ? {
          event: SCENARIO_TAB_NAVIGATE_EVENT,
          tabKey: registration.tabKey,
          url: pending,
        }
      : null,
    async stop() {
      clearInterval(refreshTimer);
      await scenarioTabRegistry.unregister(registration);
    },
  };
}
