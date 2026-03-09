import { useCallback } from "react";
import { useDrawer } from "./useDrawer";

/**
 * Returns callbacks that navigate to the scenario run detail drawer.
 *
 * Shared between ScenarioRunDetailDrawer and ScenarioFormDrawer to avoid
 * duplicating the `openDrawer("scenarioRunDetail", ...)` pattern.
 */
export function useDrawerRunCallbacks() {
  const { openDrawer } = useDrawer();

  const onRunComplete = useCallback(
    (result: { scenarioRunId: string }) => {
      openDrawer("scenarioRunDetail", {
        urlParams: { scenarioRunId: result.scenarioRunId },
      });
    },
    [openDrawer],
  );

  return { onRunComplete, onRunFailed: onRunComplete };
}
