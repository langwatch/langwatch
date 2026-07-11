import { useCallback, useEffect } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import type {
  LangyConversationListItemDto,
  LangyConversationUpdateSignal,
} from "../data/langy.dtos";
import { useLangySseStatusStore } from "../stores/langySseStatusStore";
import { useLangyConversationUpdateListener } from "./useLangyConversationUpdateListener";

/**
 * Page-level real-time coordinator for Langy, mirroring `useTraceFreshness`.
 * Mounted ONCE by the panel so exactly one SSE subscription serves every list
 * / detail consumer (tRPC subscriptions aren't deduped across hook instances —
 * one-per-consumer would starve the browser's connection pool).
 *
 * Perceived-latency optimization (per product direction): the freshness signal
 * carries the low-sensitivity operational spine the worker already holds, so we
 * APPLY it in place with `setData` and skip a ClickHouse round-trip. We only
 * fall back to cancel()+invalidate() when:
 *   - the conversation isn't already in the (server-filtered) list cache — a
 *     new/foreign conversation must go through the server visibility gate, or
 *   - the signal carries no operational payload.
 * The result: instant for the conversation you're looking at, correct for
 * everything else. Content-derived fields (title, messages) are never on the
 * wire, so a title change also routes through invalidate.
 */
export function useLangyFreshness(activeConversationId: string | null): void {
  const { project } = useOrganizationTeamProject();
  const trpcUtils = api.useContext();
  const requestFastPoll = useLangySseStatusStore((s) => s.requestFastPoll);
  const setSseConnectionState = useLangySseStatusStore(
    (s) => s.setSseConnectionState,
  );
  const setLastEventAt = useLangySseStatusStore((s) => s.setLastEventAt);

  const onConversationUpdated = useCallback(
    (signals: LangyConversationUpdateSignal[]) => {
      const projectId = project?.id;
      if (!projectId) return;

      // Keep the "N new" pill accurate regardless of apply-vs-invalidate.
      void trpcUtils.langy.newCount.cancel();
      void trpcUtils.langy.newCount.invalidate();

      const listInput = { projectId };
      const known = new Set(
        (trpcUtils.langy.list.getData(listInput)?.items ?? []).map(
          (item) => item.id,
        ),
      );

      let needsListRefetch = false;

      for (const signal of signals) {
        const hasOperationalPayload =
          signal.status !== undefined ||
          signal.messageCount !== undefined ||
          signal.lastActivityAtMs !== undefined;

        // A title change carries no title text on the wire (privacy), so an
        // in-place apply can't pick it up — force a visibility-gated refetch
        // that re-reads the new title from the server.
        if (
          known.has(signal.conversationId) &&
          hasOperationalPayload &&
          !signal.titleChanged
        ) {
          // Apply in place — no network round-trip.
          trpcUtils.langy.list.setData(listInput, (old) => {
            if (!old) return old;
            const items = old.items.map((item) =>
              item.id === signal.conversationId
                ? applySignal(item, signal)
                : item,
            );
            items.sort((a, b) => b.lastActivityAtMs - a.lastActivityAtMs);
            return { ...old, items };
          });

          // Patch the open conversation's detail cache too so its status
          // (running/idle/failed) reflects immediately.
          if (signal.conversationId === activeConversationId) {
            trpcUtils.langy.detail.setData(
              { projectId, conversationId: signal.conversationId },
              (old) =>
                old
                  ? {
                      ...old,
                      status: signal.status ?? old.status,
                      messageCount: signal.messageCount ?? old.messageCount,
                      lastActivityAtMs:
                        signal.lastActivityAtMs ?? old.lastActivityAtMs,
                    }
                  : old,
            );
          }
        } else {
          // Unknown conversation (new / foreign) or no payload — let the
          // server re-decide visibility via a refetch.
          needsListRefetch = true;
        }
      }

      if (needsListRefetch) {
        void trpcUtils.langy.list.cancel();
        void trpcUtils.langy.list.invalidate();
      }

      requestFastPoll();
    },
    [trpcUtils, project?.id, activeConversationId, requestFastPoll],
  );

  const { connectionState, lastEventAt } = useLangyConversationUpdateListener({
    projectId: project?.id ?? "",
    enabled: !!project?.id,
    onConversationUpdated,
    debounceMs: 1500,
    maxWaitMs: 1500,
  });

  useEffect(() => {
    setSseConnectionState(connectionState);
  }, [connectionState, setSseConnectionState]);

  useEffect(() => {
    if (lastEventAt > 0) setLastEventAt(lastEventAt);
  }, [lastEventAt, setLastEventAt]);
}

/** Patch a list item with a freshness signal's operational fields. */
function applySignal(
  item: LangyConversationListItemDto,
  signal: LangyConversationUpdateSignal,
): LangyConversationListItemDto {
  return {
    ...item,
    messageCount: signal.messageCount ?? item.messageCount,
    lastActivityAtMs: signal.lastActivityAtMs ?? item.lastActivityAtMs,
  };
}
