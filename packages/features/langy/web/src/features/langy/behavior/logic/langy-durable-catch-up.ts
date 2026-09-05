import {
  compareLangyEventCursors,
  isLangyTurnProjectionTerminal,
  type LangyEventCursor,
} from "@langwatch/langy-contract";

import type { api } from "../../../../behavior/langy-api";
import { useLangyDevLog } from "../stores/langy-dev-log";
import { useLangyStore } from "../../../../index";

type ApiUtils = ReturnType<typeof api.useUtils>;

/** Pages of durable tail one catch-up will fold before it gives up and refetches. */
const MAX_CATCH_UP_PAGES = 3;

/**
 * How a tail fold ended.
 */
type TailFoldOutcome = "caught-up" | "behind" | "abandoned";

/**
 * Fetch and fold the durable tail from `from`, one page at a time.
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
 * Bring the open conversation's LOCAL turn fold up to a durable cursor by fetching and
 * folding the event tail (ADR-059).
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
