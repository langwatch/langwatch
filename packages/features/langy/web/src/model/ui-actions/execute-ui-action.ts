import { reserveNavigate } from "../langy-navigate-dedup";
import type { LangyUiActionHandlers } from "./langy-ui-action-types";

/**
 * The panel-side orchestration for one `ui` stream entry
 * (specs/langy/langy-ui-actions.feature). Pure of React and tRPC: the panel
 * injects `claim`/`complete` (the mutations) and the handler table (from
 * LangyContext), so every branch here is unit-testable against fakes.
 *
 * Order of gates:
 *  1. content dedup — `onTurnStream` yields bare entries, so a reconnect's
 *     tail replay hands the client the same entry twice; `turnId:actionId` is
 *     its identity (same shape as the navigate dedup).
 *  2. handler lookup — a page without a handler for this kind does NOT claim:
 *     leaving the action unclaimed is what lets the server fall back (or
 *     refuse with its own typed code), and a claim we cannot honor would turn
 *     that into a timeout.
 *  3. the claim — SET NX server-side, so with two tabs open exactly one
 *     executes and the loser drops silently.
 *  4. re-parse, run, complete — a handler failure still completes (ok: false)
 *     so the agent reads the failure instead of waiting out the budget.
 *
 * Running the handler and reporting the outcome are separate steps on purpose.
 * The handler changes the page; the completion only tells the agent about it.
 * Folding them together made a failed completion look like a failed handler,
 * which recorded a failure for a change the user can see on screen.
 */
export type UiActionExecution =
  | "duplicate"
  | "no-handler"
  | "not-claimed"
  | "executed"
  | "handler-failed"
  | "completion-failed";

/** The dedup identity of one dispatched action on this client. */
export function uiActionDedupKey({
  turnId,
  actionId,
}: {
  turnId: string | null;
  actionId: string;
}): string {
  return `${turnId ?? ""}:${actionId}`;
}

/**
 * Tell the server how one action ended.
 *
 * `isAccepted: false` is the server's soft refusal: the pending action, the
 * claimant or the turn no longer match, so it dropped the report instead of
 * throwing. The agent gets no terminal result either way, so it counts the
 * same as a thrown call.
 */
type CompleteUiAction = (args: {
  actionId: string;
  ok: boolean;
  result?: unknown;
  errorCode?: string;
}) => Promise<{ isAccepted: boolean }>;

/**
 * What a thrown handler owes the two audiences: an error code for the agent
 * and a message for the user.
 *
 * A typed handler failure (e.g. a TransformError's `target_not_found`) travels
 * as its own code so the agent can act on the real reason; an untyped throw
 * degrades to the generic handler-failed code.
 */
function readHandlerFailure(error: unknown): {
  errorCode: string;
  message: string;
} {
  const code = (error as { code?: unknown }).code;
  return {
    errorCode: typeof code === "string" ? code : "langy_ui_handler_failed",
    message: error instanceof Error ? error.message : String(error),
  };
}

/**
 * Report the outcome, and answer whether the report landed.
 *
 * The report is the agent's channel, never the page's: the page has already
 * done (or not done) the work by the time this runs, and the agent's dispatch
 * times out on its own. So a failed report must not become the outcome of the
 * action, and the caller uses the answer to keep the two apart.
 */
async function reportOutcome({
  complete,
  outcome,
}: {
  complete: CompleteUiAction;
  outcome: Parameters<CompleteUiAction>[0];
}): Promise<boolean> {
  try {
    const { isAccepted } = await complete(outcome);
    return isAccepted;
  } catch {
    return false;
  }
}

export async function executeUiAction({
  entry,
  turnId,
  seen,
  handlers,
  claim,
  complete,
  onHandlerError,
}: {
  entry: { actionId: string; kind: string; payload: unknown };
  turnId: string | null;
  seen: Set<string>;
  handlers: LangyUiActionHandlers;
  claim: (args: { actionId: string }) => Promise<{ isClaimed: boolean }>;
  complete: CompleteUiAction;
  /**
   * Reports a handler that threw, with the failure itself.
   *
   * `error` travels alongside the read `message` because the words a customer
   * reads are resolved from the failure's code by the composition's
   * presentation registry (ADR-045); `message` stays because the dispatch's own
   * bookkeeping already read it.
   */
  onHandlerError?: (info: { kind: string; message: string; error: unknown }) => void;
}): Promise<UiActionExecution> {
  const key = uiActionDedupKey({ turnId, actionId: entry.actionId });
  if (!reserveNavigate({ seen, key })) return "duplicate";

  const handler = handlers[entry.kind];
  if (!handler) return "no-handler";

  const { isClaimed } = await claim({ actionId: entry.actionId });
  if (!isClaimed) return "not-claimed";

  const parsed = handler.payloadSchema.safeParse(entry.payload);
  if (!parsed.success) {
    await reportOutcome({
      complete,
      outcome: {
        actionId: entry.actionId,
        ok: false,
        errorCode: "langy_ui_payload_invalid",
      },
    });
    return "handler-failed";
  }

  let result: unknown;
  try {
    result = await handler.run(parsed.data as never);
  } catch (error) {
    const { errorCode, message } = readHandlerFailure(error);
    await reportOutcome({
      complete,
      outcome: { actionId: entry.actionId, ok: false, errorCode },
    });
    onHandlerError?.({ kind: entry.kind, message, error });
    return "handler-failed";
  }

  const isReported = await reportOutcome({
    complete,
    outcome: {
      actionId: entry.actionId,
      ok: true,
      ...(result !== undefined ? { result } : {}),
    },
  });
  // The handler already applied the change, so a failed report is not a
  // handler failure and must never be recorded as one.
  return isReported ? "executed" : "completion-failed";
}
