import { showErrorToast } from "@langwatch/browser-host/errors";
import { useRouter } from "@langwatch/browser-host/use-router";
import {
  executeUiAction,
  type LangyContextChip,
  type LangyUiActionHandlers,
  navigateDedupKey,
  reserveNavigate,
  useLangyStore,
} from "@langwatch/langy-browser-kit";
import type { LangyResourceContext, LangyStreamEntry } from "@langwatch/langy-contract";
import { nowInstant } from "@langwatch/time";
import { type RefObject, useMemo, useRef } from "react";

import { api, type LangyTrpcClient } from "../../../../behavior/langy-api.ts";
import { useLangyLocalControlStore } from "../../../../behavior/langy-local-control.store.ts";
import { useFeatureFlag } from "../../../../behavior/use-feature-flag.ts";
import { isOnPageOwningAction } from "../../../../model/ui-actions/manifest-routes.ts";
import {
  createLangyChatTransport,
  type LangyTurnRequestContext,
  type LangyTurnSettleReason,
  type LangyTurnSignalEntry,
} from "../logic/langy-chat-transport.ts";
import { isInternalHref } from "../logic/spa-link.ts";
import { useLangyDevLog } from "../stores/langy-dev-log.ts";

type ApiUtils = ReturnType<typeof api.useUtils>;
type Router = ReturnType<typeof useRouter>;

/**
 * Applies a live turn signal onto the store the panel reads. Status/progress/reasoning/plan are
 * the four the panel renders; milestone entries have no consumer yet.
 */
export function applyTurnSignal(signal: LangyTurnSignalEntry): void {
  const store = useLangyStore.getState();
  if (signal.type === "status") {
    if (signal.readiness) store.setTurnReadinessStatus(signal.status);
    else store.setTurnStatus(signal.status);
    return;
  }
  if (signal.type === "progress") {
    applyProgressSignal(signal);
    return;
  }
  if (signal.type === "reasoning") {
    // Ephemeral thinking — accumulate the run onto the live reasoning so it
    // reads as one flowing block while it streams.
    store.appendTurnReasoning(signal.text);
    return;
  }
  if (signal.type === "plan") store.setTurnPlan(signal.items);
}

/** The progress half of {@link applyTurnSignal}. */
function applyProgressSignal(signal: Extract<LangyTurnSignalEntry, { type: "progress" }>): void {
  const store = useLangyStore.getState();
  if (signal.message?.trim()) store.setTurnStatus(signal.message);
  if (signal.progress !== undefined) store.setTurnProgress(signal.progress);

  const { current, total } = signal;
  const counted =
    typeof current === "number" &&
    Number.isFinite(current) &&
    current >= 0 &&
    typeof total === "number" &&
    Number.isFinite(total) &&
    total > 0;
  if (!counted) return;

  store.setTurnProgressSample({
    current,
    total,
    ...(signal.batchItems !== undefined ? { batchItems: signal.batchItems } : {}),
    ...(signal.batchDurationMs !== undefined ? { batchDurationMs: signal.batchDurationMs } : {}),
    receivedAtMs: nowInstant().epochMilliseconds,
  });
}

/** Carry out one typed UI action the agent asked THIS page for. */
function dispatchUiActionToPage({
  client,
  entry,
  projectId,
  seen,
  getHandlers,
}: {
  client: LangyTrpcClient;
  entry: { actionId: string; kind: string; payload: unknown };
  projectId: string | undefined;
  seen: Set<string>;
  getHandlers: () => LangyUiActionHandlers;
}): void {
  const store = useLangyStore.getState();
  const conversationId = store.activeConversationId;
  // The turn is local bookkeeping only: it keys the replay dedup below. The
  // server does not ask for it, because the page and the dispatch learn the
  // current turn from two records that settle at different moments.
  const turnId = store.activeTurnId;
  if (!projectId || !conversationId) return;

  void executeUiAction({
    entry,
    turnId,
    seen,
    getHandlers,
    isPageArriving: (kind) => isOnPageOwningAction({ kind, pathname: window.location.pathname }),
    claim: ({ actionId }) =>
      client.langy.claimUiAction.mutate({ projectId, conversationId, actionId }),
    complete: ({ actionId, ok, result, errorCode }) =>
      client.langy.completeUiAction.mutate({
        projectId,
        conversationId,
        actionId,
        ok,
        ...(result !== undefined ? { result } : {}),
        ...(errorCode ? { errorCode } : {}),
      }),
    onHandlerError: ({ kind, error }) => {
      showErrorToast({
        error,
        fallbackTitle: "Langy's change didn't apply",
        description: `The page could not carry out ${kind}. Nothing else was affected.`,
      });
    },
  }).catch(() => undefined);
}

