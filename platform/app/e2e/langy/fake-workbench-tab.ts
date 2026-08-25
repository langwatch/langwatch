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
import {
  WORKBENCH_ACTION_KINDS,
  WORKBENCH_ACTIONS,
} from "~/experiments-v3/actions/manifest";
import { scopeFromRunPayload } from "~/experiments-v3/actions/runScope";
import { buildExecutionRequest } from "~/experiments-v3/execution/buildExecutionRequest";
import { foldEvaluationEvent } from "~/experiments-v3/execution/resultsFold";
import { useEvaluationsV3Store } from "~/experiments-v3/hooks/useEvaluationsV3Store";
import { extractPersistedState } from "~/experiments-v3/types/persistence";
import {
  LangyUiPageOutOfDateError,
  LangyUiSaveFailedError,
} from "~/features/langy/uiActions/errors";
import {
  executeUiAction,
  type UiActionExecution,
} from "~/features/langy/uiActions/executeUiAction";
import type { LangyUiActionHandlers } from "~/features/langy/uiActions/types";
import type {
  EvaluationV3Event,
  ExecutionScope,
} from "~/server/experiments-v3/execution/types";
import { APP_BASE, PROJECT_ID } from "./config";
import type { LangyAdapter, UiActionEntry } from "./langy-agent";
import {
  getSessionCookie,
  type TrpcCallError,
  trpcMutate,
  trpcQuery,
} from "./trpc";

/**
 * How long the run action waits for the stream to name its run, mirroring the
 * page's own `RUN_ID_WAIT_MS`. The id is minted server-side and travels on the
 * first frame, so this only has to cover opening the connection; the run itself
 * takes minutes and is never waited for.
 */
const RUN_ID_WAIT_MS = 30_000;

/** How long a run's stream may go without a frame before it is abandoned. */
const RUN_CHUNK_TIMEOUT_MS = 300_000;

/** How long the run's stream may take to open. */
const RUN_CONNECT_TIMEOUT_MS = 60_000;

/** What one save did, in the page's own vocabulary. */
type SaveOutcome = "saved" | "unchanged" | "refused" | "failed";

/** One `ui` entry this tab saw, whatever became of it. */
export interface ObservedAction {
  actionId: string;
  kind: string;
  payload: unknown;
  /** What `executeUiAction` made of it. */
  outcome: UiActionExecution;
  /** What the tab reported back, when it reported anything. */
  ok?: boolean;
  result?: unknown;
  errorCode?: string;
  /** When the entry arrived on the turn stream. */
  seenAtMs: number;
  /** When the tab finished with it. */
  settledAtMs: number;
}

/** One run this tab started, with everything its stream said. */
export interface FakeTabRun {
  runId?: string;
  events: EvaluationV3Event[];
  status: "success" | "stopped" | "error";
  /** Set when the stream failed rather than the run reporting how it ended. */
  failure?: string;
}

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

