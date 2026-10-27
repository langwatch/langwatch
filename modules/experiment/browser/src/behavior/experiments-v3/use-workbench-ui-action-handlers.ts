import {
  WORKBENCH_ACTION_KINDS,
  WORKBENCH_ACTIONS,
  pickWorkbenchActionNarration,
  readLiveWorkbench,
  scopeFromRunPayload,
} from "@langwatch/experiment-contract";
import { useMemo } from "react";

import { startAndIdentifyRun } from "../../model/experiments-v3/execution/run-identification.ts";
import {
  revealTargetColumn,
  targetColumnLabel,
} from "../../model/experiments-v3/reveal-target-column.ts";
import {
  LangyUiPageOutOfDateError,
  LangyUiSaveFailedError,
} from "../../model/langy/ui-actions/langy-ui-action-errors.ts";
import { type LangyUiActionHandlers } from "../../model/langy/ui-actions/langy-ui-action-types.ts";
import type { AutosaveOutcome } from "./use-autosave-evaluations-v3.ts";
import { useEvaluationsV3Store } from "./use-evaluations-v3-store.ts";
import type { useExecuteEvaluation } from "./use-execute-evaluation.ts";

/**
 * A page the server has moved past cannot write (autosave stands down there), so
 * answering "done" would tell the agent about a document only this tab can see.
 */
const assertPageIsCurrent = (): void => {
  if (useEvaluationsV3Store.getState().staleWorkbench) throw new LangyUiPageOutOfDateError();
};

/**
 * Persist, and answer only if the write landed and the page is still current:
 * a refusal, or staleness a broadcast raised meanwhile, is one answer to the agent.
 */
const saveThenRequireCurrent = async (saveNow: () => Promise<AutosaveOutcome>): Promise<void> => {
  const outcome = await saveNow();
  if (outcome === "failed") throw new LangyUiSaveFailedError();
  assertPageIsCurrent();
  if (outcome === "refused") throw new LangyUiPageOutOfDateError();
};

/**
 * The live UI actions this page executes for the agent
 * (specs/langy/langy-ui-actions.feature).
 */
export const useWorkbenchUiActionHandlers = ({
  executeEvaluation,
  saveNow,
  targetNames,
  setActionActivity,
  setRunTargetLabel,
}: {
  executeEvaluation: ReturnType<typeof useExecuteEvaluation>["execute"];
  saveNow: () => Promise<AutosaveOutcome>;
  targetNames: Record<string, string>;
  setActionActivity: (activity: string | null) => void;
  setRunTargetLabel: (label: string | null) => void;
}) => {
  return useMemo<LangyUiActionHandlers>(() => {
    const saveOrRefuse = () => saveThenRequireCurrent(saveNow);
    const handlers: LangyUiActionHandlers = {};
    for (const kind of WORKBENCH_ACTION_KINDS) {
      const definition = WORKBENCH_ACTIONS[kind];
      if (definition.backend !== "transform") continue;
      handlers[kind] = {
        payloadSchema: definition.payloadSchema,
        // Apply, then persist before answering. The agent reads a successful action as
        // "the document now says this", and its next step is usually a server-side one
        // — a run, a REST read, a version.
        run: async (payload: unknown) => {
          // Named while it works, so the panel's status line says what this
          // page is doing rather than falling back to a verb that claims
          // nothing. The edit itself is instant; the save after it is not.
          setActionActivity(pickWorkbenchActionNarration(kind));
          try {
            assertPageIsCurrent();
            const result = useEvaluationsV3Store.getState().applyWorkbenchAction({ kind, payload });
            await saveOrRefuse();
            // Every action that touches a column answers with its id. A new
            // column lands to the right of all the others, off the edge of a
            // wide workbench, so without this the reader watches a real change
            // happen out of sight and reads the step as nothing happening.
            const touched = (result as { targetId?: unknown } | undefined)?.targetId;
            if (typeof touched === "string") revealTargetColumn(touched);
            return result;
          } finally {
            setActionActivity(null);
          }
        },
      };
    }
    handlers["workbench.getState"] = {
      payloadSchema: WORKBENCH_ACTIONS["workbench.getState"].payloadSchema,
      run: (payload: { includeResults?: boolean }) =>
        readLiveWorkbench({
          state: useEvaluationsV3Store.getState(),
          ...payload,
          targetNames,
        }),
    };
    handlers["workbench.run"] = {
      payloadSchema: WORKBENCH_ACTIONS["workbench.run"].payloadSchema,
      run: async (payload: { targetIds?: string[]; rowIndices?: number[] }) => {
        // Remembered before the run starts, so the status line can name the
        // column the reader is watching fill rather than "the evaluation".
        const runningTarget = payload.targetIds?.[0] ?? null;
        setRunTargetLabel(runningTarget ? targetColumnLabel(runningTarget) : null);
        // Watch the column that is about to fill, not whichever one the
        // reader happened to be looking at.
        if (runningTarget) revealTargetColumn(runningTarget);
        // Only covers getting the run started: the save before it is the slow
        // part. Once cells are arriving the run reports its own progress, and
        // this is cleared so it cannot outlive the run it announced.
        setActionActivity(pickWorkbenchActionNarration("workbench.run"));
        try {
          // Persist first: a run writes its results back as a new version, so
          // any edit still sitting in this tab would be a version behind before
          // the first cell lands. A tab that cannot save is a tab whose columns
          // the run would not compute, so it refuses rather than running the
          // wrong document.
          assertPageIsCurrent();
          await saveOrRefuse();
          // The run itself streams into the table the user is watching and is not
          // waited for; only its id is.
          const runId = await startAndIdentifyRun({
            start: (onRunStarted) =>
              executeEvaluation(scopeFromRunPayload(payload), { onRunStarted }),
          });
          return { runId, status: "running" as const };
        } finally {
          setActionActivity(null);
        }
      },
    };
    return handlers;
  }, [executeEvaluation, saveNow, targetNames, setActionActivity, setRunTargetLabel]);
};
