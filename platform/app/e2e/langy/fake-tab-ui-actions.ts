/**
 * The fake workbench tab's browser leg: hearing a `ui` entry on the turn stream,
 * claiming it, running it through the handler table and completing it.
 *
 * `executeUiAction` is the app's own, so the claim window, the seen-key guard
 * and the outcome vocabulary are the page's. What this adds is the record every
 * assertion reads afterwards: what was seen, what was claimed, what was dropped
 * and how long each took.
 */
import type { UiActionExecution } from "~/features/langy/uiActions/executeUiAction";
import { executeUiAction } from "~/features/langy/uiActions/executeUiAction";
import type { LangyUiActionHandlers } from "~/features/langy/uiActions/types";
import { PROJECT_ID } from "./config";
import type { LangyAdapter, UiActionEntry } from "./langy-agent";
import { trpcMutate } from "./trpc";

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

/**
 * The two calls the page makes on the server for one action.
 *
 * `complete` records what the tab answered before it posts, so the record holds
 * the answer even when the completion itself fails.
 */
function actionTransport({
  cookie,
  conversationId,
  record,
}: {
  cookie: string;
  conversationId: string;
  record: ObservedAction;
}) {
  return {
    claim: ({ actionId }: { actionId: string }) =>
      trpcMutate<{ isClaimed: boolean }>({
        cookie,
        path: "langy.claimUiAction",
        input: { projectId: PROJECT_ID, conversationId, actionId },
        timeoutMs: 15_000,
      }),
    complete: async (args: {
      ok: boolean;
      result?: unknown;
      errorCode?: string;
      [key: string]: unknown;
    }) => {
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
  };
}

/** Which list the settled action belongs on, and what the drop is worth saying. */
function fileOutcome({
  record,
  outcome,
  claimedActions,
  droppedActions,
}: {
  record: ObservedAction;
  outcome: UiActionExecution;
  claimedActions: ObservedAction[];
  droppedActions: ObservedAction[];
}): void {
  record.outcome = outcome;
  record.settledAtMs = Date.now();
  const isClaimed =
    outcome === "executed" ||
    outcome === "handler-failed" ||
    outcome === "completion-failed";
  if (isClaimed) {
    claimedActions.push(record);
    return;
  }
  droppedActions.push(record);
  // The claim window is a hard 3 second constant server-side, so a drop is a
  // timing report rather than a mystery: say how long the tab took, so a flake
  // reads as latency instead of a lost action.
  console.log(
    `[fake-tab] ${record.kind} not claimed (${outcome}) after ${
      record.settledAtMs - record.seenAtMs
    }ms`,
  );
}

export function createUiActionListener({
  adapter,
  cookie,
  handlers,
  seenKeys,
  seenActions,
  claimedActions,
  droppedActions,
  track,
}: {
  adapter?: LangyAdapter;
  cookie: string;
  handlers: LangyUiActionHandlers;
  seenKeys: Set<string>;
  seenActions: { actionId: string; kind: string }[];
  claimedActions: ObservedAction[];
  droppedActions: ObservedAction[];
  track: <T>(promise: Promise<T>) => Promise<T>;
}): (entry: UiActionEntry) => void {
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
        ...actionTransport({ cookie, conversationId, record }),
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
        .then((outcome) =>
          fileOutcome({ record, outcome, claimedActions, droppedActions }),
        ),
    );
  };

  return handleEntry;
}
