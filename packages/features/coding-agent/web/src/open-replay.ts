// The one cross-package import in this file, and it is deliberate: the drawer
// store is the trace explorer's own, and pushing the trace into it before the
// address lands is what makes the replay open on the same frame as the click.
// Reaching a sibling web package is a recorded finding; a second store would be
// a second answer to "which trace is open".
import { useDrawerStore } from "@langwatch/trace-web/surfaces/trace-drawer-store";

import type { codingAgentApi } from "./coding-agent-api";
import type { CodingAgentToaster } from "./coding-agent-feedback";
import type { CodingAgentRouter } from "./coding-agent-router";

/** The one turn a replay opens on: the last thing the session did. */
export type ConversationTurn = { traceId: string; timestamp: number };

/** The session's last stored turn, or null when none of them was stored. */
export async function lastTurnOfSession({
  utils,
  projectId,
  sessionId,
}: {
  utils: ReturnType<typeof codingAgentApi.useUtils>;
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
 * A session with usage but no stored turns has nothing to replay — a real
 * data state, not a failure, told plainly. The toaster arrives as an
 * argument since this plain function can't reach the hook-only host.
 */
export function sayNothingWasStored(toaster: CodingAgentToaster): void {
  toaster.create({
    title: "No stored traces for this session yet",
    description:
      "This session reported its usage, but none of its turns were stored, so there is nothing to replay.",
    type: "info",
  });
}

/**
 * The trace explorer drawer's address, written as raw keys since
 * `useDrawer` is composition a feature-web package can't reach. KNOWN GAP:
 * nothing opens until the chrome layout route lands — still right to write.
 */
export function openReplayHere({
  turn,
  projectId,
  router,
}: {
  turn: ConversationTurn;
  projectId: string;
  router: CodingAgentRouter;
}): void {
  // The store is what the global drawer mount watches, so pushing it before
  // the URL lands means the drawer opens on the same frame as the click. The
  // view mode is set transiently: this reader asked for one replay, not for
  // every trace they open next to be a terminal.
  const store = useDrawerStore.getState();
  store.openTrace(turn.traceId, turn.timestamp, { projectId });
  store.setViewModeTransient("terminal");
  // The project travels with the trace, since the chrome is still sitting in
  // whichever project was last visited, and a drawer resolving its own
  // project would query the wrong one. Every `drawer.` key is taken off
  // first; everything else stays, leaving other detail views open underneath.
  const cleared: Record<string, string | undefined> = {};
  for (const key of Object.keys(router.query)) {
    if (key.startsWith("drawer.")) cleared[key] = void 0;
  }
  router.setQueryParams({
    ...cleared,
    "drawer.open": "traceV2Details",
    "drawer.traceId": turn.traceId,
    "drawer.t": String(turn.timestamp),
    "drawer.mode": "terminal",
    "drawer.projectId": projectId,
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
  router: CodingAgentRouter;
}): void {
  const params = new URLSearchParams({
    "drawer.open": "traceV2Details",
    "drawer.traceId": turn.traceId,
    "drawer.t": String(turn.timestamp),
    "drawer.mode": "terminal",
  });
  router.push(`/${projectSlug}/traces?${params.toString()}`);
}
