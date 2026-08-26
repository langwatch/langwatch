import {
  SCENARIO_TAB_NAVIGATE_EVENT,
  type ScenarioTabNavigatePayload,
} from "./scenario-tab-events";

export const SCENARIO_TAB_REFRESH_MS = 10_000;

export interface ScenarioTabRegistration {
  projectId: string;
  tabKey: string;
  tabId: string;
  now?: number;
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

/** Browser-presence lifecycle used by Scenario transports. */
export abstract class ScenarioTabRegistry {
  abstract register(input: ScenarioTabRegistration): Promise<void>;

  abstract unregister(input: ScenarioTabRegistration): Promise<void>;

  abstract hasLiveTab(input: {
    projectId: string;
    tabKey: string;
    now?: number;
  }): Promise<boolean>;

  abstract setPendingNavigate(input: {
    projectId: string;
    tabKey: string;
    url: string;
    now?: number;
  }): Promise<void>;

  abstract tryTakePendingNavigate(input: {
    projectId: string;
    tabKey: string;
    now?: number;
  }): Promise<string | null>;
}

/**
 * Keep a browser tab claimable for as long as its subscription lives.
 *
 * Presence is refreshed from the server rather than the browser: a background
 * tab's timers get throttled to once a minute, which would expire presence on
 * exactly the tab this feature exists to reuse.
 */
export async function startScenarioTabPresence({
  registration,
  registry,
}: {
  registration: ScenarioTabRegistration;
  registry: ScenarioTabRegistry;
}): Promise<ScenarioTabPresence> {
  await registry.register(registration);

  const refreshTimer = setInterval(() => {
    void registry.register(registration);
  }, SCENARIO_TAB_REFRESH_MS);

  // A handoff broadcast while this tab was reloading would have been lost,
  // even though the SDK was told it was delivered. Claim it now.
  const pending = await registry.tryTakePendingNavigate({
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
      await registry.unregister(registration);
    },
  };
}
