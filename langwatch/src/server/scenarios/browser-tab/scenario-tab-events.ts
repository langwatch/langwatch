/**
 * Wire shape of the "follow this run" nudge the SDK sends to an already-open
 * simulations tab. Rides the existing `simulation_updated` tenant broadcast so
 * the page needs no second SSE connection.
 *
 * Kept free of server-only imports: the browser parses this too.
 */

export const SCENARIO_TAB_NAVIGATE_EVENT = "scenario_tab_navigate";

/** Query param the SDK appends when it opens a tab, carrying the machine key. */
export const SCENARIO_TAB_QUERY_PARAM = "scenarioTab";

export interface ScenarioTabNavigatePayload {
  event: typeof SCENARIO_TAB_NAVIGATE_EVENT;
  /** Scenario tab key of the machine that started the run. */
  tabKey: string;
  /** Absolute URL of the batch to show. */
  url: string;
}

export function isScenarioTabNavigatePayload(
  value: unknown,
): value is ScenarioTabNavigatePayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ScenarioTabNavigatePayload>;
  return (
    candidate.event === SCENARIO_TAB_NAVIGATE_EVENT &&
    typeof candidate.tabKey === "string" &&
    candidate.tabKey.length > 0 &&
    typeof candidate.url === "string" &&
    candidate.url.length > 0
  );
}
