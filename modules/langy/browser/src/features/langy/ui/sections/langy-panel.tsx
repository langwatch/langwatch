import { useUiDeployment } from "@langwatch/browser-host/capabilities";
import { useDrawer } from "@langwatch/browser-host/drawer";
import { IsolatedErrorBoundary } from "@langwatch/browser-host/isolated-error-boundary";
import { Kbd } from "@langwatch/design-system/kbd";
import { LangyMark, LangyMarkGradientDefs } from "@langwatch/design-system/langy-mark";
import { Menu } from "@langwatch/design-system/menu";
import {
  Box,
  chakra,
  HStack,
  IconButton,
  Separator,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { TriggerAnchor } from "@langwatch/design-system/trigger-anchor";
import { useReducedMotion } from "@langwatch/design-system/use-reduced-motion";
import { NOT_TARGETED } from "@langwatch/feature-flag-contract";
import {
  AppWindow,
  Braces,
  Check,
  History,
  LayoutGrid,
  type LucideIcon,
  Minus,
  MoreHorizontal,
  PanelLeftOpen,
  PanelRight,
  PictureInPicture2,
  Square,
  SquarePen,
  Waves,
} from "lucide-react";
import { Profiler, type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { mergeContextChips } from "../../../../behavior/langy-context-chips.ts";
import { removeContextChip } from "../../../../behavior/langy-context-target.store.ts";
import {
  attachedContextToChip,
  type LangyPanelEffect,
  type LangyPanelMode,
  useLangyStore,
} from "../../../../behavior/langy.store.ts";
import { useFeatureFlag } from "../../../../behavior/use-feature-flag.ts";
import { useGlobalLangyShortcut } from "../../../../behavior/use-global-langy-shortcut.ts";
import { useLangyContextDropZone } from "../../../../behavior/use-langy-context-drop-zone.ts";
import { useLangyDevMode } from "../../../../behavior/use-langy-dev-mode.ts";
import { useLangyOrbProximity } from "../../../../behavior/use-langy-orb-proximity.ts";
import { useLangyTurnSignals } from "../../../../behavior/use-langy-turn-signals.ts";
import { useLingeringDodge } from "../../../../behavior/use-lingering-dodge.ts";
import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project.ts";
import { useScrolledFromTop } from "../../../../behavior/use-scrolled-from-top.ts";
import { LANGY_DODGE_STAGGER_MS } from "../../../../model/langy-panel-layout.ts";
import { type LangyUiActionHandlers } from "../../../../model/ui-actions/langy-ui-action-types.ts";
import { LangyContextTargetLayer } from "../../../../ui/sections/langy-context-target-layer.tsx";
import {
  guidedPathInProgress,
  guidedPullRequestFromMessages,
  isGuidedConversation,
} from "../../../guided-onboarding/model/guided-conversation.ts";
import { guidedKickoffPartOf } from "../../../guided-onboarding/model/kickoff.ts";
import { useLangyConversationList } from "../../behavior/data/use-langy-conversation-list.ts";
import { useLangyMessages } from "../../behavior/data/use-langy-messages.ts";
import {
  useFollowConversationModel,
  useLangyComposerModel,
} from "../../behavior/panel/use-langy-composer-model.ts";
import {
  useLangyConversationFacts,
  useLangyEmptySuggestions,
} from "../../behavior/panel/use-langy-conversation-facts.ts";
import { useLangyConversationNavigation } from "../../behavior/panel/use-langy-conversation-navigation.ts";
import {
  useLangyAdoptedTurnResume,
  useLangyEngineHistorySync,
  useLangyForeignTurnRehydration,
  useLangyTurnProjectionSeed,
} from "../../behavior/panel/use-langy-engine-sync.ts";
import { useLangyKickoffSend } from "../../behavior/panel/use-langy-kickoff-send.ts";
import {
  useLangyChoiceAnswer,
  useLangyLocalWaits,
} from "../../behavior/panel/use-langy-local-waits.ts";
import { useLangyMakeDefault } from "../../behavior/panel/use-langy-make-default.ts";
import {
  langyColumnFlags,
  latestAssistant,
  useLangyTimeTravelView,
  useLangyTranscriptReads,
  useLangyTurnActivity,
} from "../../behavior/panel/use-langy-panel-display.ts";
import {
  useLangyHistoryError,
  useLangyListError,
} from "../../behavior/panel/use-langy-panel-errors.ts";
import {
  useLangyDevInspector,
  useLangyFloatingFloor,
  useLangyPanelPeek,
  useLangyPanelPlacement,
} from "../../behavior/panel/use-langy-panel-layout.ts";
import { useLangyPanelNotifications } from "../../behavior/panel/use-langy-panel-notifications.ts";
import {
  useLangyDraftRestore,
  useLangyPanelSend,
} from "../../behavior/panel/use-langy-panel-send.ts";
import { useLangyPanelStop } from "../../behavior/panel/use-langy-panel-stop.ts";
import {
  langyTurnContext,
  useLangyPanelTransport,
} from "../../behavior/panel/use-langy-panel-transport.ts";
import {
  useLangyGithubRedrive,
  useLangyTurnFailure,
} from "../../behavior/panel/use-langy-turn-failure.ts";
import { useGuidedTour } from "../../behavior/use-guided-tour.ts";
import { useLangyChatEngine } from "../../behavior/use-langy-chat-engine.ts";
import { useLangyFreshness } from "../../behavior/use-langy-freshness.ts";
import { useLangyStickToBottom } from "../../behavior/use-langy-stick-to-bottom.ts";
import { useLangyWarmWorker } from "../../behavior/use-langy-warm-worker.ts";
import { LangyExternalLinkDialog } from "../elements/langy-external-link-dialog.tsx";
import { LangyMakeDefaultDialog } from "../elements/langy-make-default-dialog.tsx";
import { AnimatedConversationTitle } from "./animated-conversation-title.tsx";
import { Composer } from "./composer.tsx";
import { LangyDevDrawer } from "./langy-dev-drawer.tsx";
import { LangyNotificationsMenuGroup } from "./langy-notifications-menu-group.tsx";
import type { ProposalHandlers } from "./langy-proposal-card.tsx";
import { LangySendProvider } from "./langy-send-context.tsx";
import {
  LangyConversationBody,
  LangyConversationScroller,
  LangyTranscript,
} from "./panel/langy-panel-conversation.tsx";
import {
  LangyPanelBackdrop,
  LangyPanelFrame,
  LangyPeekControl,
} from "./panel/langy-panel-frame.tsx";
import {
  LangyComposerNotice,
  LangyComposerSlot,
  LangyFailureSurface,
  LangyPinnedPlan,
  LangyTimeTravelVeil,
} from "./panel/langy-panel-turn.tsx";
import {
  hasInlineProgress,
  LangyColumnNotices,
  langyColumnState,
  langyMessageContext,
  langyProfilerRender,
  LangyTurnWorkingLineSlot,
  LangyWaitingCardsSlot,
  LangyWorkspaceChipSlot,
  useLangyCardSend,
  useLangySetupScrollsToTop,
  waitingCardsAnchor,
} from "./panel/langy-panel-view.tsx";
import {
  useLangyCodeAccessReAsk,
  useLangyProposalApply,
  useLangyVerifyDerivedCard,
} from "./panel/use-langy-panel-offers.ts";
import { RecentChatsView } from "./recent-chats-view.tsx";
import { useLangyExternalLinkGuard } from "./use-langy-external-link-guard.ts";
import { useLangyPageContext } from "./use-langy-page-context.ts";

interface LangySidecarProps {
  proposalHandlersRef?: React.RefObject<ProposalHandlers>;
  actionHandlersRef?: React.RefObject<LangyUiActionHandlers>;
}

export function LangySidecar({ proposalHandlersRef, actionHandlersRef }: LangySidecarProps) {
  const isOpen = useLangyStore((s) => s.isOpen);
  const toggle = useLangyStore((s) => s.togglePanel);
  const openPanel = useLangyStore((s) => s.openPanel);
  useGlobalLangyShortcut(toggle);
  // The minimised affordance is mid-rollout: flag ON, minimise sinks the panel to a
  // sliver of its own header (see the peek wiring in LangyPanel); flag OFF keeps the
  // classic corner launcher orb.
  const { project, organization } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const peekDock = useFeatureFlag("release_ui_langy_peek_dock_enabled", {
    projectId: project?.id ?? NOT_TARGETED,
    organizationId: organization?.id ?? NOT_TARGETED,
  });

  return (
    <>
      <LangyMarkGradientDefs />
      {/* Flag ON, the panel IS the minimised affordance — it slides down to a
          sliver of its own header rather than handing off to anything else,
          so there is nothing to render here. Flag OFF keeps the classic
          corner launcher orb. Exactly one, never both. */}
      {peekDock.enabled ? null : <LangyLauncher isOpen={isOpen} onOpen={toggle} />}
      <LangyContextTargetLayer />
      <LangyPanel
        proposalHandlersRef={proposalHandlersRef}
        actionHandlersRef={actionHandlersRef}
        peekEnabled={peekDock.enabled}
        onOpen={openPanel}
      />
    </>
  );
}

/**
 * The FLAG-OFF closed-state opener — a single circular launcher in the bottom-right
 * corner (the Notion-AI model).
 */
function LangyLauncher({ isOpen, onOpen }: { isOpen: boolean; onOpen: () => void }) {
  const reduceMotion = useReducedMotion();
  // A right-anchored drawer fills the right edge while the panel is closed, so
  // the bottom-right launcher would sit on top of it (and the table pager).
  // Dodge to the bottom-LEFT corner while a drawer is open; hop back only a
  // beat after the drawer has left, on the same cadence as the panel's dodge.
  const { currentDrawer } = useDrawer();
  const dodgeLeft = useLingeringDodge({
    active: !!currentDrawer,
    releaseDelayMs: LANGY_DODGE_STAGGER_MS,
    immediate: reduceMotion,
  });
  // The orb leans + glows toward the cursor as it approaches (the one place a Langy
  // surface reacts to the pointer — a hover affordance on the target itself, not
  // ambient chrome). Disabled under reduced motion.
  const { orbRef, glowRef, activate } = useLangyOrbProximity({
    enabled: !reduceMotion && !isOpen,
  });
  if (isOpen) return null;
  return (
    <Tooltip
      content={
        <HStack gap={2}>
          <Text>Chat with Langy</Text>
          <HStack gap={1}>
            <Kbd>⌘</Kbd>
            <Kbd>I</Kbd>
          </HStack>
        </HStack>
      }
      positioning={{ placement: "left" }}
      openDelay={200}
    >
      <chakra.button
        ref={orbRef}
        type="button"
        className="langy-root"
        onClick={() => {
          // Fire the bloom while the orb is still mounted (reads its rect), then
          // open — the bloom outlives the unmount on its own.
          activate();
          onOpen();
        }}
        aria-label="Open Langy assistant"
        aria-keyshortcuts="Meta+I Control+I"
        position="fixed"
        bottom="20px"
        // Bottom-right by default; hops to bottom-left while a drawer holds the
        // right edge so it never sits on the drawer or the table pager. (The
        // proximity hook owns `transform`, and left/right can't cross-fade, so
        // this repositions rather than slides.)
        {...(dodgeLeft ? { left: "20px" } : { right: "20px" })}
        // Keep modal/dialog layers above Langy. Chakra's modal stack starts at
        // the modal layer, while Langy remains a persistent app companion.
        zIndex={1200}
        width="46px"
        height="46px"
        borderRadius="full"
        display="grid"
        placeItems="center"
        background="bg.surface"
        borderWidth="1px"
        borderStyle="solid"
        borderColor="border.emphasized"
        boxShadow="0 1px 2px rgba(20,20,23,0.08), 0 8px 24px rgba(20,20,23,0.14)"
        _dark={{
          boxShadow: "0 1px 2px rgba(0,0,0,0.5), 0 10px 30px rgba(0,0,0,0.55)",
        }}
        cursor="pointer"
        transition="box-shadow 160ms ease, border-color 160ms ease"
        _hover={{
          borderColor: "orange.emphasized",
          boxShadow: "0 2px 4px rgba(20,20,23,0.10), 0 12px 32px rgba(20,20,23,0.18)",
        }}
      >
        {/* Warm proximity glow — bleeds out around the orb toward the cursor.
            Behind the orb body (z-index -1) so only the reaching edge shows;
            positioned + faded imperatively by useLangyOrbProximity. */}
        <span ref={glowRef} className="langy-orb-glow" aria-hidden />
        <LangyMark size={26} />
      </chakra.button>
    </Tooltip>
  );
}

/**
 * The Langy panel: every stage lives in its own hook under behavior/panel, and every surface in
 * ui/sections/panel; this component only wires them together.
 */
function LangyPanel({
  proposalHandlersRef,
  actionHandlersRef,
  peekEnabled,
  onOpen,
}: {
  proposalHandlersRef?: React.RefObject<ProposalHandlers>;
  actionHandlersRef?: React.RefObject<LangyUiActionHandlers>;
  /**
   * Minimising slides this panel down to a sliver of its own header instead
   * of hiding it outright (`release_ui_langy_peek_dock_enabled`). Flag off,
   * closed still means invisible and the launcher orb does the opening.
   */
  peekEnabled: boolean;
  /** Activating the peeking sliver — its click, its Enter/Space. */
  onOpen: () => void;
}) {
  const { organization, project } = useOrganizationTeamProject();
  const projectId = project?.id;
  const organizationId = organization?.id;
  const { isDevelopment } = useUiDeployment();
  const onProfilerRender = useMemo(() => langyProfilerRender(isDevelopment), [isDevelopment]);

  const isOpen = useLangyStore((s) => s.isOpen);
  const closePanel = useLangyStore((s) => s.closePanel);
  const pickModel = useLangyStore((s) => s.pickModel);
  const activeConversationId = useLangyStore((s) => s.activeConversationId);
  const pendingPrompt = useLangyStore((s) => s.pendingPrompt);
  const pendingKickoff = useLangyStore((s) => s.pendingKickoff);
  const guidedTourRunning = useGuidedTour().useRunning();
  const pendingConversationId = useLangyStore((s) => s.pendingConversationId);
  const interruptedConversationId = useLangyStore((s) => s.interruptedConversationId);
  const pinnedFeedbackMessageId = useLangyStore((s) => s.pinnedFeedbackMessageId);
  const chooseChip = useLangyStore((s) => s.chooseChip);
  const attachedContext = useLangyStore((s) => s.attachedContext);
  // An app shell (DashboardLayout) places the dock as a second content card.
  const dockShellClaimed = useLangyStore((s) => s.dockShellClaims > 0);
  const panelEffect = useLangyStore((s) => s.panelEffect);
  const cardGalleryOpen = useLangyStore((s) => s.cardGalleryOpen);
  const turnActive = useLangyStore((s) => s.turnPhase !== "idle");
  const { isOver: isContextDropOver, dropProps: contextDropProps } = useLangyContextDropZone();
  const panelRef = useRef<HTMLDivElement>(null);
  // Langy's answers are written from data the agent was handed, so one check at
  // the root reads every link's real destination (specs/langy/langy-external-link-guard.feature).
  const externalLinkGuard = useLangyExternalLinkGuard();
  // The recents list takes over the panel BODY; local, and deliberately not persisted.
  const [historyOpen, setHistoryOpen] = useState(false);
  const inspector = useLangyDevInspector({ panelRef });
  const placement = useLangyPanelPlacement();
  const { floating, reduceMotion } = placement;
  const peek = useLangyPanelPeek({
    peekEnabled,
    floating,
    reduceMotion,
    drawerEdgeHeld: placement.drawerEdgeHeld,
  });

  useEffect(() => {
    if (projectId) useLangyStore.getState().resetForProject(projectId);
  }, [projectId]);

  const { transport, refs } = useLangyPanelTransport({
    projectId,
    organizationId,
    actionHandlersRef,
  });
  const model = useLangyComposerModel({ projectId });
  const makeDefault = useLangyMakeDefault({ resolvedDefault: model.resolvedDefault });
  const engine = useLangyChatEngine({ transport });
  const isBusy = engine.status === "submitted" || engine.status === "streaming";
  useLangyWarmWorker({
    projectId,
    isOpen,
    conversationId: activeConversationId,
    pendingConversationId,
    turnInFlight: isBusy,
    model: model.warmModel,
  });

  const list = useLangyConversationList();
  const history = useLangyMessages(activeConversationId);
  useFollowConversationModel({
    activeConversationId,
    conversationLastModel: history.lastModel,
    reachableModels: model.reachableModels,
  });
  const historyError = useLangyHistoryError({
    activeConversationId,
    hasHistoryError: history.isError,
    historyError: history.error,
    refetchHistory: history.refetch,
  });
  // The turn phase is the SINGLE, event-driven source of "is a turn in flight" (ADR-078).
  useEffect(() => {
    useLangyStore.getState().observeBackendTurn(history.isTurnInFlight);
  }, [history.isTurnInFlight]);
  const handleStop = useLangyPanelStop({
    projectId,
    foldInFlightTurnId: history.inFlightTurnId,
    stop: engine.stop,
  });
  useLangyTurnProjectionSeed({
    projectId,
    activeConversationId,
    eventCursor: history.eventCursor,
    currentTurnId: history.currentTurnId,
  });
  const historySync = {
    activeConversationId,
    historyMessages: history.messages,
    isFetchingHistory: history.isFetching,
    applyHistoryToEngine: engine.applyHistoryToEngine,
  };
  useLangyEngineHistorySync(historySync);
  useLangyForeignTurnRehydration({
    ...historySync,
    isBusy,
    engineMessageCount: engine.messages.length,
  });
  useLangyAdoptedTurnResume({
    dispatchedTurnIdRef: refs.dispatchedTurnIdRef,
    resumedTurnIdRef: refs.resumedTurnIdRef,
    foldInFlightTurnId: history.inFlightTurnId,
    historyMessageCount: history.messages.length,
    isFetchingHistory: history.isFetching,
    refetchHistory: history.refetch,
    isBusy,
    engineMessages: engine.messages,
    resumeStream: engine.resumeStream,
  });
  const listError = useLangyListError({ hasListError: list.isError, listError: list.error });
  // One SSE subscription keeps the recents list and the open conversation fresh.
  useLangyFreshness(activeConversationId);

  const flags = langyColumnFlags({
    hasActiveConversation: !!activeConversationId,
    messageCount: engine.messages.length,
    hasPendingPrompt: !!pendingPrompt,
    isBusy,
    turnActive,
    isLoadingHistory: history.isLoading,
    isUnconfirmed: historyError.isUnconfirmed,
    historyError: historyError.presentation,
  });
  const facts = useLangyConversationFacts({
    conversations: list.items,
    activeConversationId,
    isRestoring: flags.isRestoring,
  });
  const emptySuggestions = useLangyEmptySuggestions();
  const floorPx = useLangyFloatingFloor({
    emptyAndSettled: flags.emptyAndSettled,
    expectedMessageCount: facts.restoringMessageCount ?? engine.messages.length,
  });
  // The developer-mode card gallery takes over the message column entirely.
  const showCardGallery = inspector.devMode && cardGalleryOpen;
  const scroll = useLangyStickToBottom({
    enabled: !model.langyNeedsModel && !showCardGallery && !historyOpen,
  });
  const scrolledFromTop = useScrolledFromTop(scroll.scrollRef);
  useLangySetupScrollsToTop({
    langyNeedsModel: model.langyNeedsModel,
    scrollRef: scroll.scrollRef,
  });

  // The page's context and what surfaces attached, deduped into one list that
  // feeds BOTH the wire payload and the composer, so what the user sees is what the agent gets.
  const { chips: pageChips, addableChips } = useLangyPageContext();
  const allContextChips = useMemo(
    () => mergeContextChips([...pageChips, ...attachedContext.map(attachedContextToChip)]),
    [pageChips, attachedContext],
  );
  refs.turnContextRef.current = langyTurnContext({
    projectId,
    conversationId: activeConversationId,
    pendingConversationId,
    modelOverride: model.modelOverride,
    chips: allContextChips,
  });

  const restoreDraftOnFailure = useLangyDraftRestore({ lastSentTextRef: refs.lastSentTextRef });
  const failure = useLangyTurnFailure({
    error: engine.error,
    isBusy,
    turnActive,
    durableLastError: history.lastError,
    messages: engine.messages,
    retryEngineTurn: engine.retryTurn,
    restoreDraftOnFailure,
  });
  const send = useLangyPanelSend({
    projectId,
    isBusy,
    latestAssistantMessageId: latestAssistant(engine.messages)?.id,
    lastSentTextRef: refs.lastSentTextRef,
    resetRecovery: failure.recovery.reset,
    sendMessage: engine.sendMessage,
    restoreDraftOnFailure,
  });
  const navigation = useLangyConversationNavigation({
    projectId,
    isBusy,
    send,
    resetEngine: engine.resetEngine,
    resetRecovery: failure.recovery.reset,
    leaveReconnect: () => failure.setReconnectCodex(false),
    closeHistory: () => setHistoryOpen(false),
  });
  useLangyKickoffSend({
    projectId,
    isBusy,
    isRestoring: flags.isRestoring,
    modelQueriesSettled: model.modelQueriesSettled,
    langyNeedsModel: model.langyNeedsModel,
    resetEngine: engine.resetEngine,
    resetRecovery: failure.recovery.reset,
    sendMessage: engine.sendMessage,
    kickoffNamedRef: refs.kickoffNamedRef,
  });
  const proposals = useLangyProposalApply({ proposalHandlersRef });
  const turnSignals = useLangyTurnSignals(activeConversationId);
  const view = useLangyTimeTravelView({
    activeConversationId,
    historyMessages: history.messages,
    messages: engine.messages,
    isBusy,
    liveTurnInFlight: failure.liveTurnInFlight,
    turnSignals,
  });
  const waits = useLangyLocalWaits({
    projectId,
    activeConversationId,
    eventCursor: history.eventCursor,
  });
  const reads = useLangyTranscriptReads({
    displayMessages: view.displayMessages,
    questionCards: waits.questionCards,
  });
  useLangyPanelNotifications({
    conversationId: activeConversationId,
    conversationTitle: facts.title,
    status: engine.status,
    messages: engine.messages,
    waits,
    liveCodeAccessCallId: reads.liveCodeAccessCallId,
  });
  const selectChoice = useLangyChoiceAnswer({
    projectId,
    isBusy,
    questionWaits: waits.questionWaits,
    resetRecovery: failure.recovery.reset,
    sendMessage: engine.sendMessage,
  });
  const askCodeAccessAgain = useLangyCodeAccessReAsk({
    busy: isBusy || turnActive,
    onStop: handleStop,
    send,
  });
  const verifyDerivedCard = useLangyVerifyDerivedCard(send);
  const cardSend = useLangyCardSend({ send, view });
  const hasInlineProgressOwner = hasInlineProgress(latestAssistant(view.displayMessages));
  const activity = useLangyTurnActivity({
    displayMessages: view.displayMessages,
    displayBusy: view.displayBusy,
    displaySignals: view.displaySignals,
    turnInFlight: view.turnInFlight,
    waveInFlight: view.waveInFlight,
    isSettling: !view.timeTravel && failure.isSettling,
    hasInlineProgressOwner,
    turnToolCalls: waits.turnToolCalls,
    permissionCards: waits.permissionCards,
  });
  const onGithubConnected = useLangyGithubRedrive({
    isBusy,
    organizationId,
    retryTurn: failure.retryTurn,
  });

  // A guided conversation tells its pull request as a sentence before the proposal and as one
  // card after the closing line; the progress receipt and the feedback ask stay out of the way.
  const guided = useMemo(() => {
    const conversation = isGuidedConversation(view.displayMessages);
    return {
      conversation,
      inProgress: conversation && guidedPathInProgress(view.displayMessages),
      pullRequest: conversation ? guidedPullRequestFromMessages(view.displayMessages) : null,
    };
  }, [view.displayMessages]);

  const live = !view.timeTravel;
  const transcript = (
    <LangyTranscript
      floating={floating}
      messages={view.displayMessages}
      context={langyMessageContext({
        live,
        isBusy,
        turnActive,
        failure,
        view,
        proposals,
        organizationId,
        activeConversationId,
        shouldAskFeedback: history.shouldAskFeedback,
        reads,
        questionWaits: waits.questionCardsByToolCall,
        onChoiceSelect: selectChoice,
        onVerifyDerivedCard: verifyDerivedCard,
        onAskCodeAccessAgain: askCodeAccessAgain,
        interruptedConversationId,
        pinnedFeedbackMessageId,
        guided,
      })}
      cardAnchorIndex={waitingCardsAnchor({
        turnInFlight: view.turnInFlight,
        messages: view.displayMessages,
      })}
      waitingCards={
        <LangyWaitingCardsSlot
          live={live}
          projectId={projectId}
          conversationId={activeConversationId}
          projectSlug={project?.slug ?? null}
          waits={waits}
          openQuestionParts={reads.openQuestionParts}
          onChoiceSelect={selectChoice}
        />
      }
      queuedPrompt={live ? pendingPrompt : null}
      workingLine={
        <LangyTurnWorkingLineSlot
          view={view}
          activity={activity}
          waits={waits}
          hasInlineProgressOwner={hasInlineProgressOwner}
        />
      }
    />
  );

  return (
    <Profiler id="LangyPanel" onRender={onProfilerRender}>
      <LangySendProvider value={cardSend}>
        {/* A fixed sibling, not a child: the panel clips its own overflow. */}
        <LangyDevDrawer
          open={inspector.visible}
          onClose={inspector.close}
          floating={floating}
          dockShellClaimed={dockShellClaimed}
          panelHeightPx={inspector.panelHeightPx}
        />
        <LangyExternalLinkDialog {...externalLinkGuard.dialogProps} />
        <LangyMakeDefaultDialog
          plan={makeDefault.plan}
          onDecline={makeDefault.decline}
          onConfirm={makeDefault.confirm}
        />
        <LangyPanelFrame
          panelRef={panelRef}
          isOpen={isOpen}
          placement={placement}
          peek={peek}
          dockShellClaimed={dockShellClaimed}
          floorPx={floorPx}
          isContextDropOver={isContextDropOver}
          turnActive={turnActive}
          dropProps={contextDropProps}
          // Capture phase, at the root: a link that leaves LangWatch is caught first.
          guardProps={externalLinkGuard.guardProps}
        >
          <LangyPanelBackdrop
            floating={floating}
            reduceMotion={reduceMotion}
            panelRef={panelRef}
            wave={{
              active: isOpen && panelEffect !== "plain",
              activity: activity.waveActivity,
              statusActive: activity.activityOwnership.waveStatusActive,
            }}
          />
          {peek.peeking ? (
            <LangyPeekControl floating={floating} peek={peek} onOpen={onOpen} />
          ) : null}
          {/* The header and composer never shrink; the message list takes the slack. */}
          <VStack
            ref={peek.inertRef}
            data-langy-peek-body=""
            gap={0}
            align="stretch"
            flex={1}
            minHeight={0}
            position="relative"
            zIndex={1}
          >
            {/* A render crash draws inside the panel frame, never white-screening the host. */}
            <IsolatedErrorBoundary scope="Langy hit a snag" resetKeys={[activeConversationId]}>
              <PanelHeader
                conversationTitle={facts.title}
                workspaceChip={
                  <LangyWorkspaceChipSlot
                    projectId={projectId}
                    conversationId={activeConversationId}
                  />
                }
                onNewChat={navigation.newChat}
                onClose={() => {
                  failure.setReconnectCodex(false);
                  closePanel();
                }}
                // Beside a drawer, the drawer owns the only close affordance on screen.
                hideClose={placement.isDrawerCompanion}
                historyOpen={historyOpen}
                onToggleHistory={() => setHistoryOpen((open) => !open)}
                devMode={inspector.devMode}
                devDrawerOpen={inspector.open}
                onToggleDevDrawer={inspector.toggle}
              />
              {/* HISTORY IS A PLACE: the recents list takes the whole body, composer included. */}
              {historyOpen ? (
                <RecentChatsView
                  conversations={list.items}
                  isLoading={list.isLoading}
                  hasError={list.isError}
                  activeConversationId={activeConversationId}
                  onSelect={navigation.select}
                  onDelete={(id) => void navigation.remove(id)}
                  onRename={navigation.rename}
                  onBack={() => setHistoryOpen(false)}
                  compact={!floating}
                />
              ) : (
                <>
                  <LangyConversationScroller
                    floating={floating}
                    showWash={flags.showWash}
                    scroll={scroll}
                    scrolledFromTop={scrolledFromTop}
                  >
                    <LangyColumnNotices
                      floating={floating}
                      listError={listError}
                      onRetryList={() => void list.refetch()}
                      isHistoryStale={flags.isHistoryStale}
                      historyRetryIsComing={history.isTurnInFlight}
                      onRetryHistory={history.refetch}
                      recordError={
                        flags.blockingHistoryError ? null : waits.recordErrorPresentation
                      }
                      onRetryRecord={waits.refetchRecord}
                    />
                    <LangyConversationBody
                      floating={floating}
                      state={langyColumnState({
                        showCardGallery,
                        flags,
                        failure,
                        model,
                        onHistoryErrorAction: history.refetch,
                        restoringMessageCount: facts.restoringMessageCount,
                        hasPendingPrompt: !!pendingPrompt,
                        // Before the kickoff message exists: in progress while the tour runs,
                        // settled once it ended and the kickoff only waits to send.
                        tourCard:
                          guidedTourRunning || pendingKickoff
                            ? {
                                kickoff: guidedKickoffPartOf(pendingKickoff?.parts),
                                organizationId: organizationId ?? null,
                              }
                            : null,
                        empty: {
                          panelWidth: placement.floatingPanelWidth,
                          suggestions: emptySuggestions,
                          onPick: (prompt) => void send(prompt),
                        },
                      })}
                      transcript={transcript}
                    />
                    {live && (
                      <LangyFailureSurface
                        floating={floating}
                        failure={failure}
                        organizationId={organizationId}
                        onGithubConnected={onGithubConnected}
                      />
                    )}
                  </LangyConversationScroller>
                  {activity.pinnedPlan && (
                    <LangyPinnedPlan floating={floating} plan={activity.pinnedPlan} />
                  )}
                  <LangyComposerNotice
                    floating={floating}
                    presentation={failure.turnError}
                    onDismiss={engine.clearError}
                  />
                  {view.timeTravel && (
                    <LangyTimeTravelVeil floating={floating} atMs={view.timeTravel.atMs} />
                  )}
                  {/* The composer reads the turn phase straight from the store (ADR-078). */}
                  <LangyComposerSlot inert={!live}>
                    <Composer
                      model={model.modelOverride}
                      modelOptions={model.modelOptions}
                      langyDefaultModel={model.langyDefaultModel}
                      onModelChange={(picked) => {
                        // Switching models is the other way out of a dead codex session.
                        failure.setReconnectCodex(false);
                        pickModel(picked);
                        makeDefault.offer(picked);
                      }}
                      onSend={send}
                      onStop={handleStop}
                      variant={floating ? "floating" : "sidebar"}
                      disabled={!projectId}
                      contextChips={allContextChips}
                      onRemoveChip={removeContextChip}
                      addableChips={addableChips}
                      onAddChip={chooseChip}
                      awaitingAnswer={waits.awaitingAnswer}
                      terminalConnected={waits.terminalConnected}
                    />
                  </LangyComposerSlot>
                </>
              )}
            </IsolatedErrorBoundary>
          </VStack>
        </LangyPanelFrame>
      </LangySendProvider>
    </Profiler>
  );
}

function PanelHeader({
  conversationTitle,
  workspaceChip,
  onNewChat,
  onClose,
  hideClose,
  historyOpen,
  onToggleHistory,
  devMode: _devMode,
  devDrawerOpen,
  onToggleDevDrawer,
}: {
  /** The conversation's GENERATED title, or null while it has none yet. */
  conversationTitle: string | null;
  /** The shared folder chip (ADR-129), which renders nothing while none is. */
  workspaceChip?: ReactNode;
  onNewChat: () => void;
  onClose: () => void;
  /** Hide the Minimise control (drawer companion: the drawer owns the only X). */
  hideClose: boolean;
  /** The recents list has taken over the panel body. */
  historyOpen: boolean;
  onToggleHistory: () => void;
  /** Developer mode is on, so the inspector's control earns its place. */
  devMode: boolean;
  devDrawerOpen: boolean;
  onToggleDevDrawer: () => void;
}) {
  const panelMode = useLangyStore((s) => s.panelMode);
  const setPanelMode = useLangyStore((s) => s.setPanelMode);
  return (
    <>
      {/* One line, a chat app's header not a masthead. Identity leads as a label, not a control,
          truncating so it can never shove the rail off the edge. Minimise sits behind a divider
          so it is unmistakably the last control.
          Spec: platform/app/specs/langy/langy-panel-header.feature */}
      <HStack
        paddingTop="13px"
        paddingBottom="10px"
        paddingLeft="12px"
        paddingRight="10px"
        gap={1}
        flexShrink={0}
      >
        <Box
          flex={1}
          minWidth={0}
          textStyle="sm"
          fontWeight="600"
          letterSpacing="-0.01em"
          lineHeight="1.25"
          color="fg"
          whiteSpace="nowrap"
          overflow="hidden"
          textOverflow="ellipsis"
        >
          {conversationTitle ? <AnimatedConversationTitle title={conversationTitle} /> : "Langy"}
        </Box>

        {workspaceChip}

        <HStack gap={0.5} flexShrink={0}>
          <Tooltip content="New chat" positioning={{ placement: "bottom" }}>
            <IconButton
              size="xs"
              variant="ghost"
              aria-label="New chat"
              color="fg.muted"
              onClick={onNewChat}
            >
              <SquarePen size={15} />
            </IconButton>
          </Tooltip>

          {/* History is a PLACE, not a menu: this swaps the panel body to the
              full-height recents list and back (see RecentChatsView). It stays
              a toggle rather than a one-way trip so the same control that took
              you there brings you back. */}
          <Tooltip
            content={historyOpen ? "Back to chat" : "Recent chats"}
            positioning={{ placement: "bottom" }}
          >
            <IconButton
              size="xs"
              variant="ghost"
              aria-label="Recent chats"
              aria-pressed={historyOpen}
              color={historyOpen ? "orange.fg" : "fg.muted"}
              onClick={onToggleHistory}
            >
              <History size={15} />
            </IconButton>
          </Tooltip>

          {/* One-click layout toggle, present in BOTH modes: floating offers
              "Dock to side", docked offers "Float" (the reverse). The overflow
              menu still lists both explicitly. */}
          {panelMode === "floating" ? (
            <Tooltip content="Dock to side" positioning={{ placement: "bottom" }}>
              <IconButton
                size="xs"
                variant="ghost"
                aria-label="Dock to the side"
                color="fg.muted"
                onClick={() => setPanelMode("sidebar")}
              >
                <PanelRight size={15} />
              </IconButton>
            </Tooltip>
          ) : (
            <Tooltip content="Float" positioning={{ placement: "bottom" }}>
              <IconButton
                size="xs"
                variant="ghost"
                aria-label="Float the panel"
                color="fg.muted"
                onClick={() => setPanelMode("floating")}
              >
                <PictureInPicture2 size={15} />
              </IconButton>
            </Tooltip>
          )}

          <LangyOverflowMenu devDrawerOpen={devDrawerOpen} onToggleDevDrawer={onToggleDevDrawer} />

          {/* Hidden beside a drawer, whose own X is the single close. Says "minimise" since the
              panel stays mounted and just sinks to a header sliver. */}
          {hideClose ? null : (
            <>
              <Box
                width="1px"
                alignSelf="stretch"
                marginY="4px"
                marginX="3px"
                background="border"
              />

              <Tooltip
                content={
                  <HStack gap={2}>
                    <Text>Minimise</Text>
                    <HStack gap={1}>
                      <Kbd>⌘</Kbd>
                      <Kbd>I</Kbd>
                    </HStack>
                  </HStack>
                }
                positioning={{ placement: "bottom" }}
              >
                <IconButton
                  size="xs"
                  variant="ghost"
                  aria-label="Minimise Langy"
                  color="fg.muted"
                  onClick={onClose}
                >
                  <Minus size={15} />
                </IconButton>
              </Tooltip>
            </>
          )}
        </HStack>
      </HStack>
      <Separator />
    </>
  );
}

/**
 * The header's overflow — one `⋯` for everything that is a SETTING rather than an
 * action you take mid-conversation.
 */
function LangyOverflowMenu({
  devDrawerOpen,
  onToggleDevDrawer,
}: {
  devDrawerOpen: boolean;
  onToggleDevDrawer: () => void;
}) {
  const panelMode = useLangyStore((s) => s.panelMode);
  const setPanelMode = useLangyStore((s) => s.setPanelMode);
  const panelEffect = useLangyStore((s) => s.panelEffect);
  const setPanelEffect = useLangyStore((s) => s.setPanelEffect);
  const [devMode, setDevMode] = useLangyDevMode();
  const cardGalleryOpen = useLangyStore((s) => s.cardGalleryOpen);
  const toggleCardGallery = useLangyStore((s) => s.toggleCardGallery);
  const layouts: { mode: LangyPanelMode; label: string; icon: LucideIcon }[] = [
    { mode: "floating", label: "Floating", icon: AppWindow },
    { mode: "sidebar", label: "Sidebar", icon: PanelRight },
  ];
  // Interim design-comparison switch for the panel's look — see LangyWave.
  // Applies to both layouts (the fold's motion driver is shared).
  const effects: {
    effect: LangyPanelEffect;
    label: string;
    icon: LucideIcon;
  }[] = [
    { effect: "fold", label: "Fold", icon: Waves },
    { effect: "plain", label: "Plain", icon: Square },
  ];
  return (
    <Menu.Root positioning={{ placement: "bottom-end" }}>
      {/* TriggerAnchor is load-bearing: Tooltip and Menu.Trigger are both `asChild` and would
          clone their `id` onto the same node, breaking Zag's id-based anchor lookup. The span
          gives each clone its own node, as the recents view's row menus already do. */}
      <Tooltip content="More" positioning={{ placement: "bottom" }}>
        <TriggerAnchor>
          <Menu.Trigger asChild>
            <IconButton size="xs" variant="ghost" aria-label="More Langy options" color="fg.muted">
              <MoreHorizontal size={15} />
            </IconButton>
          </Menu.Trigger>
        </TriggerAnchor>
      </Tooltip>
      <Menu.Content minWidth="200px">
        {layouts.map(({ mode, label, icon: Icon }) => (
          <Menu.Item key={mode} value={mode} onClick={() => setPanelMode(mode)}>
            <HStack gap={2.5} width="full">
              <Icon size={14} />
              <Text textStyle="sm" flex={1}>
                {label}
              </Text>
              {panelMode === mode ? (
                <Box color="orange.fg">
                  <Check size={13} />
                </Box>
              ) : null}
            </HStack>
          </Menu.Item>
        ))}
        <Menu.Separator />
        <Menu.ItemGroup title="Panel effect">
          {effects.map(({ effect, label, icon: Icon }) => (
            <Menu.Item
              key={effect}
              value={`effect-${effect}`}
              onClick={() => setPanelEffect(effect)}
            >
              <HStack gap={2.5} width="full">
                <Icon size={14} />
                <Text textStyle="sm" flex={1}>
                  {label}
                </Text>
                {panelEffect === effect ? (
                  <Box color="orange.fg">
                    <Check size={13} />
                  </Box>
                ) : null}
              </HStack>
            </Menu.Item>
          ))}
        </Menu.ItemGroup>
        <Menu.Separator />
        <LangyNotificationsMenuGroup />
        <Menu.Separator />
        <Menu.Item value="dev-mode" onClick={() => setDevMode(!devMode)}>
          <HStack gap={2.5} width="full">
            <Braces size={14} />
            <Text textStyle="sm" flex={1}>
              Developer mode
            </Text>
            {devMode ? (
              <Box color="orange.fg">
                <Check size={13} />
              </Box>
            ) : null}
          </HStack>
        </Menu.Item>
        {/* The inspector had its own button on the header rail, which spent it
            on a surface only a developer opens — and only while already in
            developer mode. It belongs with the other developer affordances. */}
        {devMode ? (
          <Menu.Item value="inspector" onClick={onToggleDevDrawer}>
            <HStack gap={2.5} width="full">
              <PanelLeftOpen size={14} />
              <Text textStyle="sm" flex={1}>
                Inspector
              </Text>
              {devDrawerOpen ? (
                <Box color="orange.fg">
                  <Check size={13} />
                </Box>
              ) : null}
            </HStack>
          </Menu.Item>
        ) : null}
        {/* Offered only once you are ALREADY in developer mode — the gallery is
            a debugging lens, not a feature, and it has no business appearing in
            a normal user's menu. */}
        {devMode ? (
          <Menu.Item value="card-gallery" onClick={toggleCardGallery}>
            <HStack gap={2.5} width="full">
              <LayoutGrid size={14} />
              <Text textStyle="sm" flex={1}>
                Card gallery
              </Text>
              {cardGalleryOpen ? (
                <Box color="orange.fg">
                  <Check size={13} />
                </Box>
              ) : null}
            </HStack>
          </Menu.Item>
        ) : null}
      </Menu.Content>
    </Menu.Root>
  );
}
