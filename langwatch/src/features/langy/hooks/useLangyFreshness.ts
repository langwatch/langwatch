import { useCallback } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import type { LangyConversationUpdateSignal } from "../data/langy.dtos";
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

  const onConversationUpdated = useCallback(
    (signals: LangyConversationUpdateSignal[]) => {
      const projectId = project?.id;
      if (!projectId) return;

      for (const signal of signals) {
        if (signal.conversationId === activeConversationId) {
          void trpcUtils.langy.messages.invalidate({
            projectId,
            conversationId: signal.conversationId,
          });
        }
      }

      // The list carries no content and the signal no spine, so a change always
      // routes through a single server-gated refetch per debounced batch.
      void trpcUtils.langy.list.cancel();
      void trpcUtils.langy.list.invalidate();
    },
    [trpcUtils, project?.id, activeConversationId],
  );

  useLangyConversationUpdateListener({
    projectId: project?.id ?? "",
    enabled: !!project?.id,
    onConversationUpdated,
    debounceMs: 1500,
    maxWaitMs: 1500,
  });
}
