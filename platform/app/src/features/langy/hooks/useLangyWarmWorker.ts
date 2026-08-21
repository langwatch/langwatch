import { useEffect, useRef } from "react";
import { api } from "~/utils/api";
import { useLangyStore } from "../stores/langyStore";

/**
 * Pre-warm the Langy worker when the panel is the strongest signal a message
 * is coming (specs/langy/langy-worker-prewarm.feature): on the panel-open
 * rising edge, and again whenever the panel points at a different conversation
 * while open. Fires the `langy.warmWorker` mutation at most once per
 * (projectId, conversation-or-fresh) while the panel stays open; closing and
 * reopening re-arms (the server probe makes a re-warm on a live worker a
 * cheap no-op).
 *
 * For a fresh chat the mutation returns the server-minted conversation id,
 * stored as the panel's `pendingConversationId` so the first send adopts the
 * conversation whose worker is already booting, never as the active id,
 * because nothing durable exists under it yet.
 *
 * Strictly fire-and-forget: no loading state, no toast, no error surface. A
 * warm failure is the cold start the user would have had anyway, and the
 * first real message is where errors get their proper cards.
 *
 * Visibility gating is the panel's MOUNT gate: `ProjectLangyLayout` renders
 * the sidecar only when `useShowLangy` passes, so this hook never runs for a
 * user without Langy, it must only ever be called from inside that gate.
 * (The server's own access gate on the mutation is the authoritative check
 * either way.)
 */
export function useLangyWarmWorker({
  projectId,
  isOpen,
  conversationId,
  model,
}: {
  projectId: string | undefined;
  /** The panel's open flag, nothing warms while it is closed. */
  isOpen: boolean;
  /** The active conversation, or null for a fresh chat. */
  conversationId: string | null;
  /**
   * The model the composer's picker shows, passed as the warm's override so
   * the warmed worker's signature matches the turn the user is about to send.
   * Pass null until the model queries have settled (or when no model is
   * configured), a warm on a model the picker then snaps away from would
   * boot a worker the turn cannot reuse.
   */
  model: string | null;
}): void {
  const warmMutation = api.langy.warmWorker.useMutation();

  // The mutation object is not referentially stable across renders; the effect
  // reads through refs so its dependency list carries only the values that
  // should re-arm a warm.
  const mutateRef = useRef(warmMutation.mutate);
  mutateRef.current = warmMutation.mutate;
  const latestProjectIdRef = useRef(projectId);
  latestProjectIdRef.current = projectId;

  // One warm per (projectId, conversation-or-fresh) per open. Cleared when the
  // panel closes so the next open warms again.
  const firedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!isOpen) {
      firedRef.current.clear();
      return;
    }
    if (!projectId || !model) return;
    const key = `${projectId}:${conversationId ?? ""}`;
    if (firedRef.current.has(key)) return;
    firedRef.current.add(key);

    const forProjectId = projectId;
    const forConversationId = conversationId;
    mutateRef.current(
      {
        projectId: forProjectId,
        ...(forConversationId ? { conversationId: forConversationId } : {}),
        modelOverride: model,
      },
      {
        onSuccess: (result) => {
          // Only a fresh-chat warm has an id worth holding, and only while the
          // panel is still on that fresh chat in that project: a send or a
          // project switch that landed while the warm was in flight wins.
          if (forConversationId || !result.conversationId) return;
          if (latestProjectIdRef.current !== forProjectId) return;
          const store = useLangyStore.getState();
          if (store.activeConversationId !== null) return;
          store.setPendingConversationId(result.conversationId);
        },
        onError: () => {
          // Fire-and-forget by contract: a warm failure is a cold start.
        },
      },
    );
  }, [isOpen, projectId, conversationId, model]);
}
