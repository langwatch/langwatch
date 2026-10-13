import {
  SCENARIO_TAB_NAVIGATE_EVENT,
  type ScenarioTabNavigatePayload,
} from "./scenario-tab-events.ts";

export const SCENARIO_TAB_REFRESH_MS = 10_000;

export interface ScenarioTabRegistration {
  projectId: string;
  tabKey: string;
  tabId: string;
  now?: number;
}

/** A parked handoff is consumed by the read that finds it. */
export type TakenPendingNavigate = { taken: true; url: string } | { taken: false };

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

  abstract hasLiveTab(input: { projectId: string; tabKey: string; now?: number }): Promise<boolean>;

  abstract setPendingNavigate(input: {
    projectId: string;
    tabKey: string;
    url: string;
    now?: number;
  }): Promise<void>;

  abstract takePendingNavigate(input: {
    projectId: string;
    tabKey: string;
    now?: number;
  }): Promise<TakenPendingNavigate>;
}

/**
 * Keep a browser tab claimable for as long as its subscription lives.
 * Refreshed from the server, not the browser: a background tab's timers
 * throttle to once a minute, which would expire presence on that tab.
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
  const pending = await registry.takePendingNavigate({
    projectId: registration.projectId,
    tabKey: registration.tabKey,
  });

  return {
    parkedNavigate: pending.taken
      ? {
          event: SCENARIO_TAB_NAVIGATE_EVENT,
          tabKey: registration.tabKey,
          url: pending.url,
        }
      : null,
    async stop() {
      clearInterval(refreshTimer);
      await registry.unregister(registration);
    },
  };
}
