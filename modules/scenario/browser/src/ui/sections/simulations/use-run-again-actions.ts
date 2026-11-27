/**
 * Running the same scenario again from the run detail drawer: straight
 * against the remembered target, or through the modal, opened on the run's
 * own target, when there is none.
 */

import { createLogger } from "@langwatch/observability/browser";
import { useCallback, useState } from "react";

import {
  type RunSettledCallbacks,
  useDrawerRunCallbacks,
} from "../../../behavior/use-drawer-run-callbacks.ts";
import type { TargetValue } from "../../../model/scenario-target.ts";
import { useRunScenario } from "../use-run-scenario.ts";
import { useScenarioTarget } from "../use-scenario-target.ts";

const logger = createLogger("langwatch:scenario:run-again");

/** A connector run offers no keep data (scenario-run-hooks.feature), nor does a targetless run. */
function offersKeepData({ runTarget }: { runTarget?: TargetValue }): boolean {
  return Boolean(runTarget) && runTarget?.type !== "connector";
}

/** The modal opens on the remembered target, else on the run's own. */
function firstTarget({
  persistedTarget,
  runTarget,
}: {
  persistedTarget?: TargetValue;
  runTarget?: TargetValue;
}): TargetValue {
  return persistedTarget ?? runTarget ?? null;
}

export function useRunAgainActions({
  scenarioId,
  projectId,
  projectSlug,
  runTarget,
  runCallbacks,
}: {
  scenarioId: string | undefined;
  projectId: string | undefined;
  projectSlug: string | undefined;
  /** The target this run was pointed at; the modal opens on it and keep data reruns it. */
  runTarget?: TargetValue;
  /** Where a finished run goes; the drawer's runs-list navigation when absent. */
  runCallbacks?: RunSettledCallbacks;
}) {
  const [runModalOpen, setRunModalOpen] = useState(false);
  const drawerCallbacks = useDrawerRunCallbacks();
  const { onRunComplete, onRunFailed } = runCallbacks ?? drawerCallbacks;

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
        logger.error({ error }, "Failed to run scenario");
      }
      setRunModalOpen(false);
    },
    [scenarioId, persistTarget, runScenario],
  );

  // Keep data rides this one run alone: never remembered with the target, never saved to a plan.
  const rerunKeepingData = useCallback(() => {
    if (!scenarioId || !runTarget) return;
    runScenario({ scenarioId, target: runTarget, keepData: true }).catch((error: unknown) => {
      logger.error({ error }, "Failed to rerun scenario keeping its data");
    });
  }, [scenarioId, runTarget, runScenario]);
  const handleRunAgainKeepingData = offersKeepData({ runTarget }) ? rerunKeepingData : null;

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
    runAgainTarget: firstTarget({ persistedTarget, runTarget }),
    handleRunAgain,
    handleRunAgainClick,
    handleRunAgainKeepingData,
  };
}