/** The store is a module singleton, so there is one tab per process. */
let openTab: FakeWorkbenchTab | null = null;

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
  if (openTab) {
    throw new Error(
      "A fake workbench tab is already open in this process. The workbench store is a module singleton, so two tabs would drive the same board: close the first one before opening another.",
    );
  }

  const cookie = await getSessionCookie();
  const seenActions: { actionId: string; kind: string }[] = [];
  const claimedActions: ObservedAction[] = [];
  const droppedActions: ObservedAction[] = [];
  const runs: FakeTabRun[] = [];
  const inFlight = new Set<Promise<unknown>>();
  const seenKeys = new Set<string>();
  let lastSaved: string | null = null;

  // ── loading ─────────────────────────────────────────────────────────────

  const load = async (): Promise<void> => {
    const row = await trpcQuery<{
      id: string;
      slug: string;
      workbenchState: unknown;
      version: number;
    }>({
      cookie,
      path: "experiments.getEvaluationsV3BySlug",
      input: { projectId: PROJECT_ID, experimentSlug },
    });
    const store = useEvaluationsV3Store.getState();
    store.reset();
    // The real load boundary: it normalizes evaluators and targets, which is
    // also where a saved row carrying a comparison config its type cannot own
    // gets repaired. Reading the row any other way would read it differently
    // from the page.
    store.loadState(row.workbenchState);
    store.setExperimentId(row.id);
    store.setExperimentSlug(row.slug);
    store.setWorkbenchVersion(row.version);
    lastSaved = JSON.stringify(
      extractPersistedState(useEvaluationsV3Store.getState()),
    );
  };

  await load();

  // ── saving ──────────────────────────────────────────────────────────────

  /**
   * The page's `saveNow`, minus the debounce and the badge.
   *
   * Every claimed action saves before it answers, which is what `saveOrRefuse`
   * guarantees on the real page anyway: the 1.5s autosave debounce there only
   * covers typing.
   */
  const saveNow = async (): Promise<SaveOutcome> => {
    const state = useEvaluationsV3Store.getState();
    if (!state.experimentId || !state.name) return "unchanged";
    // Out of date against the server: saving now would clobber the newer
    // version, so this waits for a reload exactly as autosave does.
    if (state.staleWorkbench) return "refused";

    const body = extractPersistedState(state);
    const snapshot = JSON.stringify(body);
    if (snapshot === lastSaved) return "unchanged";

    try {
      const saved = await trpcMutate<{ version: number }>({
        cookie,
        path: "experiments.saveEvaluationsV3",
        input: {
          projectId: PROJECT_ID,
          experimentId: state.experimentId,
          expectedVersion: state.workbenchVersion,
          state: body,
        },
        timeoutMs: 60_000,
      });
      useEvaluationsV3Store.getState().setWorkbenchVersion(saved.version);
      lastSaved = snapshot;
      return "saved";
    } catch (error) {
      const call = error as TrpcCallError;
      if (call.domainErrorCode === "experiment_stale_workbench_state") {
        const currentVersion = call.domainErrorMeta?.currentVersion;
        const actorLabel = call.domainErrorMeta?.actorLabel;
        useEvaluationsV3Store.getState().setStaleWorkbench({
          serverVersion:
            typeof currentVersion === "number"
              ? currentVersion
              : (state.workbenchVersion ?? 0) + 1,
          ...(typeof actorLabel === "string" ? { actorLabel } : {}),
        });
        return "refused";
      }
      console.log(`[fake-tab] save failed: ${String(error).slice(0, 300)}`);
      return "failed";
    }
  };

  /**
   * Catch up with a write that landed somewhere else, before touching anything.
   *
   * The real page does this through `useWorkbenchUpdateListener`: a workbench
   * with nothing unsaved reloads silently when someone else writes, and only a
   * page holding an unsaved edit banners instead. This tab has no broadcast to
   * listen to, but it saves before it answers every action, so BETWEEN actions
   * it is always the clean case, which is exactly the case that reloads.
   *
   * Without this, the first action the agent sent down the backend path left the
   * tab a version behind, and it then refused every later action for the rest of
   * the conversation. That is not what the customer's page does, and a suite
   * that reproduced it would be measuring the stand-in rather than the leg.
   *
   * The refusal itself is untouched: a save refused DURING an action still
   * refuses that action, because the tab is holding an unsaved edit right then.
   */
  const catchUpIfBehind = async (): Promise<void> => {
    if (!useEvaluationsV3Store.getState().staleWorkbench) return;
    await load();
  };

  /**
   * A page the server has already moved past cannot write: autosave stands down
   * there by design, and answering "done" from that state would tell the agent
   * a document exists that only this tab can see.
   */
  const assertPageIsCurrent = () => {
    if (useEvaluationsV3Store.getState().staleWorkbench) {
      throw new LangyUiPageOutOfDateError();
    }
  };

  const saveOrRefuse = async () => {
    const outcome = await saveNow();
    if (outcome === "failed") throw new LangyUiSaveFailedError();
    assertPageIsCurrent();
    if (outcome === "refused") throw new LangyUiPageOutOfDateError();
  };

  // ── running ─────────────────────────────────────────────────────────────

  /**
   * The run's SSE frames, folded into the store as they arrive.
   *
   * Folding rather than ignoring the stream is what makes a candidate-only
   * comparison run possible: `buildExecutionRequest` builds `seedTargetOutputs`
   * from `results.targetOutputs`, and `workbench.getState` from a live page
   * projects results too. A tab that never folds would answer differently from
   * the page it stands in for.
   */
  const drainRun = async ({
    scope,
    onRunStarted,
  }: {
    scope: ExecutionScope;
    onRunStarted: (runId: string | undefined) => void;
  }): Promise<FakeTabRun> => {
    const run: FakeTabRun = { events: [], status: "error" };
    runs.push(run);

    const state = useEvaluationsV3Store.getState();
    const built = buildExecutionRequest({
      state: {
        name: state.name,
        datasets: state.datasets,
        activeDatasetId: state.activeDatasetId,
        targets: state.targets,
        evaluators: state.evaluators,
        experimentId: state.experimentId ?? undefined,
        experimentSlug: state.experimentSlug ?? undefined,
        results: state.results,
      },
      projectId: PROJECT_ID,
      scope,
      concurrency: state.ui.concurrency,
    });
    if (!built) {
      run.failure = "the workbench holds no dataset to run";
      onRunStarted(undefined);
      return run;
    }

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const resetTimer = (ms: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => controller.abort(), ms);
    };

    try {
      resetTimer(RUN_CONNECT_TIMEOUT_MS);
      const res = await fetch(`${APP_BASE}/api/experiments/execute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          Cookie: cookie,
          Origin: APP_BASE,
        },
        body: JSON.stringify(built.request),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        run.failure = `POST /api/experiments/execute -> ${res.status}: ${(
          await res.text()
        ).slice(0, 300)}`;
        onRunStarted(undefined);
        return run;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let terminal: "success" | "stopped" | undefined;
      let fatal: string | undefined;

      const handleFrame = (frame: string) => {
        for (const line of frame.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload) continue;
          let event: EvaluationV3Event;
          try {
            event = JSON.parse(payload) as EvaluationV3Event;
          } catch {
            continue;
          }
          run.events.push(event);
          if (event.type === "execution_started") {
            run.runId = event.runId;
            onRunStarted(event.runId);
          }
          if (event.type === "error" && event.rowIndex === undefined) {
            fatal = event.message;
          }
          if (event.type === "done") terminal = "success";
          if (event.type === "stopped") terminal = "stopped";
          useEvaluationsV3Store.setState((current) => ({
            results: foldEvaluationEvent({
              results: current.results,
              event,
              evaluatorIds: current.evaluators.map((evaluator) => evaluator.id),
            }),
          }));
        }
      };

      while (true) {
        resetTimer(RUN_CHUNK_TIMEOUT_MS);
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index: number;
        while ((index = buffer.indexOf("\n\n")) >= 0) {
          handleFrame(buffer.slice(0, index));
          buffer = buffer.slice(index + 2);
        }
        if (terminal) break;
      }
      buffer += decoder.decode();
      if (buffer.trim()) handleFrame(buffer);

      if (fatal) {
        run.status = "error";
        run.failure = fatal;
      } else if (terminal) {
        run.status = terminal;
      } else {
        run.status = "error";
        run.failure = "the run's stream closed without a terminal frame";
      }
    } catch (error) {
      run.status = "error";
      run.failure = String(error).slice(0, 300);
    } finally {
      if (timer) clearTimeout(timer);
      controller.abort();
      onRunStarted(undefined);
    }

    // The cells the run produced belong on the server too. The real page gets
    // there through the autosave debounce; this tab saves once, here.
    await saveNow();
    return run;
  };

  /** Track a background promise so `close()` can await it. */
  const track = <T>(promise: Promise<T>): Promise<T> => {
    inFlight.add(promise);
    void promise.finally(() => inFlight.delete(promise));
    return promise;
  };

  /**
   * Start a run and answer with its id, never with its result.
   *
   * The dispatch clamps `workbench.run` to a 30 second budget, so a handler
   * that awaited the drain would turn every run over 27 seconds into a
   * `langy_ui_timeout`. Mirrors the page's `startAndIdentifyRun`: answers with
   * no id rather than holding the action open when the stream ends, fails, or
   * never opens.
   */
  const startAndIdentifyRun = (
    scope: ExecutionScope,
  ): Promise<string | undefined> =>
    new Promise((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const answer = (runId?: string) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve(runId);
      };
      timer = setTimeout(() => answer(undefined), RUN_ID_WAIT_MS);
      track(drainRun({ scope, onRunStarted: answer }));
    });

  // ── the page's handler table ────────────────────────────────────────────

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
      const runId = await startAndIdentifyRun(scopeFromRunPayload(payload));
      return { runId, status: "running" as const };
    },
  };

  // ── the browser leg ─────────────────────────────────────────────────────

  const handleEntry = (entry: UiActionEntry): void => {
    const conversationId = adapter?.state.conversationId;
    if (!conversationId) return;
    const seenAtMs = Date.now();
    seenActions.push({ actionId: entry.actionId, kind: entry.kind });

    const record: ObservedAction = {
      actionId: entry.actionId,
      kind: entry.kind,
      payload: entry.payload,
      outcome: "no-handler",
      seenAtMs,
      settledAtMs: seenAtMs,
    };

    track(
      executeUiAction({
        entry,
        turnId: adapter?.state.currentTurnId ?? null,
        seen: seenKeys,
        handlers,
        claim: ({ actionId }) =>
          trpcMutate<{ isClaimed: boolean }>({
            cookie,
            path: "langy.claimUiAction",
            input: { projectId: PROJECT_ID, conversationId, actionId },
            timeoutMs: 15_000,
          }),
        complete: async (args) => {
          record.ok = args.ok;
          record.result = args.result;
          record.errorCode = args.errorCode;
          return trpcMutate<{ isAccepted: boolean }>({
            cookie,
            path: "langy.completeUiAction",
            input: { projectId: PROJECT_ID, conversationId, ...args },
            timeoutMs: 30_000,
          });
        },
        onHandlerError: ({ kind, message }) =>
          console.log(`[fake-tab] ${kind} failed: ${message.slice(0, 200)}`),
      })
        .catch((error): UiActionExecution => {
          // A claim that never answered. The action is the server's to fall
          // back on, and the tab records the drop rather than the suite seeing
          // an unhandled rejection.
          console.log(
            `[fake-tab] ${entry.kind} could not be claimed: ${String(error).slice(0, 200)}`,
          );
          return "not-claimed";
        })
        .then((outcome) => {
          record.outcome = outcome;
          record.settledAtMs = Date.now();
          const claimed =
            outcome === "executed" ||
            outcome === "handler-failed" ||
            outcome === "completion-failed";
          if (claimed) {
            claimedActions.push(record);
          } else {
            droppedActions.push(record);
            // The claim window is a hard 3 second constant server-side, so a
            // drop is a timing report rather than a mystery: say how long the
            // tab took, so a flake reads as latency instead of a lost action.
            console.log(
              `[fake-tab] ${entry.kind} not claimed (${outcome}) after ${
                record.settledAtMs - record.seenAtMs
              }ms`,
            );
          }
        }),
    );
  };

  if (adapter) adapter.onUiAction = handleEntry;

  const tab: FakeWorkbenchTab = {
    get seenActions() {
      return seenActions;
    },
    get claimedActions() {
      return claimedActions;
    },
    get droppedActions() {
      return droppedActions;
    },
    get runs() {
      return runs;
    },
    state: () => readLiveWorkbench({ state: useEvaluationsV3Store.getState() }),
    version: () => useEvaluationsV3Store.getState().workbenchVersion,
    runToCompletion: (scope) =>
      track(drainRun({ scope, onRunStarted: () => undefined })),
    reload: load,
    close: async () => {
      if (adapter?.onUiAction === handleEntry) adapter.onUiAction = undefined;
      // Settled in waves: a claimed action can start a run, and the run's
      // drain is only tracked once the handler reaches it.
      while (inFlight.size > 0) {
        await Promise.allSettled([...inFlight]);
      }
      useEvaluationsV3Store.getState().reset();
      openTab = null;
    },
  };

  openTab = tab;
  return tab;
}
