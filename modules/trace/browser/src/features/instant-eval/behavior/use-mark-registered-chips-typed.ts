import { useEffect } from "react";

import { useFilterStore, useViewStore } from "../../../behavior/explorer.store.ts";
import { useInstantEvalRunStore } from "./instant-eval-run.store.ts";
import { useInstantEvalRuns } from "./use-instant-eval-runs.ts";

/**
 * Marks each chip with a run registered under its key as submitted here, so a run a link
 * restored keeps a bare `NOT` chip pending, not read as an evaluator name, once the range changes.
 */
export function useMarkRegisteredChipsTyped(): void {
  const runsByKey = useFilterStore((s) => s.evalRuns);
  const projectId = useViewStore((s) => s.projectId);
  const { chips } = useInstantEvalRuns();
  useEffect(() => {
    if (!projectId) return;
    const { markTyped } = useInstantEvalRunStore.getState();
    for (const chip of chips) {
      if (runsByKey?.[chip.key]) markTyped({ projectId, question: chip.question });
    }
  }, [chips, runsByKey, projectId]);
}
