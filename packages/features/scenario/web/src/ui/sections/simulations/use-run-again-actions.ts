/**
 * Running the same test case again from the run detail drawer: straight
 * against the remembered target, or through the modal when there is none.
 */

import { useCallback, useState } from "react";
import type { TargetValue } from "../scenarios/target-selector";
import { useDrawerRunCallbacks } from "../../../behavior/use-drawer-run-callbacks";
import { useRunScenario } from "../use-run-scenario";
import { useScenarioTarget } from "../use-scenario-target";

export function useRunAgainActions({
  scenarioId,
  projectId,
  projectSlug,
}: {
  scenarioId: string | undefined;
  projectId: string | undefined;
  projectSlug: string | undefined;
}) {
  const [runModalOpen, setRunModalOpen] = useState(false);
  const { onRunComplete, onRunFailed } = useDrawerRunCallbacks();

  const { runScenario, isRunning } = useRunScenario({
    projectId,
    projectSlug,
    onRunComplete,
    onRunFailed,
  });

  const {
    target: persistedTarget,
    setTarget: persistTarget,
    hasPersistedTarget,
  } = useScenarioTarget(scenarioId);

  const handleRunAgain = useCallback(
    async (target: TargetValue, shouldRemember: boolean) => {
      if (!scenarioId || !target) return;
      if (shouldRemember) persistTarget(target);
      try {
        await runScenario({ scenarioId, target });
      } catch (error) {
        console.error("Failed to run scenario:", error);
      }
      setRunModalOpen(false);
    },
    [scenarioId, persistTarget, runScenario],
  );

  const handleRunAgainClick = useCallback(() => {
    if (hasPersistedTarget && persistedTarget) {
      void handleRunAgain(persistedTarget, true);
    } else {
      setRunModalOpen(true);
    }
  }, [hasPersistedTarget, persistedTarget, handleRunAgain]);

  return {
    isRunning,
    runModalOpen,
    setRunModalOpen,
    persistedTarget,
    handleRunAgain,
    handleRunAgainClick,
  };
}
