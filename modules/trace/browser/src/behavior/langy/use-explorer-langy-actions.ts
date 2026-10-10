import { nowInstant } from "@langwatch/time";
import {
  type AnyExplorerTransform,
  EXPLORER_ACTION_KINDS,
  EXPLORER_ACTIONS,
  type ExplorerActionKind,
  type ExplorerGrouping,
  queryWithoutInstantEvalChips,
} from "@langwatch/trace-contract";
import { useMemo } from "react";
import type { z } from "zod";

import { type LiveExplorerRead, readLiveExplorer } from "../../model/explorer/explorer-read.ts";
import { LENS_CAPABILITIES } from "../../model/lens-capabilities.ts";
import { useExplorerStore } from "../explorer.store.ts";
import { commitExplorerState, readExplorerState } from "../explorer/commit-explorer-state.ts";
import { useOptionalTraceHost } from "../trace-host.ts";
import { requestInstantEvalRoute } from "./instant-eval-route.bridge.ts";

/**
 * The shape Langy's `useRegisterLangyActions` takes, stated structurally so
 * the Explorer's handlers are built and tested without Langy's browser half.
 */
interface ExplorerLangyActionHandler {
  payloadSchema: z.ZodTypeAny;
  run: (payload: never) => unknown;
}

export type ExplorerLangyActionHandlers = Record<string, ExplorerLangyActionHandler>;

/** A refusal `executeUiAction` reports back by its `code`. */
class ExplorerActionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ExplorerActionError";
  }
}

/** The lens whose rows are conversations, so its eval judges threads. */
const CONVERSATIONS_LENS_ID = "conversations";

/** How long a read waits for the list to answer the state it is reading. */
const SETTLE_TIMEOUT_MS = 6_000;
const SETTLE_POLL_MS = 100;

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
 * when the wait runs out: a filter applied a moment ago has not been searched
 * yet, and the previous search's count would read as this one's.
 */
async function waitForSettledCount(): Promise<boolean> {
  const deadline = nowInstant().epochMilliseconds + SETTLE_TIMEOUT_MS;
  while (!isCountSettled()) {
    if (nowInstant().epochMilliseconds >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS));
  }
  return true;
}

async function readState(): Promise<LiveExplorerRead & { isCountSettled: boolean }> {
  const settled = await waitForSettledCount();
  const store = useExplorerStore.getState();
  const lens = store.allLenses.find((candidate) => candidate.id === store.activeLensId);
  const read = readLiveExplorer({
    state: readExplorerState(store),
    results: store.results,
    ...(lens ? { lensName: lens.name } : {}),
  });
  // A count that did not settle in time is not this state's count.
  return settled
    ? { ...read, isCountSettled: true }
    : { ...read, totalHits: null, pageTraceIds: [], isCountSettled: false };
}

/** What the page's own table knows, which an away caller has no way to know. */
function pageCapabilities(grouping: ExplorerGrouping) {
  return {
    sortableColumnIds: LENS_CAPABILITIES[grouping].sortableColumnIds,
    defaultSortFor: (mode: ExplorerGrouping) => LENS_CAPABILITIES[mode].defaultSort,
  };
}

function transformHandler(
  kind: ExplorerActionKind,
  transform: AnyExplorerTransform,
): ExplorerLangyActionHandler {
  return {
    payloadSchema: EXPLORER_ACTIONS[kind].payloadSchema,
    run: (payload: never) => {
      const store = useExplorerStore.getState();
      const state = readExplorerState(store);
      const applied = transform({
        state,
        payload,
        context: {
          lenses: store.allLenses,
          totalHits: store.results.isSettled ? store.results.totalHits : null,
          ...pageCapabilities(state.grouping),
        },
      });
      commitExplorerState(applied.state);
      return applied.result ?? {};
    },
  };
}

type RunInstantEvalPayload = z.output<
  (typeof EXPLORER_ACTIONS)["explorer.runInstantEval"]["payloadSchema"]
>;

function runInstantEval({
  projectId,
  payload,
}: {
  projectId: string;
  payload: RunInstantEvalPayload;
}) {
  const store = useExplorerStore.getState();
  const target =
    payload.target ?? (store.activeLensId === CONVERSATIONS_LENS_ID ? "threads" : "traces");
  const otherQuery = queryWithoutInstantEvalChips(store.queryText);
  const accepted = requestInstantEvalRoute({
    projectId,
    sentence: payload.instructions,
    question: { instructions: payload.instructions, criteria: payload.criteria },
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
 * The handlers the Trace Explorer registers with Langy while it is open. A
 * transform kind commits through the store's own actions, so Langy and a click
 * are the same write. @see specs/langy/langy-trace-explorer-actions.feature
 */
export function useExplorerLangyActions(): ExplorerLangyActionHandlers {
  const projectId = useOptionalTraceHost()?.project()?.id;

  return useMemo(() => {
    const handlers: ExplorerLangyActionHandlers = {};
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