/**
 * Follow one navigate instruction, once per turn and href. router.push ONLY — a same-project SPA
 * route change keeps this panel mounted, so the in-flight response keeps streaming through it.
 */
function followNavigateInstruction({
  entry,
  seen,
  router,
}: {
  entry: Extract<LangyStreamEntry, { type: "navigate" }>;
  seen: Set<string>;
  router: Router;
}): void {
  if (!isInternalHref(entry.href)) return;
  const turnId = useLangyStore.getState().activeTurnId;
  const key = navigateDedupKey({ turnId, href: entry.href });
  if (!reserveNavigate({ seen, key })) return;
  void router.push(entry.href);
}

/** ADR-129: the fast path that puts a waiting card up before the durable tail lands. */
function recordLocalWait(
  entry: Extract<LangyStreamEntry, { type: "local_permission" | "question" }>,
): void {
  const wait =
    entry.type === "local_permission"
      ? { ...entry, kind: "permission" as const }
      : { ...entry, kind: "question" as const };
  useLangyLocalControlStore.getState().recordWait({
    conversationId: useLangyStore.getState().activeConversationId,
    wait,
  });
}

function recordLocalWorkspace(entry: Extract<LangyStreamEntry, { type: "local_workspace" }>): void {
  useLangyLocalControlStore.getState().recordWorkspace({
    conversationId: useLangyStore.getState().activeConversationId,
    workspace: {
      state: entry.state,
      name: entry.name,
      root: entry.root,
      hostname: entry.hostname,
      ...(entry.gitBranch ? { gitBranch: entry.gitBranch } : {}),
    },
  });
}

/** The turn a resume reattaches to, read from the store at resume time. */
function currentResumeTarget(projectId: string | undefined) {
  const store = useLangyStore.getState();
  if (!projectId || !store.activeConversationId || !store.activeTurnId) return null;
  return {
    projectId,
    conversationId: store.activeConversationId,
    turnId: store.activeTurnId,
  };
}

/**
 * The turn stream ended. A genuine end-of-turn frame retires the durable in-flight flag locally at
 * once; a silent close or an error keeps the durable truth in charge. The durable view refetches.
 */
function settleTurnStream({ reason, utils }: { reason: LangyTurnSettleReason; utils: ApiUtils }) {
  const store = useLangyStore.getState();
  store.resetTurnSignals();
  if (reason === "end") store.settleTurn(store.activeTurnId);
  void utils.langy.messages.invalidate();
}

/**
 * The turn's wire shape, read at send time (regenerate too): the conversation, the warmed id the
 * create path adopts, the picked model, and every context chip the composer shows.
 */
export function langyTurnContext({
  projectId,
  conversationId,
  pendingConversationId,
  modelOverride,
  chips,
}: {
  projectId: string | undefined;
  conversationId: string | null;
  pendingConversationId: string | null;
  modelOverride: string;
  chips: readonly LangyContextChip[];
}): LangyTurnRequestContext {
  const pageContext = chips.map(({ kind, ref, label }): LangyResourceContext => ({
    kind,
    ref,
    label,
  }));
  return {
    projectId: projectId ?? "",
    conversationId,
    pendingConversationId,
    ...(modelOverride ? { modelOverride } : {}),
    ...(pageContext.length > 0 ? { pageContext } : {}),
  };
}

