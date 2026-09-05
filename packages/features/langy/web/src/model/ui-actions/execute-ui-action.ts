import { reserveNavigate } from "../langy-navigate-dedup";
import type { LangyUiActionHandlers } from "./langy-ui-action-types";

/**
 * The panel-side orchestration for one `ui` stream entry
 * (specs/langy/langy-ui-actions.feature).
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
 */
type CompleteUiAction = (args: {
  actionId: string;
  ok: boolean;
  result?: unknown;
  errorCode?: string;
}) => Promise<{ isAccepted: boolean }>;

/**
 * What a thrown handler owes the two audiences: an error code for the agent and a
 * message for the user.
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
