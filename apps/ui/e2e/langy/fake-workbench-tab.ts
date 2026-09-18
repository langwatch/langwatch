/**
 * A workbench page, without a browser: claims the `ui` entry the adapter
 * reads when no real page attaches, driving the same store/transforms.
 * ONE TAB PER PROCESS — the store is a singleton, so a second tab is refused.
 */

import { startAndIdentifyRun } from "@langwatch/experiment-browser/workbench-run-identification";
import { useEvaluationsV3Store } from "@langwatch/experiment-browser/workbench-store";
import { readLiveWorkbench } from "@langwatch/experiment-contract";
import type { ExecutionScope } from "@langwatch/experiment-contract";

import { createFakeTabDocument } from "./fake-tab-document";
import { buildFakeTabHandlers } from "./fake-tab-handlers";
import { createFakeTabRunner, type FakeTabRun } from "./fake-tab-run";
import { createUiActionListener, type ObservedAction } from "./fake-tab-ui-actions";
import type { LangyAdapter } from "./langy-agent";
import { getSessionCookie } from "./trpc";

export interface FakeWorkbenchTab {
  /** Every `ui` entry this tab SAW, claimed or not. */
  readonly seenActions: readonly { actionId: string; kind: string }[];
  /** Every action this tab claimed and carried out, in order. */
  readonly claimedActions: readonly ObservedAction[];
  /** Every action this tab saw and did NOT claim, with how long it waited. */
  readonly droppedActions: readonly ObservedAction[];
  /** Every run this tab started, in order. */
  readonly runs: readonly FakeTabRun[];
  /** The live store, projected the way `workbench.getState` answers. */
  state(): ReturnType<typeof readLiveWorkbench>;
  /** The version this tab holds, as the last save left it. */
  version(): number | undefined;
  /** Start a run and wait for the whole stream. The page never does this. */
  runToCompletion(scope: ExecutionScope): Promise<FakeTabRun>;
  /** Re-read the saved document and clear the out-of-date flag. */
  reload(): Promise<void>;
  /** Detach from the stream, then await every in-flight handler and drain. */
  close(): Promise<void>;
}

/**
 * The store is a module singleton: one tab per process. `isOpening` is
 * claimed before the first `await`, since `openTab` itself is only set at
 * the end — two overlapping opens would both pass a check on it alone.
 */
let openTab: FakeWorkbenchTab | null = null;
let isOpening = false;

export async function openFakeWorkbenchTab({
  adapter,
  experimentSlug,
}: {
  /**
   * The conversation this tab listens to. Omitted for a tab that only drives
   * the workbench directly, which is how the harness test exercises the run
   * path without spending a Langy turn.
   */
  adapter?: LangyAdapter;
  experimentSlug: string;
}): Promise<FakeWorkbenchTab> {
  if (openTab || isOpening) {
    throw new Error(
      "A fake workbench tab is already open in this process. The workbench store is a module singleton, so two tabs would drive the same board: close the first one before opening another.",
    );
  }
  isOpening = true;

  try {
    return await open({ adapter, experimentSlug });
  } finally {
    isOpening = false;
  }
}

async function open({
  adapter,
  experimentSlug,
}: {
  adapter?: LangyAdapter;
  experimentSlug: string;
}): Promise<FakeWorkbenchTab> {
  const cookie = await getSessionCookie();
  const seenActions: { actionId: string; kind: string }[] = [];
  const claimedActions: ObservedAction[] = [];
  const droppedActions: ObservedAction[] = [];
  const runs: FakeTabRun[] = [];
  const inFlight = new Set<Promise<unknown>>();
  const seenKeys = new Set<string>();
  const { load, saveNow, catchUpIfBehind, assertPageIsCurrent, saveOrRefuse } =
    createFakeTabDocument({ cookie, experimentSlug });

  await load();

  const { drainRun } = createFakeTabRunner({ cookie, runs, saveNow });

  /** Track a background promise so `close()` can await it. */
  const track = <T>(promise: Promise<T>): Promise<T> => {
    inFlight.add(promise);
    void promise.finally(() => inFlight.delete(promise));
    return promise;
  };

  /**
   * Starts a run and answers with its id, never its result: tracked rather
   * than returned, since the tab keeps draining after the action answers,
   * keeping `workbench.run` inside its 30-second dispatch budget.
   */
  const startRun = (scope: ExecutionScope): Promise<string | undefined> =>
    startAndIdentifyRun({
      start: (onRunStarted) => {
        void track(drainRun({ scope, onRunStarted }));
      },
    });

  const handlers = buildFakeTabHandlers({
    catchUpIfBehind,
    assertPageIsCurrent,
    saveOrRefuse,
    startRun,
  });

  const handleEntry = createUiActionListener({
    adapter,
    cookie,
    handlers,
    seenKeys,
    seenActions,
    claimedActions,
    droppedActions,
    track,
  });

  if (adapter) adapter.onUiAction = handleEntry;

  const tab = buildTabFacade({
    log: { seenActions, claimedActions, droppedActions, runs },
    reload: load,
    runToCompletion: (scope) => track(drainRun({ scope, onRunStarted: () => undefined })),
    detach: () => {
      if (adapter?.onUiAction === handleEntry) adapter.onUiAction = undefined;
    },
    inFlight,
  });

  openTab = tab;
  return tab;
}

/**
 * The object the suites hold: what the tab saw, what the store says, and the
 * close that has to settle every background promise before the next test.
 */
function buildTabFacade({
  log,
  reload,
  runToCompletion,
  detach,
  inFlight,
}: {
  log: {
    seenActions: { actionId: string; kind: string }[];
    claimedActions: ObservedAction[];
    droppedActions: ObservedAction[];
    runs: FakeTabRun[];
  };
  reload: () => Promise<void>;
  runToCompletion: (scope: ExecutionScope) => Promise<FakeTabRun>;
  detach: () => void;
  inFlight: Set<Promise<unknown>>;
}): FakeWorkbenchTab {
  return {
    get seenActions() {
      return log.seenActions;
    },
    get claimedActions() {
      return log.claimedActions;
    },
    get droppedActions() {
      return log.droppedActions;
    },
    get runs() {
      return log.runs;
    },
    state: () => readLiveWorkbench({ state: useEvaluationsV3Store.getState() }),
    version: () => useEvaluationsV3Store.getState().workbenchVersion,
    runToCompletion,
    reload,
    close: async () => {
      detach();
      // Settled in waves: a claimed action can start a run, and the run's
      // drain is only tracked once the handler reaches it.
      while (inFlight.size > 0) {
        await Promise.allSettled(inFlight);
      }
      useEvaluationsV3Store.getState().reset();
      openTab = null;
    },
  };
}
