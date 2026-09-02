import {
  compareLangyEventCursors,
  isLangyTurnProjectionTerminal,
  type LangyEventCursor,
} from "@langwatch/langy-contract";

import type { api } from "../../../behavior/langy-api";
import { useLangyDevLog } from "../stores/langyDevLog";
import { useLangyStore } from "../../../index";

type ApiUtils = ReturnType<typeof api.useUtils>;

/** Pages of durable tail one catch-up will fold before it gives up and refetches. */
const MAX_CATCH_UP_PAGES = 3;

/**
 * How a tail fold ended.
 *
 *   - `caught-up` — the server said there is nothing left;
 *   - `behind`    — still truncated at the page ceiling, so the fold is
 *                   knowingly behind the durable record;
 *   - `abandoned` — the user selected another conversation while a page was in
 *                   flight, and the rest of the tail was dropped.
 */
type TailFoldOutcome = "caught-up" | "behind" | "abandoned";

/**
 * Fetch and fold the durable tail from `from`, one page at a time.
 *
 * Bounded: each page advances the cursor, and three pages is far beyond any
 * real burst. `turnProjection` is one global fold and selecting another
 * conversation resets it, so a page that lands after the user moved on is
 * dropped — folding it would write the previous turn into the open
 * conversation's fresh projection.
 */
async function foldDurableTail({
  utils,
  projectId,
  conversationId,
  from,
}: {
  utils: ApiUtils;
  projectId: string;
  conversationId: string;
  from: LangyEventCursor;
}): Promise<TailFoldOutcome> {
  let after = from;
  for (let page = 0; page < MAX_CATCH_UP_PAGES; page++) {
    const tail = await utils.langy.conversationEventsAfter.fetch({
      projectId,
      conversationId,
      after,
    });
    if (useLangyStore.getState().activeConversationId !== conversationId) {
      return "abandoned";
    }
    // The inspector's durable lane: the EVENT LOG as this client received it,
    // recorded before the fold so the tape shows what arrived even if applying
    // it turns out to be the bug.
    for (const event of tail.events) {
      useLangyDevLog.getState().recordDurableEvent(event);
    }
    useLangyStore.getState().applyTurnEvents(tail.events);
    after = tail.cursor;
    if (!tail.truncated) return "caught-up";
  }
  return "behind";
}

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

  const outcome = await foldDurableTail({
    utils,
    projectId,
    conversationId,
    from: local,
  });
  // Nobody is looking at this conversation any more, so there is no view to
  // repair and no history worth refetching.
  if (outcome === "abandoned") return;

  if (
    outcome === "behind" ||
    isLangyTurnProjectionTerminal(useLangyStore.getState().turnProjection)
  ) {
    void utils.langy.messages.invalidate({ projectId, conversationId });
  }
}
