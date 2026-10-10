/**
 * A Trace Explorer page, without a browser.
 *
 * The scenario suites attach no page, so every `langwatch ui call explorer.*`
 * falls back to the backend and answers a link. This is the other half: a
 * headless object that hears the `ui` entry on the turn stream the adapter
 * already reads, claims it, runs the manifest's own transform over the state it
 * holds, and completes the action.
 *
 * Shared with the page: the manifest and its payload schemas, the transforms,
 * `readLiveExplorer`, `executeUiAction`, and the `tracesV2.list` procedure the
 * table reads its count from. Reimplemented: the commit. The page commits a
 * transform's result through its zustand store, which needs React and the
 * browser's storage; this tab holds the `ExplorerState` value itself. A read
 * runs the list for the state held, so the count it answers is the count the
 * table would show for that state.
 */

import type { LangyUiActionHandlers } from "~/features/langy/uiActions/types";
import {
  type LiveExplorerRead,
  readLiveExplorer,
} from "~/features/traces-v2/actions/explorerRead";
import {
  EXPLORER_ACTION_KINDS,
  EXPLORER_ACTIONS,
} from "~/features/traces-v2/actions/manifest";
import type { ExplorerState } from "~/features/traces-v2/actions/transforms/types";
import { defaultExplorerState } from "~/server/app-layer/langy/ui-actions/explorerBackendExecutor";
import { PROJECT_ID } from "./config";
import {
  createUiActionListener,
  type ObservedAction,
} from "./fake-tab-ui-actions";
import type { LangyAdapter } from "./langy-agent";
import { getSessionCookie, trpcQuery } from "./trpc";

/** The built-in lenses a scenario's ask can name. */
const BUILT_IN_LENSES = [
  { id: "all-traces", filterText: "", grouping: "flat" as const },
  { id: "conversations", filterText: "", grouping: "by-conversation" as const },
  { id: "errors", filterText: "status:error", grouping: "flat" as const },
].map((lens) => ({
  ...lens,
  sort: { columnId: "time", direction: "desc" as const },
  columns: [],
}));

export interface FakeExplorerTab {
  readonly seenActions: ReadonlyArray<{ actionId: string; kind: string }>;
  readonly claimedActions: ReadonlyArray<ObservedAction>;
  readonly droppedActions: ReadonlyArray<ObservedAction>;
  /** The page state this tab holds now. */
  state(): ExplorerState;
  /** What the table would show for a query over the window held now. */
  count(args: { query: string }): Promise<number>;
  close(): Promise<void>;
}

/** The count and the page of ids `tracesV2.list` answers for a state. */
async function readList({
  cookie,
  state,
}: {
  cookie: string;
  state: Pick<
    ExplorerState,
    "queryText" | "timeRange" | "sort" | "page" | "pageSize"
  >;
}): Promise<{ totalHits: number; pageTraceIds: string[] }> {
  const list = await trpcQuery<{
    totalHits: number;
    items: { traceId: string }[];
  }>({
    cookie,
    path: "tracesV2.list",
    input: {
      projectId: PROJECT_ID,
      timeRange: {
        from: state.timeRange.from,
        to: state.timeRange.to,
        live: !!state.timeRange.label,
      },
      sort: state.sort,
      page: state.page,
      pageSize: state.pageSize,
      query: state.queryText || undefined,
    },
  });
  return {
    totalHits: list.totalHits,
    pageTraceIds: list.items.map((item) => item.traceId),
  };
}

function buildHandlers({
  cookie,
  held,
}: {
  cookie: string;
  held: { state: ExplorerState };
}): LangyUiActionHandlers {
  const handlers: LangyUiActionHandlers = {};
  for (const kind of EXPLORER_ACTION_KINDS) {
    const definition = EXPLORER_ACTIONS[kind];
    if (!("explorerTransform" in definition)) continue;
    const transform = definition.explorerTransform;
    handlers[kind] = {
      payloadSchema: definition.payloadSchema,
      run: (payload: never) => {
        const applied = transform({
          state: held.state,
          payload,
          context: { lenses: BUILT_IN_LENSES, totalHits: null },
        });
        held.state = applied.state;
        return applied.result ?? {};
      },
    };
  }
  handlers["explorer.getState"] = {
    payloadSchema: EXPLORER_ACTIONS["explorer.getState"].payloadSchema,
    run: async (): Promise<LiveExplorerRead & { isCountSettled: boolean }> => {
      const list = await readList({ cookie, state: held.state });
      return {
        ...readLiveExplorer({
          state: held.state,
          results: { ...list, itemNoun: "traces", isSettled: true },
          instantEvalProgress: null,
        }),
        isCountSettled: true,
      };
    },
  };
  return handlers;
}

export async function openFakeExplorerTab({
  adapter,
}: {
  adapter: LangyAdapter;
}): Promise<FakeExplorerTab> {
  const cookie = await getSessionCookie();
  const held = { state: defaultExplorerState() };
  const seenActions: { actionId: string; kind: string }[] = [];
  const claimedActions: ObservedAction[] = [];
  const droppedActions: ObservedAction[] = [];
  const inFlight = new Set<Promise<unknown>>();

  const track = <T>(promise: Promise<T>): Promise<T> => {
    inFlight.add(promise);
    void promise.finally(() => inFlight.delete(promise));
    return promise;
  };

  const handleEntry = createUiActionListener({
    adapter,
    cookie,
    handlers: buildHandlers({ cookie, held }),
    seenKeys: new Set<string>(),
    seenActions,
    claimedActions,
    droppedActions,
    track,
  });
  adapter.onUiAction = handleEntry;

  return {
    seenActions,
    claimedActions,
    droppedActions,
    state: () => held.state,
    count: async ({ query }) =>
      (await readList({ cookie, state: { ...held.state, queryText: query } }))
        .totalHits,
    close: async () => {
      if (adapter.onUiAction === handleEntry) adapter.onUiAction = undefined;
      while (inFlight.size > 0) {
        await Promise.allSettled([...inFlight]);
      }
    },
  };
}