/** The per-turn bookkeeping the transport and the panel share. */
export interface LangyPanelTurnRefs {
  /** The turn's request inputs, read at SEND time (so `regenerate()` carries them too). */
  turnContextRef: RefObject<LangyTurnRequestContext | null>;
  /** The text of the send in flight, held so a failure can hand it back. */
  lastSentTextRef: RefObject<string | null>;
  /** The turn this tab's own send started. */
  dispatchedTurnIdRef: RefObject<string | null>;
  /** The adopted turn this tab already reattached to. */
  resumedTurnIdRef: RefObject<string | null>;
}

/**
 * The panel's chat transport (memoised once): starts the turn via tRPC mutations, then bridges
 * the `onTurnStream` subscription into the UIMessageChunk stream useChat consumes.
 */
export function useLangyPanelTransport({
  projectId,
  organizationId,
  actionHandlersRef,
}: {
  projectId: string | undefined;
  organizationId: string | undefined;
  actionHandlersRef?: RefObject<LangyUiActionHandlers>;
}) {
  const utils = api.useUtils();
  const router = useRouter();
  const turnContextRef = useRef<LangyTurnRequestContext | null>(null);
  const lastSentTextRef = useRef<string | null>(null);
  // Instructions already acted on, reset per turn in `onIds`: a stream-tail
  // replay after a reconnect could hand the same instruction twice.
  const navigatedInstructionsRef = useRef<Set<string>>(new Set());
  const uiActionSeenRef = useRef<Set<string>>(new Set());
  const dispatchedTurnIdRef = useRef<string | null>(null);
  const resumedTurnIdRef = useRef<string | null>(null);

  // The rollback lever for agent-driven page control: with the flag off this page
  // ignores `ui` stream entries, so switching it off during a live turn stops the page
  // changing under the user.
  const uiActionsFlag = useFeatureFlag("release_langy_ui_actions", { projectId, organizationId });
  const isUiActionChannelClosedRef = useRef(false);
  isUiActionChannelClosedRef.current = !uiActionsFlag.isLoading && !uiActionsFlag.enabled;

  // `router` gets a new identity on every route change; the transport is
  // memoised once, so it reads through a ref the render keeps fresh.
  const routerRef = useRef(router);
  routerRef.current = router;

  const transport = useMemo(
    () =>
      createLangyChatTransport({
        client: utils.client,
        getContext: () => {
          const ctx = turnContextRef.current;
          if (!ctx) throw new Error("Langy turn context not ready");
          return ctx;
        },
        onIds: ({ conversationId, turnId }) => {
          useLangyStore.getState().beginTurn({ conversationId, turnId });
          dispatchedTurnIdRef.current = turnId;
          // The words are a bubble on screen now, so they are no longer a
          // draft to hand back.
          lastSentTextRef.current = null;
          navigatedInstructionsRef.current = new Set();
          uiActionSeenRef.current = new Set();
        },
        getResumeTarget: () => currentResumeTarget(turnContextRef.current?.projectId),
        onNavigate: (entry) =>
          followNavigateInstruction({
            entry,
            seen: navigatedInstructionsRef.current,
            router: routerRef.current,
          }),
        onUiAction: (entry) => {
          if (isUiActionChannelClosedRef.current) return;
          dispatchUiActionToPage({
            client: utils.client,
            entry,
            projectId: turnContextRef.current?.projectId,
            seen: uiActionSeenRef.current,
            getHandlers: () => actionHandlersRef?.current ?? {},
          });
        },
        onLocalWait: recordLocalWait,
        onLocalWorkspace: recordLocalWorkspace,
        onSignal: applyTurnSignal,
        // Developer mode's tape: a no-op unless the inspector armed recording.
        onWireEntry: (entry, turnId) => useLangyDevLog.getState().record(entry, turnId),
        onTurnSettled: ({ reason }) => settleTurnStream({ reason, utils }),
      }),
    [utils, actionHandlersRef],
  );

  const refs: LangyPanelTurnRefs = {
    turnContextRef,
    lastSentTextRef,
    dispatchedTurnIdRef,
    resumedTurnIdRef,
  };
  return { transport, refs };
}
