import { useEffect, useRef } from "react";
import { api } from "~/utils/api";
import { useLangyStore } from "../stores/langyStore";

/**
 * The dedup key one warm is remembered under. The model is part of it: a
 * picker change must warm again, because the worker's signature includes the
 * model and a worker warmed on the previous one cannot serve the turn.
 */
function warmKey({
  projectId,
  conversationId,
  model,
}: {
  projectId: string;
  conversationId: string | null;
  model: string;
}): string {
  return `${projectId}:${conversationId ?? ""}:${model}`;
}

/**
 * Forget every fresh-chat warm this project fired. A conversation taking over
 * (a send adopted the fresh chat, or the user opened an existing one) consumes
 * them, so the next fresh chat in this open is a NEW conversation with a new
 * mint. Without this, the new-chat button after a first warm sent no warm at
 * all, and the first message cold-started while the earlier warm worker sat
 * idle.
 */
function forgetFreshWarms({
  fired,
  projectId,
}: {
  fired: Set<string>;
  projectId: string;
}): void {
  const freshPrefix = `${projectId}::`;
  for (const key of fired) {
    if (key.startsWith(freshPrefix)) fired.delete(key);
  }
}

/**
 * Decide whether this render must fire a warm, and remember it when it does.
 * A conversation on screen first forgets the project's fresh-chat warms, so
 * the next new chat mints again.
 */
function claimWarm({
  fired,
  projectId,
  conversationId,
  model,
}: {
  fired: Set<string>;
  projectId: string;
  conversationId: string | null;
  model: string;
}): boolean {
  if (conversationId) forgetFreshWarms({ fired, projectId });
  const key = warmKey({ projectId, conversationId, model });
  if (fired.has(key)) return false;
  fired.add(key);
  return true;
}

/**
 * Hold a fresh-chat warm's server-minted id as the panel's pending id, unless
 * the panel moved on while the warm was in flight: a send that made a
 * conversation active, or a project switch, both win over this answer.
 */
function holdPendingConversation({
  conversationId,
  projectId,
  latestProjectId,
}: {
  conversationId: string;
  projectId: string;
  latestProjectId: string | undefined;
}): void {
  if (latestProjectId !== projectId) return;
  const store = useLangyStore.getState();
  if (store.activeConversationId !== null) return;
  store.setPendingConversationId(conversationId);
}

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
  pendingConversationId,
  model,
}: {
  projectId: string | undefined;
  /** The panel's open flag, nothing warms while it is closed. */
  isOpen: boolean;
  /** The active conversation, or null for a fresh chat. */
  conversationId: string | null;
  /**
   * The id an earlier fresh-chat warm minted and the first send will adopt.
   * A fresh-chat re-arm (the model changed, the panel flipped through an
   * active conversation and back) warms THIS id again instead of minting
   * another: the server's probe answers alive for its running worker, so the
   * re-warm is a cheap no-op instead of a new conversation id, a new session
   * key and a new worker filling the pool.
   */
  pendingConversationId: string | null;
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

  // One warm per (projectId, conversation-or-fresh, model) per open. Cleared
  // when the panel closes so the next open warms again.
  const firedRef = useRef<Set<string>>(new Set());

  // Every warm carries a number, and only the newest one may claim the pending
  // id. Two warms can be in flight at once (a model switch fires a second while
  // the first is still going), and answers can land out of order, so without
  // this an older fresh-chat mint could overwrite a newer one. Bumping it
  // without firing a warm invalidates whatever is still in flight.
  const generationRef = useRef(0);

  useEffect(() => {
    if (!isOpen) {
      firedRef.current.clear();
      // A warm started before the close would otherwise still answer and hold
      // its id, which the next open would adopt as though the user had just
      // warmed it.
      generationRef.current += 1;
      return;
    }
    if (!projectId || !model) {
      // The project or the model went away mid-flight: the id an earlier warm
      // is about to return belongs to a state the panel has left.
      generationRef.current += 1;
      return;
    }
    // A fresh chat re-warms the id an earlier warm already minted, so the
    // server probes its running worker instead of minting a sibling.
    const targetConversationId = conversationId ?? pendingConversationId;
    const claimed = claimWarm({
      fired: firedRef.current,
      projectId,
      conversationId: targetConversationId,
      model,
    });
    if (!claimed) return;

    generationRef.current += 1;
    const generation = generationRef.current;
    const forProjectId = projectId;
    const forModel = model;
    mutateRef.current(
      {
        projectId: forProjectId,
        ...(targetConversationId
          ? { conversationId: targetConversationId }
          : {}),
        modelOverride: model,
      },
      {
        onSuccess: (result) => {
          // Only a mint (a fresh warm with no target) has an id worth
          // holding, and only when no newer warm has been fired since.
          if (generationRef.current !== generation) return;
          if (targetConversationId || !result.conversationId) return;
          // The held id becomes the next render's warm target; remember it as
          // already warmed so holding it does not immediately re-fire.
          firedRef.current.add(
            warmKey({
              projectId: forProjectId,
              conversationId: result.conversationId,
              model: forModel,
            }),
          );
          holdPendingConversation({
            conversationId: result.conversationId,
            projectId: forProjectId,
            latestProjectId: latestProjectIdRef.current,
          });
        },
        onError: () => {
          // Fire-and-forget by contract: a warm failure is a cold start.
        },
      },
    );
  }, [isOpen, projectId, conversationId, pendingConversationId, model]);
}
