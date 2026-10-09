/**
 * The fake workbench tab's handler table: one entry per workbench action, built
 * from the same manifest the page builds from.
 *
 * Every transform-backed action goes through the manifest rather than being
 * listed here, so an action added to the manifest is answered by this tab too.
 * The three that are not plain transforms state themselves.
 */

import { readLiveWorkbench } from "~/experiments-v3/actions/liveWorkbenchRead";
import {
  WORKBENCH_ACTION_KINDS,
  WORKBENCH_ACTIONS,
} from "~/experiments-v3/actions/manifest";
import { scopeFromRunPayload } from "~/experiments-v3/actions/runScope";
import { useEvaluationsV3Store } from "~/experiments-v3/hooks/useEvaluationsV3Store";
import type { LangyUiActionHandlers } from "~/features/langy/uiActions/types";
import type { ExecutionScope } from "~/server/experiments-v3/execution/types";

export function buildFakeTabHandlers({
  catchUpIfBehind,
  assertPageIsCurrent,
  saveOrRefuse,
  startRun,
}: {
  catchUpIfBehind: () => Promise<void>;
  assertPageIsCurrent: () => void;
  saveOrRefuse: () => Promise<void>;
  startRun: (scope: ExecutionScope) => Promise<string | undefined>;
}): LangyUiActionHandlers {
  const handlers: LangyUiActionHandlers = {};
  for (const kind of WORKBENCH_ACTION_KINDS) {
    const definition = WORKBENCH_ACTIONS[kind];
    if (definition.backend !== "transform") continue;
    handlers[kind] = {
      payloadSchema: definition.payloadSchema,
      run: async (payload: unknown) => {
        await catchUpIfBehind();
        assertPageIsCurrent();
        const result = useEvaluationsV3Store
          .getState()
          .applyWorkbenchAction({ kind, payload });
        await saveOrRefuse();
        return result;
      },
    };
  }
  handlers["workbench.getState"] = {
    payloadSchema: WORKBENCH_ACTIONS["workbench.getState"].payloadSchema,
    // No `targetNames`: resolving a prompt handle is a React hook on the real
    // page and this tab calls no hooks. The projection handles the absence and
    // falls back to what state alone can answer.
    run: async (payload: { includeResults?: boolean }) => {
      await catchUpIfBehind();
      return readLiveWorkbench({
        state: useEvaluationsV3Store.getState(),
        ...payload,
      });
    },
  };
  handlers["workbench.run"] = {
    payloadSchema: WORKBENCH_ACTIONS["workbench.run"].payloadSchema,
    run: async (payload: { targetIds?: string[]; rowIndices?: number[] }) => {
      await catchUpIfBehind();
      assertPageIsCurrent();
      await saveOrRefuse();
      const runId = await startRun(scopeFromRunPayload(payload));
      return { runId, status: "running" as const };
    },
  };

  return handlers;
}
