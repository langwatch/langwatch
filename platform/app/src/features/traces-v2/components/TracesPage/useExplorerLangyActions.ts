import { useMemo } from "react";
import type {
  LangyUiActionHandler,
  LangyUiActionHandlers,
} from "~/features/langy/uiActions/types";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { queryWithoutInstantEvalChips } from "~/server/app-layer/traces/query-language/instantEvalChips";
import {
  commitExplorerState,
  readExplorerState,
} from "../../actions/commitExplorerState";
import {
  type InstantEvalProgress,
  type LiveExplorerRead,
  readLiveExplorer,
} from "../../actions/explorerRead";
import {
  EXPLORER_ACTION_KINDS,
  EXPLORER_ACTIONS,
  type ExplorerActionKind,
  type ExplorerActionPayload,
} from "../../actions/manifest";
import type { AnyExplorerTransform } from "../../actions/transforms/types";
import { useExplorerStore } from "../../stores/explorerStore";
import { useInstantEvalRunStore } from "../../stores/instantEvalRunStore";
import { requestInstantEvalRoute } from "./instantEvalRouteBridge";

/** The lens whose rows are conversations, so its eval judges threads. */
const CONVERSATIONS_LENS_ID = "conversations";

/** How long a read waits for the list to answer the state it is reading. */
const SETTLE_TIMEOUT_MS = 6_000;
const SETTLE_POLL_MS = 100;

/**
 * A failure the agent can act on, carried as a `code` the way a transform's
 * refusal is: `executeUiAction` reports a thrown handler's `code` back.
 */
class ExplorerActionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ExplorerActionError";
  }
}

/** Whether the list has answered the query and window the store now holds. */
function isCountSettled(): boolean {
  const store = useExplorerStore.getState();
  return (
    store.results.isSettled &&
    store.debouncedQueryText === store.queryText &&
    store.debouncedTimeRange === store.timeRange
  );
}

/**
 * Resolves once the count on screen is the count of the state on screen, or
 * when the wait runs out. A filter applied a moment ago has not been searched
 * yet, and the previous search's count would read as this one's.
 */
async function waitForSettledCount(): Promise<boolean> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  while (!isCountSettled()) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS));
  }
  return true;
}

function runningInstantEval(): InstantEvalProgress | null {
  const { evalRuns } = useExplorerStore.getState();
  const { runs, settled } = useInstantEvalRunStore.getState();
  for (const runId of Object.values(evalRuns)) {
    const run = runs[runId];
    // A run that ended but has not settled still moves the count.
    if (run && !settled[runId]) {
      return {
        runId: run.id,
        judged: run.progress,
        total: run.total,
        matched: run.matched ?? 0,
      };
    }
  }
  return null;
}

async function readState(): Promise<
  LiveExplorerRead & { isCountSettled: boolean }
> {
  const settled = await waitForSettledCount();
  const store = useExplorerStore.getState();
  const lens = store.allLenses.find(
    (candidate) => candidate.id === store.activeLensId,
  );
  const read = readLiveExplorer({
    state: readExplorerState(store),
    results: store.results,
    ...(lens ? { lensName: lens.name } : {}),
    instantEvalProgress: runningInstantEval(),
  });
  // A count that did not settle in time is not this state's count.
  return settled
    ? { ...read, isCountSettled: true }
    : { ...read, totalHits: null, pageTraceIds: [], isCountSettled: false };
}

function transformHandler(
  kind: ExplorerActionKind,
  transform: AnyExplorerTransform,
): LangyUiActionHandler {
  return {
    payloadSchema: EXPLORER_ACTIONS[kind].payloadSchema,
    run: (payload: never) => {
      const store = useExplorerStore.getState();
      const applied = transform({
        state: readExplorerState(store),
        payload,
        context: {
          lenses: store.allLenses,
          totalHits: store.results.isSettled ? store.results.totalHits : null,
        },
      });
      commitExplorerState(applied.state);
      return applied.result ?? {};
    },
  };
}

function runInstantEval({
  projectId,
  payload,
}: {
  projectId: string;
  payload: ExplorerActionPayload<"explorer.runInstantEval">;
}) {
  const store = useExplorerStore.getState();
  const target =
    payload.target ??
    (store.activeLensId === CONVERSATIONS_LENS_ID ? "threads" : "traces");
  const otherQuery = queryWithoutInstantEvalChips(store.queryText);
  const accepted = requestInstantEvalRoute({
    projectId,
    sentence: payload.instructions,
    question: {
      instructions: payload.instructions,
      criteria: payload.criteria,
    },
    target,
    otherQuery,
    // A refusal leaves the search as it was: there is no typed phrase here.
    fallbackQuery: otherQuery,
    timeRange: { from: store.timeRange.from, to: store.timeRange.to },
  });
  if (!accepted) {
    throw new ExplorerActionError(
      "explorer_search_unavailable",
      "The search bar is not on screen, so there is nowhere to show the run.",
    );
  }
  return { status: "requested" as const, target };
}

/**
 * The handlers the Trace Explorer registers with Langy while it is open
 * (specs/langy/langy-trace-explorer-actions.feature).
 *
 * Every kind in the manifest gets one. A transform kind reads the page state,
 * runs the pure transform with the page's lens list and count, and commits
 * the result through the store's own actions, so what Langy does and what a
 * click does are the same write. The read waits for the list to answer the
 * state it reads, so the count it reports is the one the header shows.
 */
export function useExplorerLangyActions(): LangyUiActionHandlers {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id;

  return useMemo(() => {
    const handlers: LangyUiActionHandlers = {};
    for (const kind of EXPLORER_ACTION_KINDS) {
      const definition = EXPLORER_ACTIONS[kind];
      if ("explorerTransform" in definition) {
        handlers[kind] = transformHandler(kind, definition.explorerTransform);
      }
    }
    handlers["explorer.getState"] = {
      payloadSchema: EXPLORER_ACTIONS["explorer.getState"].payloadSchema,
      run: () => readState(),
    };
    handlers["explorer.runInstantEval"] = {
      payloadSchema: EXPLORER_ACTIONS["explorer.runInstantEval"].payloadSchema,
      run: (payload: never) => {
        if (!projectId) {
          throw new ExplorerActionError(
            "explorer_project_unavailable",
            "The page has not resolved its project yet.",
          );
        }
        return runInstantEval({ projectId, payload });
      },
    };
    return handlers;
  }, [projectId]);
}
