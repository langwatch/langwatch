import {
  compareLangyEventCursors,
  isLangyTurnProjectionTerminal,
  type LangyEventCursor,
} from "@langwatch/langy";

import type { api } from "~/utils/api";
import { useLangyDevLog } from "../stores/langyDevLog";
import { useLangyStore } from "../stores/langyStore";

type ApiUtils = ReturnType<typeof api.useUtils>;

/**
 * Bring the open conversation's LOCAL turn fold up to a durable cursor by
 * fetching and folding the event tail (ADR-059).
 *
 * Two callers drive it, and that redundancy is the reliability story:
 *
 *   - the freshness SIGNAL (`useLangyFreshness`) — the low-latency path, a
 *     push saying "the projection moved to cursor X";
 *   - the polled history SNAPSHOT (`LangyPanel`'s seed effect) — the messages
 *     query re-polls while a turn is in flight, and every fresh snapshot
 *     cursor is compared here too.
 *
 * The second caller is what makes a dropped SSE connection a latency problem
 * instead of a frozen panel: the turn keeps running server-side, the poll
 * keeps fetching fresher cursors, and the fold keeps converging on the
 * durable record with no signal ever arriving.
 *
 * Idempotent by construction: the tail is fetched from the LOCAL cursor and
 * the fold refuses to rewind, so the two callers racing each other fold the
 * same events once.
 */
export async function catchUpConversationFold({
  utils,
  projectId,
  conversationId,
  targetCursor,
}: {
  utils: ApiUtils;
  projectId: string;
  conversationId: string;
  targetCursor: LangyEventCursor | null | undefined;
}): Promise<void> {
  const store = useLangyStore.getState();
  // A durable cursor naming the conversation is proof it exists — confirms a
  // freshly-minted conversation so the history read's not-found stops
  // presenting as pending (see `unconfirmedConversations`).
  store.confirmConversation(conversationId);
  const local = store.turnProjection.cursor;
  if (!targetCursor || !local) {
    // Pre-cursor server build, or the snapshot has not seeded the local fold
    // yet — the plain signal-then-refetch path is the honest fallback.
    void utils.langy.messages.invalidate({ projectId, conversationId });
    return;
  }
  if (compareLangyEventCursors(targetCursor, local) <= 0) return;

  // Bounded catch-up: each page advances the cursor; three pages is far
  // beyond any real burst (the ceiling is a defensive log, not a path).
  let after = local;
  for (let page = 0; page < 3; page++) {
    const tail = await utils.langy.conversationEventsAfter.fetch({
      projectId,
      conversationId,
      after,
    });
    // The inspector's durable lane: the EVENT LOG as this client received
    // it, recorded before the fold so the tape shows what arrived even if
    // applying it turns out to be the bug.
    for (const event of tail.events) {
      useLangyDevLog.getState().recordDurableEvent(event);
    }
    useLangyStore.getState().applyTurnEvents(tail.events);
    after = tail.cursor;
    if (!tail.truncated) break;
  }

  if (isLangyTurnProjectionTerminal(useLangyStore.getState().turnProjection)) {
    void utils.langy.messages.invalidate({ projectId, conversationId });
  }
}
