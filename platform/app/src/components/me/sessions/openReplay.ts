import { toaster } from "~/components/ui/toaster";
import { useDrawerStore } from "@langwatch/trace-web";
import type { useDrawer } from "~/hooks/useDrawer";
import type { api } from "~/utils/api";
import type { useRouter } from "~/utils/compat/next-router";

/** The one turn a replay opens on: the last thing the session did. */
export type ConversationTurn = { traceId: string; timestamp: number };

/** The session's last stored turn, or null when none of them was stored. */
export async function lastTurnOfSession({
  utils,
  projectId,
  sessionId,
}: {
  utils: ReturnType<typeof api.useUtils>;
  projectId: string;
  sessionId: string;
}): Promise<ConversationTurn | null> {
  const context = await utils.tracesV2.conversationContext.fetch({
    projectId,
    conversationId: sessionId,
  });
  return context?.turns[context.turns.length - 1] ?? null;
}

/**
 * A session that reported its usage but stored none of its turns has nothing
 * to replay. That is a real state of the data rather than a failure, so it is
 * told plainly instead of as an error.
 */
export function sayNothingWasStored(): void {
  toaster.create({
    title: "No stored traces for this session yet",
    description:
      "This session reported its usage, but none of its turns were stored, so there is nothing to replay.",
    type: "info",
  });
}

/**
 * Open the replay over the table. The store is what the global drawer mount
 * watches, so pushing it before the URL lands means the drawer opens on the
 * same frame as the click. The view mode is set transiently: this reader asked
 * for one replay, not for every trace they open next to be a terminal.
 *
 * The project travels with the trace, in the store and in the URL. These rows
 * are read from the caller's personal workspace while the app chrome is still
 * sitting in whichever project they last visited, so a drawer left to resolve
 * the project itself would query the wrong one and report the trace missing.
 */
export function openReplayHere({
  turn,
  projectId,
  openDrawer,
}: {
  turn: ConversationTurn;
  projectId: string;
  openDrawer: ReturnType<typeof useDrawer>["openDrawer"];
}): void {
  const store = useDrawerStore.getState();
  store.openTrace(turn.traceId, turn.timestamp, { projectId });
  store.setViewModeTransient("terminal");
  openDrawer("traceV2Details", {
    traceId: turn.traceId,
    t: String(turn.timestamp),
    mode: "terminal",
    projectId,
  });
}

/** Open the same replay in the full trace explorer, on its own page. */
export function openReplayInExplorer({
  turn,
  projectSlug,
  router,
}: {
  turn: ConversationTurn;
  projectSlug: string;
  router: ReturnType<typeof useRouter>;
}): void {
  const params = new URLSearchParams({
    "drawer.open": "traceV2Details",
    "drawer.traceId": turn.traceId,
    "drawer.t": String(turn.timestamp),
    "drawer.mode": "terminal",
  });
  void router.push(`/${projectSlug}/traces?${params.toString()}`);
}
