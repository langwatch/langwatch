import type { codingAgentApi } from "../behavior/coding-agent-api.ts";
import type { CodingAgentToaster } from "../behavior/coding-agent-feedback.ts";
import type { CodingAgentRouter } from "../behavior/coding-agent-router.ts";

/** The one turn a replay opens on: the last thing the session did. */
export type ConversationTurn = { traceId: string; timestamp: number };

/** The conversation read for a session; a group project's names the member that recorded it. */
export function conversationContextInput({
  projectId,
  sessionId,
  tenantId,
}: {
  projectId: string;
  sessionId: string;
  tenantId: string | undefined;
}): { projectId: string; conversationId: string; tenantId?: string } {
  return { projectId, conversationId: sessionId, ...(tenantId ? { tenantId } : {}) };
}

/** The session's last stored turn, or null when none of them was stored. */
export async function lastTurnOfSession({
  utils,
  projectId,
  sessionId,
  tenantId,
}: {
  utils: ReturnType<typeof codingAgentApi.useUtils>;
  projectId: string;
  sessionId: string;
  tenantId: string | undefined;
}): Promise<ConversationTurn | null> {
  const context = await utils.traces.conversationContext.fetch(
    conversationContextInput({ projectId, sessionId, tenantId }),
  );
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
 * The trace explorer drawer's address, written as raw keys since `useDrawer`
 * is composition a feature-web package can't reach.
 */
export function openReplayHere({
  turn,
  projectId,
  tenantId,
  router,
}: {
  turn: ConversationTurn;
  projectId: string;
  /** The member project that owns the trace, on a group project. */
  tenantId: string | undefined;
  router: CodingAgentRouter;
}): void {
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
    ...(tenantId ? { "drawer.tenantId": tenantId } : {}),
  });
}

/** Open the same replay in the full trace explorer, on its own page. */
export function openReplayInExplorer({
  turn,
  projectSlug,
  tenantId,
  router,
}: {
  turn: ConversationTurn;
  projectSlug: string;
  tenantId: string | undefined;
  router: CodingAgentRouter;
}): void {
  const params = new URLSearchParams({
    "drawer.open": "traceV2Details",
    "drawer.traceId": turn.traceId,
    "drawer.t": String(turn.timestamp),
    "drawer.mode": "terminal",
    ...(tenantId ? { "drawer.tenantId": tenantId } : {}),
  });
  router.push(`/${projectSlug}/traces?${params.toString()}`);
}
