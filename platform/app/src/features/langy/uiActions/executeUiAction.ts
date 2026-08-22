import { reserveNavigate } from "../logic/langyNavigateDedup";
import type { LangyUiActionHandlers } from "./types";

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
 */
export type UiActionExecution =
  | "duplicate"
  | "no-handler"
  | "not-claimed"
  | "executed"
  | "handler-failed";

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
  claim: (args: { actionId: string }) => Promise<{ claimed: boolean }>;
  complete: (args: {
    actionId: string;
    ok: boolean;
    result?: unknown;
    errorCode?: string;
  }) => Promise<unknown>;
  onHandlerError?: (info: { kind: string; message: string }) => void;
}): Promise<UiActionExecution> {
  const key = uiActionDedupKey({ turnId, actionId: entry.actionId });
  if (!reserveNavigate({ seen, key })) return "duplicate";

  const handler = handlers[entry.kind];
  if (!handler) return "no-handler";

  const { claimed } = await claim({ actionId: entry.actionId });
  if (!claimed) return "not-claimed";

  const parsed = handler.payloadSchema.safeParse(entry.payload);
  if (!parsed.success) {
    await complete({
      actionId: entry.actionId,
      ok: false,
      errorCode: "langy_ui_payload_invalid",
    });
    return "handler-failed";
  }

  try {
    const result = await handler.run(parsed.data as never);
    await complete({
      actionId: entry.actionId,
      ok: true,
      ...(result !== undefined ? { result } : {}),
    });
    return "executed";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A typed handler failure (e.g. a TransformError's `target_not_found`)
    // travels as the errorCode so the agent can act on the real reason; an
    // untyped throw degrades to the generic handler-failed code.
    const code = (error as { code?: unknown }).code;
    await complete({
      actionId: entry.actionId,
      ok: false,
      errorCode: typeof code === "string" ? code : "langy_ui_handler_failed",
    });
    onHandlerError?.({ kind: entry.kind, message });
    return "handler-failed";
  }
}
