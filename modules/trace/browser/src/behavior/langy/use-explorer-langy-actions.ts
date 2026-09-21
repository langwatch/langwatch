import { nowInstant } from "@langwatch/time";
import { LENS_CAPABILITIES, useExplorerStore } from "@langwatch/trace-browser-kit";
import {
  type AnyExplorerTransform,
  EXPLORER_ACTION_KINDS,
  EXPLORER_ACTIONS,
  type ExplorerActionKind,
  type ExplorerGrouping,
} from "@langwatch/trace-contract";
import { useMemo } from "react";
import type { z } from "zod";

import { type LiveExplorerRead, readLiveExplorer } from "../../model/explorer/explorer-read.ts";
import { commitExplorerState, readExplorerState } from "../explorer/commit-explorer-state.ts";

/**
 * The shape Langy's `useRegisterLangyActions` takes, stated structurally so
 * the Explorer's handlers are built and tested without Langy's browser half.
 */
export interface ExplorerLangyActionHandler {
  payloadSchema: z.ZodTypeAny;
  run: (payload: never) => unknown;
}

export type ExplorerLangyActionHandlers = Record<string, ExplorerLangyActionHandler>;

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

/**
 * The handlers the Trace Explorer registers with Langy while it is open. A
 * transform kind commits through the store's own actions, so Langy and a click
 * are the same write. @see specs/langy/langy-trace-explorer-actions.feature
 */
export function useExplorerLangyActions(): ExplorerLangyActionHandlers {
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
    return handlers;
  }, []);
}
