/**
 * A workbench page, without a browser.
 *
 * The scenario suites drive Langy through the real product surface but attach
 * no page, so every `langwatch ui call workbench.*` the agent runs falls back to
 * the backend after the 3 second claim window. This is the other half: a
 * headless object that does what the open page does: it hears the `ui` entry on
 * the turn stream the adapter is already reading, claims the action, applies the
 * same shared transform to the same store, saves with `expectedVersion`, and
 * completes the action. For `workbench.run` it posts the same
 * `POST /api/experiments/execute` request the page posts and drains the same
 * stream.
 *
 * Nothing is reimplemented that the page shares: the manifest, the store, the
 * transforms, `executeUiAction`, `buildExecutionRequest`, `resultsFold`,
 * `readLiveWorkbench` and `scopeFromRunPayload` are the app's own modules,
 * imported through the `~/` alias this suite's vitest config declares. What
 * IS reimplemented is the page's autosave (a React hook) and the page's SSE
 * client (`fetchSSE` needs an origin the browser supplies), and both are kept
 * to the shape the page's own code has.
 *
 * ONE TAB PER PROCESS. The store is a module singleton, so a second concurrent
 * tab would drive the same state. `fileParallelism: false` plus one file per
 * vitest run already serialize the suites, and `openFakeWorkbenchTab` refuses a
 * second tab rather than letting two share a board.
 *
 * See README.md, "The fake workbench tab", for the divergences from the real
 * page and which test owns each one.
 */

import { readLiveWorkbench } from "~/experiments-v3/actions/liveWorkbenchRead";
import { startAndIdentifyRun } from "~/experiments-v3/execution/runIdentification";
import { useEvaluationsV3Store } from "~/experiments-v3/hooks/useEvaluationsV3Store";
import type { ExecutionScope } from "~/server/experiments-v3/execution/types";
import { createFakeTabDocument } from "./fake-tab-document";
import { buildFakeTabHandlers } from "./fake-tab-handlers";
import { createFakeTabRunner, type FakeTabRun } from "./fake-tab-run";
import {
  createUiActionListener,
  type ObservedAction,
} from "./fake-tab-ui-actions";
import type { LangyAdapter } from "./langy-agent";
import { getSessionCookie } from "./trpc";

export interface FakeWorkbenchTab {
  /** Every `ui` entry this tab SAW, claimed or not. */
  readonly seenActions: ReadonlyArray<{ actionId: string; kind: string }>;
  /** Every action this tab claimed and carried out, in order. */
  readonly claimedActions: ReadonlyArray<ObservedAction>;
  /** Every action this tab saw and did NOT claim, with how long it waited. */
  readonly droppedActions: ReadonlyArray<ObservedAction>;
  /** Every run this tab started, in order. */
  readonly runs: ReadonlyArray<FakeTabRun>;
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
 * The store is a module singleton, so there is one tab per process.
 *
 * `isOpening` is claimed before the first `await` of `openFakeWorkbenchTab`:
 * `openTab` itself is only set at the end, so two overlapping opens would both
 * pass a check made on it alone and both attach to the same board.
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
   * Start a run and answer with its id, never with its result — the page's own
   * helper, so the id budget and the settle rule are the page's too.
   *
   * The drain is tracked rather than returned: the tab keeps draining after the
   * action is answered, which is what makes the run visible to the assertions
   * while `workbench.run` stays inside its 30 second dispatch budget.
   */
  const startRun = (scope: ExecutionScope): Promise<string | undefined> =>
    startAndIdentifyRun({
      start: (onRunStarted) => {
        track(drainRun({ scope, onRunStarted }));
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
    runToCompletion: (scope) =>
      track(drainRun({ scope, onRunStarted: () => undefined })),
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
        await Promise.allSettled([...inFlight]);
      }
      useEvaluationsV3Store.getState().reset();
      openTab = null;
    },
  };
}
