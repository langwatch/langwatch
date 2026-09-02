import { useLocalStorage } from "usehooks-ts";
import type { TargetValue } from "../components/scenarios/TargetSelector";
import { useOrganizationTeamProject } from "../behavior/use-organization-team-project";

interface PersistedTarget {
  type: "prompt" | "http" | "code" | "workflow";
  id: string;
  timestamp: number;
}

/** Where the last target of one scenario is kept. */
export function scenarioTargetStorageKey({
  projectId,
  scenarioId,
}: {
  projectId: string;
  scenarioId: string;
}): string {
  return `langwatch:scenario-target:${projectId}:${scenarioId}`;
}

/**
 * The last target of one scenario, read outside React.
 *
 * A table has one row per scenario and a hook cannot be called per row, so the
 * rows read the same store through this function. The key and the shape are
 * defined once, here.
 */
export function readScenarioTarget({
  projectId,
  scenarioId,
}: {
  projectId: string;
  scenarioId: string;
}): TargetValue {
  if (typeof window === "undefined") return null;
  if (!projectId || !scenarioId) return null;
  try {
    const raw = localStorage.getItem(
      scenarioTargetStorageKey({ projectId, scenarioId }),
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedTarget | null;
    if (!parsed?.type || !parsed?.id) return null;
    return { type: parsed.type, id: parsed.id };
  } catch {
    return null;
  }
}

/** Remembers the target one scenario last ran against. */
export function writeScenarioTarget({
  projectId,
  scenarioId,
  target,
}: {
  projectId: string;
  scenarioId: string;
  target: TargetValue;
}): void {
  if (typeof window === "undefined") return;
  if (!projectId || !scenarioId || !target) return;
  try {
    localStorage.setItem(
      scenarioTargetStorageKey({ projectId, scenarioId }),
      JSON.stringify({
        type: target.type,
        id: target.id,
        timestamp: Date.now(),
      } satisfies PersistedTarget),
    );
  } catch {
    // localStorage unavailable
  }
}

/**
 * Hook for persisting scenario target selection in localStorage.
 * Stores the last selected target per scenario for quick iteration.
 */
export function useScenarioTarget(scenarioId: string | undefined) {
  const { project } = useOrganizationTeamProject();

  const storageKey =
    scenarioId && project?.id
      ? scenarioTargetStorageKey({ projectId: project.id, scenarioId })
      : null;

  const [persistedTarget, setPersistedTarget] = useLocalStorage<PersistedTarget | null>(
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
