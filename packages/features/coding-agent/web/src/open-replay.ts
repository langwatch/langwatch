// The one cross-package import in this file, and it is deliberate: the drawer
// store is the trace explorer's own, and pushing the trace into it before the
// address lands is what makes the replay open on the same frame as the click.
// Reaching a sibling web package is a recorded finding; a second store would be
// a second answer to "which trace is open".
import { useDrawerStore } from "@langwatch/trace-web";

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
 * A session that reported its usage but stored none of its turns has nothing
 * to replay. That is a real state of the data rather than a failure, so it is
 * told plainly instead of as an error.
 *
 * The toaster arrives as an argument because this is a plain function and the
 * host is only reachable from a hook; the caller already holds one.
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
 * The address the trace explorer's own drawer opens from.
 *
 * `platform/app` wrote it through `useDrawer`, which is application
 * composition a feature-web package may not reach. What the drawer actually
 * needs is the address, so this writes the same keys the registry writes and
 * the same registry picks them up.
 *
 * KNOWN GAP, and the reason it is written out here: the drawer this address
 * names is `traceV2Details`, which is registered in `platform/app` and mounted
 * by `DashboardPageBody` — the application chrome. A screen served from
 * `apps/ui` has no chrome above it yet (the same gap `GatewayLayout` and
 * `GovernanceLayout` state for the header and the sidebar), so on those screens
 * the address changes and nothing opens until the chrome layout route lands.
 * The address is still the right thing to write: it is what makes the replay
 * come back for free when it does, and it is what a shared link already means.
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
  // The project travels with the trace, in the store and in the URL. These rows
  // are read from the caller's personal workspace while the app chrome is still
  // sitting in whichever project they last visited, so a drawer left to resolve
  // the project itself would query the wrong one and report the trace missing.
  // Every `drawer.` key the address already carries is taken off first, and
  // everything else on it is left alone. That is what `platform/app`'s registry
  // did, and it is what leaves a pull request detail standing underneath the
  // replay rather than closing it.
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
