/**
 * How the results of one run read: a table, or the wall of conversation cards. The
 * choice is kept in the address so a reload holds it.
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { useRouter } from "@langwatch/browser-host/use-router";
import { useCallback } from "react";

import { useAgentTestingStore } from "../use-agent-testing-store.ts";

export function useRunPlanViewMode() {
  const router = useRouter();
  const viewMode = useAgentTestingStore((state) => state.viewMode);
  const setViewMode = useAgentTestingStore((state) => state.setViewMode);
  const syncToUrl = useAgentTestingStore((state) => state.syncToUrl);

  const handleViewModeChange = useCallback(
    (next: typeof viewMode) => {
      setViewMode(next);
      syncToUrl(router);
    },
    [setViewMode, syncToUrl, router],
  );

  return { viewMode, handleViewModeChange };
}
