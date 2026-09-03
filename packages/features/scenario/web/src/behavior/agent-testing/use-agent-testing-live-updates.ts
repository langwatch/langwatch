/**
 * The live-run subscription of the Agent Testing page.
 *
 * It refreshes the same query keys the v1 page refreshes, so a person moving
 * between the two interfaces never reads a stale list, and it steers a run
 * started from the SDK into this tab instead of a new browser tab.
 *
 * @see specs/features/agent-testing/page-structure.feature
 */

import { useCallback, useRef } from "react";
import type { ScenarioTabNavigatePayload } from "@langwatch/scenario-contract";
import { useScenarioTabFollow } from "../use-scenario-tab-follow";
import { useSimulationUpdateListener } from "../use-simulation-update-listener";
import { api } from "../scenario-api";
import { useRouter } from "../next-router";
import { toAgentTestingRunPath } from "./results/run-plans";

/**
 * Takes a run handed off by another tab. The address the handoff carries names
 * the v1 page, so it is read as the Agent Testing run it means.
 */
function useFollowRunInThisTab(): (payload: ScenarioTabNavigatePayload) => void {
  const router = useRouter();
  const lastFollowedRef = useRef<string | null>(null);

  return useCallback(
    (payload: ScenarioTabNavigatePayload) => {
      const target = new URL(payload.url);
      if (target.origin !== window.location.origin) return;
      const path = toAgentTestingRunPath(target.pathname) ?? target.pathname + target.search;
      if (path === window.location.pathname) return;
      // A handoff is parked as well as broadcast, so a tab that took the live
      // one and then re-subscribed is offered the same run again.
      if (lastFollowedRef.current === payload.url) return;
      lastFollowedRef.current = payload.url;
      void router.push(path);
    },
    [router],
  );
}

export function useAgentTestingLiveUpdates(projectId: string): {
  /** Travels to the results, where it decides whether polling runs at all. */
  isSseConnected: boolean;
} {
  const utils = api.useUtils();
  const scenarioTab = useScenarioTabFollow();
  const followRun = useFollowRunInThisTab();

  const { isConnected } = useSimulationUpdateListener({
    projectId,
    refetch: () => {
      void utils.suites.getSummaries.invalidate();
      void utils.scenarios.getExternalSetSummaries.invalidate();
      // The run number of a plan counts the runs of the window. A run that
      // just finished makes that count one higher, and a stale count names
      // the new run after the one before it.
      void utils.scenarios.getScenarioSetBatchRunCount.invalidate();
    },
    enabled: !!projectId,
    debounceMs: 500,
    tabKey: scenarioTab.tabKey,
    tabId: scenarioTab.tabId,
    onTabNavigate: followRun,
  });

  return { isSseConnected: isConnected };
}
