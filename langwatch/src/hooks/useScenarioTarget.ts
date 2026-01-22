import { useLocalStorage } from "usehooks-ts";
import type { TargetValue } from "../components/scenarios/TargetSelector";
import { useOrganizationTeamProject } from "./useOrganizationTeamProject";

interface PersistedTarget {
  type: "prompt" | "http";
  id: string;
  timestamp: number;
}

/**
 * Hook for persisting scenario target selection in localStorage.
 * Stores the last selected target per scenario for quick iteration.
 */
export function useScenarioTarget(scenarioId: string | undefined) {
  const { project } = useOrganizationTeamProject();

  const storageKey =
    scenarioId && project?.id
      ? `langwatch:scenario-target:${project.id}:${scenarioId}`
      : null;

  const [persistedTarget, setPersistedTarget] =
    useLocalStorage<PersistedTarget | null>(
      storageKey ?? "langwatch:scenario-target:temp",
      null,
    );

  const target: TargetValue =
    persistedTarget && storageKey
      ? { type: persistedTarget.type, id: persistedTarget.id }
      : null;

  const setTarget = (newTarget: TargetValue) => {
    if (!storageKey) return;

    if (newTarget) {
      setPersistedTarget({
        type: newTarget.type,
        id: newTarget.id,
        timestamp: Date.now(),
      });
    } else {
      setPersistedTarget(null);
    }
  };

  const clearTarget = () => {
    if (storageKey) {
      setPersistedTarget(null);
    }
  };

  return {
    target,
    setTarget,
    clearTarget,
    hasPersistedTarget: !!persistedTarget && !!storageKey,
  };
}
