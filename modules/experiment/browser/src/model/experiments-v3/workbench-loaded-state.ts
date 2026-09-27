/** A persisted workbench read back into the live store's state. */
import { normalizeEvaluators, normalizeTargets } from "@langwatch/experiment-contract";

import { createInitialResults, type EvaluationsV3State } from "./types.ts";

type PersistedResults = Record<string, unknown>;

/** The results a saved workbench carried, over empty ones; none when it carried none. */
const loadedResults = (
  persisted: PersistedResults | undefined,
): EvaluationsV3State["results"] | undefined =>
  persisted
    ? {
        ...createInitialResults(),
        runId: persisted.runId as string | undefined,
        versionId: persisted.versionId as string | undefined,
        targetOutputs: (persisted.targetOutputs as Record<string, unknown[]>) ?? {},
        targetMetadata:
          (persisted.targetMetadata as Record<
            string,
            { cost?: number; duration?: number; traceId?: string }[]
          >) ?? {},
        evaluatorResults:
          (persisted.evaluatorResults as Record<string, Record<string, unknown[]>>) ?? {},
        errors: (persisted.errors as Record<string, string[]>) ?? {},
      }
    : undefined;

/**
 * The current state with a saved workbench's fields laid over it. Experiments
 * saved before pairwise and N-way merged carry `pairwise`, and older ones name
 * targets `agents`: both are folded into today's shapes here, at the load boundary.
 */
export const loadedWorkbenchState = ({
  current,
  persisted,
}: {
  current: EvaluationsV3State;
  persisted: object;
}): EvaluationsV3State => {
  const state = persisted as Record<string, unknown>;
  const hiddenColumns = Array.isArray(state.hiddenColumns)
    ? new Set(state.hiddenColumns as string[])
    : current.ui.hiddenColumns;
  const concurrency =
    typeof state.concurrency === "number" ? state.concurrency : current.ui.concurrency;

  return {
    ...current,
    experimentId: (state.experimentId as string) ?? current.experimentId,
    experimentSlug: (state.experimentSlug as string) ?? current.experimentSlug,
    name: (state.name as string) ?? current.name,
    datasets: (state.datasets as typeof current.datasets) ?? current.datasets,
    activeDatasetId: (state.activeDatasetId as string) ?? current.activeDatasetId,
    evaluators: normalizeEvaluators(
      (state.evaluators as typeof current.evaluators) ?? current.evaluators,
    ),
    targets: normalizeTargets(
      (state.targets as typeof current.targets) ??
        (state.agents as typeof current.targets) ??
        current.targets,
    ),
    results: loadedResults(state.results as PersistedResults | undefined) ?? current.results,
    ui: { ...current.ui, hiddenColumns, concurrency },
  };
};
