import {
  compareLangyEventCursors,
  isLangyTurnProjectionTerminal,
} from "@langwatch/langy";
import { useCallback } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import type { LangyConversationUpdateSignal } from "../data/langy.dtos";
import { useLangyStore } from "../stores/langyStore";
import { useLangyConversationUpdateListener } from "./useLangyConversationUpdateListener";

/**
 * Page-level real-time coordinator for Langy, mirroring `useTraceFreshness`.
 * Mounted ONCE by the panel so exactly one SSE subscription serves every list
 * / detail consumer (tRPC subscriptions aren't deduped across hook instances —
 * one-per-consumer would starve the browser's connection pool).
 *
 * Contract: the freshness signal is ID-ONLY. The broadcast subscriber
 * (`langy-conversation-update-broadcast.subscriber.ts`) deliberately lets "no
 * folded conversation state cross" its port — no status, no counts, no content
 * ride the wire, only the `conversationId`. So this coordinator is pure
 * signal-then-refetch (`specs/langy/langy-frontend-realtime.feature`): a signal
 * says "conversation X changed", and we invalidate the queries it affects and
 * let the server re-decide visibility. We never try to apply pushed state in
 * place — there is none to apply.
 *
 * Two queries are affected by a signal:
 *   - the recents LIST (title / counts / ordering) — always refetched, once per
 *     debounced batch, through the server visibility gate;
 *   - the OPEN conversation's MESSAGES, when a signal names it — refetched so a
 *     turn it did not itself initiate (another tab, a recovered/again-driven
 *     turn, a programmatic caller) still lands. Without this the open thread has
 *     no live turn stream to attach to and stays stale until a remount. The
 *     panel re-hydrates its engine from this query when it is not mid-stream.
 */
export function useLangyFreshness(activeConversationId: string | null): void {
  const { project } = useOrganizationTeamProject();
  const trpcUtils = api.useContext();

  /**
   * The OPEN conversation's live path (ADR-059): the signal carries the
   * projection's CURSOR; compare it with the local fold's and, when behind,
   * fetch the durable event tail and fold it in place — turn state lands
   * event-by-event without re-downloading the projection. Message CONTENT
   * still lives in the messages query, which is refetched only at a folded
   * TERMINAL (that is when the answer reaches the message projection) or when
   * the signal predates cursors.
   */
  const catchUpOpenConversation = useCallback(
    async (
      projectId: string,
      conversationId: string,
      signalCursor: LangyConversationUpdateSignal["cursor"],
    ) => {
      const store = useLangyStore.getState();
      const local = store.turnProjection.cursor;
      if (!signalCursor || !local) {
        // Pre-cursor server build, or the snapshot has not seeded the local
        // fold yet — the old signal-then-refetch path is the honest fallback.
        void trpcUtils.langy.messages.invalidate({ projectId, conversationId });
        return;
      }
      if (compareLangyEventCursors(signalCursor, local) <= 0) return;

      // Bounded catch-up: each page advances the cursor; three pages is far
      // beyond any real burst (the ceiling is a defensive log, not a path).
      let after = local;
      for (let page = 0; page < 3; page++) {
        const tail = await trpcUtils.langy.conversationEventsAfter.fetch({
          projectId,
          conversationId,
          after,
        });
        useLangyStore.getState().applyTurnEvents(tail.events);
        after = tail.cursor;
        if (!tail.truncated) break;
      }

      if (
        isLangyTurnProjectionTerminal(useLangyStore.getState().turnProjection)
      ) {
        void trpcUtils.langy.messages.invalidate({ projectId, conversationId });
      }
    },
    [trpcUtils],
  );

  const onConversationUpdated = useCallback(
    (signals: LangyConversationUpdateSignal[]) => {
      const projectId = project?.id;
      if (!projectId) return;

      for (const signal of signals) {
        if (signal.conversationId === activeConversationId) {
          catchUpOpenConversation(
            projectId,
            signal.conversationId,
            signal.cursor,
          ).catch(() => {
            // A failed catch-up must not strand the open thread — fall back to
            // the plain refetch the signal used to mean.
            void trpcUtils.langy.messages.invalidate({
              projectId,
              conversationId: signal.conversationId,
            });
          });
        }
      }

      // The list carries no content and the signal no spine, so a change always
      // routes through a single server-gated refetch per debounced batch.
      void trpcUtils.langy.list.cancel();
      void trpcUtils.langy.list.invalidate();
    },
    [trpcUtils, project?.id, activeConversationId, catchUpOpenConversation],
  );

  useLangyConversationUpdateListener({
    projectId: project?.id ?? "",
    enabled: !!project?.id,
    onConversationUpdated,
    debounceMs: 1500,
    maxWaitMs: 1500,
  });
}
