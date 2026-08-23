import {
  Box,
  chakra,
  HStack,
  IconButton,
  Separator,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  LANGY_CHOICE_SELECTION_PART_TYPE,
  type LangyChoiceSelection,
  type LangyDerivedCard,
  type LangyDerivedChoicesCard,
  renderLangyChoiceSelectionText,
} from "@langwatch/langy";
import type { UIMessage } from "ai";
import {
  AppWindow,
  ArrowDown,
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
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  Profiler,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useProjectReach } from "~/components/home/useProjectReach";
import { allModelOptions } from "~/components/ModelSelector";
import { Kbd } from "~/components/ops/shared/Kbd";
import { IsolatedErrorBoundary } from "~/components/ui/IsolatedErrorBoundary";
import { Menu } from "~/components/ui/menu";
import { TriggerAnchor } from "~/components/ui/TriggerAnchor";
import { toaster } from "~/components/ui/toaster";
import { Tooltip } from "~/components/ui/tooltip";
import { showErrorToast } from "~/features/errors";
import { ModelProviderScreen } from "~/features/onboarding/components/sections/ModelProviderScreen";
import { useDrawer } from "~/hooks/useDrawer";
import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useReducedMotion } from "~/hooks/useReducedMotion";
// ONE definition of the wire shape, server-side, imported by both ends, the
// route spreads `langyTurnContextSchema.shape` into its body schema, and this
// types the payload against the same source. If the route stops accepting a
// field, this stops compiling. That is the whole point: the last time these two
// drifted, `safeParse` silently dropped `pageContext` on every single turn and
// nobody found out for weeks.
import type { LangyResourceContext } from "~/server/app-layer/langy/langyTurnContext.schema";
import { api, trpcClient } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";
import { useLangyConversationCommands } from "../data/useLangyConversationCommands";
import { useLangyConversationList } from "../data/useLangyConversationList";
import { useLangyMessages } from "../data/useLangyMessages";
import { useGlobalLangyShortcut } from "../hooks/useGlobalLangyShortcut";
import { useLangyChatEngine } from "../hooks/useLangyChatEngine";
import { useLangyContextDropZone } from "../hooks/useLangyContextDropZone";
import { useLangyDevMode } from "../hooks/useLangyDevMode";
import { useLangyExternalLinkGuard } from "../hooks/useLangyExternalLinkGuard";
import { useLangyFreshness } from "../hooks/useLangyFreshness";
import { useLangyOrbProximity } from "../hooks/useLangyOrbProximity";
import { useLangyPageContext } from "../hooks/useLangyPageContext";
import { useLangyPeekProximity } from "../hooks/useLangyPeekProximity";
import { useLangyStickToBottom } from "../hooks/useLangyStickToBottom";
import {
  turnHadSideEffects,
  useLangyTurnRecovery,
} from "../hooks/useLangyTurnRecovery";
import { useLangyTurnSignals } from "../hooks/useLangyTurnSignals";
import { useLangyWarmWorker } from "../hooks/useLangyWarmWorker";
import { useLingeringDodge } from "../hooks/useLingeringDodge";
import { useScrolledFromTop } from "../hooks/useScrolledFromTop";
import { syncLangyAfterDefaultModelWrite } from "../logic/codingDefaultSync";
import { PANEL_ROOT_ATTR } from "../logic/composerMorphGeometry";
import { shouldRehydrateEngineFromDurable } from "../logic/foreignTurnRehydration";
import { resolveLangyActivityOwnership } from "../logic/langyActivityOwnership";
import {
  createLangyChatTransport,
  type LangyTurnRequestContext,
} from "../logic/langyChatTransport";
import { langyChoicesTimeline } from "../logic/langyChoicesTimeline";
import { mergeContextChips } from "../logic/langyContextChips";
import { catchUpConversationFold } from "../logic/langyDurableCatchUp";
import {
  explainLangyError,
  isStaleLangyHistoryRead,
  readLangyStreamError,
  readLangyTrpcError,
  resolveLiveTurnError,
} from "../logic/langyErrorExplainer";
import {
  PANEL_SUGGESTION_COUNT,
  selectLangySuggestions,
} from "../logic/langyHomeSuggestions";
import {
  type MakeDefaultWritePlan,
  makeDefaultOffer,
} from "../logic/langyMakeDefaultOffer";
import { navigateDedupKey, reserveNavigate } from "../logic/langyNavigateDedup";
import {
  APP_HEADER_HEIGHT,
  FLOATING_PANEL_CSS_WIDTH,
  FLOATING_PANEL_INSET,
  LANGY_DODGE_STAGGER_MS,
  LANGY_TRANSITION,
  langyRestingFloorPx,
  PANEL_LAYOUT_TRANSITION,
  resolveFloatingPanelWidth,
  SIDEBAR_PANEL_WIDTH,
} from "../logic/langyPanelLayout";
import {
  FLOATING_PEEK_NEAR_PX,
  type LangyPeekPhase,
  resolvePeekTranslate,
  SIDEBAR_PEEK_NEAR_PX,
} from "../logic/langyPeekDock";
import { resolveLangyStopTarget } from "../logic/langyStopTarget";
import {
  currentTurnAssistant,
  hasTokens,
  runningTool,
  settledTool,
} from "../logic/langyThinkingLine";
import { buildTimeTravelView } from "../logic/langyTimeTravel";
import { deriveWaveActivity } from "../logic/langyWaveMotion";
import { isInternalHref } from "../logic/spaLink";
import { tapeForConversation, useLangyDevLog } from "../stores/langyDevLog";
import {
  attachedContextToChip,
  type LangyPanelEffect,
  type LangyPanelMode,
  useLangyStore,
} from "../stores/langyStore";
import { executeUiAction } from "../uiActions/executeUiAction";
import type { LangyUiActionHandlers } from "../uiActions/types";
import { AnimatedConversationTitle } from "./AnimatedConversationTitle";
import { Composer } from "./Composer";
import {
  ConversationSkeleton,
  skeletonMessageCount,
} from "./ConversationSkeleton";
import { EmptyState } from "./EmptyState";
import { LangyGitHubConnectCard } from "./github/LangyGitHubConnectCard";
import { LangyCardGallery } from "./LangyCardGallery";
import { LangyContextTargetLayer } from "./LangyContextTargetLayer";
import { LangyDevDrawer } from "./LangyDevDrawer";
import { LangyError } from "./LangyError";
import { LangyExternalLinkDialog } from "./LangyExternalLinkDialog";
import { LangyMakeDefaultDialog } from "./LangyMakeDefaultDialog";
import { LangyMark, LangyMarkGradientDefs } from "./LangyMark";
import { LangyRecoveringLine } from "./LangyRecoveringLine";
import { LangyThinkingLine } from "./LangyThinkingLine";
import { toPendingCapabilities } from "./LangyToolActivity";
import { LangyWave } from "./LangyWave";
import {
  type LangyProposal,
  MessageContent,
  type ProposalHandlers,
} from "./MessageContent";
import { RecentChatsView } from "./RecentChatsView";
import { StreamingStatusLine } from "./StreamingStatusLine";
// Langy's own skin: scoped warm/cream palette + serif display face. The
// `.langy-root` class (below) is where the Chakra semantic-token overrides land.
import "../langyTheme.css";

// The same feature key Langy's chat route resolves against. Used to seed the
// composer's model picker with whatever's actually resolving today — opening
// Langy on a project that already has a configured default model lands on
// THAT model, not on an unrelated branch-primary pick.
const LANGY_GATE_FEATURE_KEY = "langy.chat";

// The floating card's symmetric viewport inset: a rounded card with a small,
// SYMMETRIC inset on every side (a soft brand glow + shadow behind it).
// Shared via langyPanelLayout with the inspector drawer and the minimised
// peek, so none of the three can drift apart by a pixel.
const PANEL_INSET = FLOATING_PANEL_INSET;

// A Chakra Box that also takes framer-motion props — used for the thinking
// line's blur-crossfade when its text changes. `css` still routes through
// emotion (so the shimmer keyframes inject), while motion drives opacity /
// blur / y.
// The "still replying" notice slides up out of the composer (height + fade)
// rather than snapping in — see the composer-notice branch below.
const MotionNotice = motion.create(Box);

// The panel itself. It stays MOUNTED when closed (unmounting would tear down
// useChat's in-flight stream), so open/close is a variant swap, not an
// AnimatePresence mount.
const MotionBox = motion.create(Box);

/**
 * How much of the viewport the floating card may claim once its conversation
 * has earned it.
 *
 * It grows with content between a rising floor and this cap, so the number is a
 * CEILING rather than a size — a short thread still rests short. Raised from
 * 80dvh: at 80 a long answer hit the cap and scrolled internally while an
 * obvious strip of page sat unused above it, which reads as the panel refusing
 * room it was being offered. 90 keeps a sliver of page visible so the card
 * still reads as floating OVER something rather than as a takeover, which is
 * the whole reason there is a cap at all.
 */
const FLOATING_MAX_VIEWPORT_DVH = 90;
/** Breathing room subtracted from the cap so the card never touches the edge. */
const FLOATING_EDGE_GUTTER_PX = 12;
const FLOATING_MAX_HEIGHT = `calc(${FLOATING_MAX_VIEWPORT_DVH}dvh - ${FLOATING_EDGE_GUTTER_PX}px)`;

// Floating grows OUT OF the peek it replaces: scaled down and offset toward
// the bottom-right corner, then springing up to rest — the card feels like it
// rises out of the sliver you just clicked rather than sliding in from
// off-canvas. Sidebar is a dock, so it does the honest thing and slides in
// from the edge — exactly where its own peek sliver rests.
const FLOATING_CLOSED = { opacity: 0, scale: 0.92, x: 10, y: 18 } as const;
const SIDEBAR_CLOSED = {
  opacity: 0,
  scale: 1,
  x: SIDEBAR_PANEL_WIDTH,
  y: 0,
} as const;

// Opening settles with a spring (confident, no overshoot wobble); closing is a
// short ease-in — you don't want to watch a thing you just dismissed.
const OPEN_TRANSITION = {
  type: "spring",
  stiffness: 300,
  damping: 30,
  mass: 0.9,
} as const;
const CLOSE_TRANSITION = { duration: 0.16, ease: [0.4, 0, 1, 1] } as const;

// The conversation scroller's edge masks. Content dissolves at the column's
// edges instead of hard-clipping against the header and composer seams, the
// same mask-fade the thinking line uses for its overflow. A mask (not an
// overlay strip) because the floating card is translucent glass; painting a
// surface-coloured gradient over it would read as a smear on the blur. The
// top edge is a scroll shadow: it exists to say "there is more above", so
// while the conversation sits at the very top it stays fully opaque and the
// first message is never dimmed at rest. The bottom fade is unconditional;
// the composer seam is always there to dissolve into.
const CONVERSATION_EDGE_MASK_SCROLLED =
  "linear-gradient(to bottom, transparent 0, black 28px, black calc(100% - 18px), transparent 100%)";
const CONVERSATION_EDGE_MASK_AT_TOP =
  "linear-gradient(to bottom, black 0, black calc(100% - 18px), transparent 100%)";
// The layout-morph spring now lives in `logic/langyPanelLayout` — the home
// page's composer travels to this panel's floor on the same one, and a shared
// constant is the only thing that keeps the two morphs in one family.

/**
 * The viewport's width, kept current across resizes.
 *
 * Only used to work out how far left the floating card must travel to clear a
 * right-anchored drawer. Seeded to 0 on the server so the first client render
 * matches the markup, then corrected in an effect — reading `window.innerWidth`
 * during render would hydrate-mismatch.
 */
function useViewportWidth(): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const measure = () => setWidth(window.innerWidth);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  return width;
}

function onLangyProfilerRender(
  id: string,
  phase: "mount" | "update" | "nested-update",
  actualDuration: number,
  baseDuration: number,
  startTime: number,
  commitTime: number,
) {
  // Keep the profiler mounted in every build so React DevTools can inspect it,
  // but only log genuinely expensive commits during local investigation.
  if (import.meta.env.DEV && actualDuration >= 16) {
    console.debug("[Langy profiler]", {
      id,
      phase,
      actualDuration: Math.round(actualDuration),
      baseDuration: Math.round(baseDuration),
      startTime: Math.round(startTime),
      commitTime: Math.round(commitTime),
    });
  }
}

/**
 * Carry out one typed UI action the agent asked THIS page for.
 *
 * Every decision (dedup, claim, schema re-parse, handler run, completion)
 * lives in `executeUiAction`; this supplies the live ids and the tRPC legs.
 * A failure is swallowed the way a dropped claim is: the dispatch side has its
 * own timeout and reports to the agent, so a failed claim call must not crash
 * the stream.
 */
function dispatchUiActionToPage({
  entry,
  projectId,
  seen,
  handlers,
}: {
  entry: { actionId: string; kind: string; payload: unknown };
  projectId: string | undefined;
  seen: Set<string>;
  handlers: LangyUiActionHandlers;
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
    handlers,
    claim: ({ actionId }) =>
      trpcClient.langy.claimUiAction.mutate({
        projectId,
        conversationId,
        actionId,
      }),
    complete: ({ actionId, ok, result, errorCode }) =>
      trpcClient.langy.completeUiAction.mutate({
        projectId,
        conversationId,
        actionId,
        ok,
        ...(result !== undefined ? { result } : {}),
        ...(errorCode ? { errorCode } : {}),
      }),
    onHandlerError: ({ kind }) => {
      toaster.create({
        title: "Langy's change didn't apply",
        description: `The page could not carry out ${kind}. Nothing else was affected.`,
        type: "error",
      });
    },
  }).catch(() => undefined);
}

interface LangySidecarProps {
  proposalHandlersRef?: React.RefObject<ProposalHandlers>;
  actionHandlersRef?: React.RefObject<LangyUiActionHandlers>;
}

export function LangySidecar({
  proposalHandlersRef,
  actionHandlersRef,
}: LangySidecarProps) {
  const isOpen = useLangyStore((s) => s.isOpen);
  const toggle = useLangyStore((s) => s.togglePanel);
  const openPanel = useLangyStore((s) => s.openPanel);
  useGlobalLangyShortcut(toggle);
  // The minimised affordance is mid-rollout: flag ON, minimise sinks the
  // panel to a sliver of its own header (see the peek wiring in LangyPanel);
  // flag OFF keeps the
  // classic corner launcher orb. ONE renders at a time — never both — and
  // only the closed state differs: opening, the panel and Cmd/Ctrl+I are
  // identical on either side of the flag.
  const peekDock = useFeatureFlag("release_ui_langy_peek_dock_enabled");

  return (
    <>
      <LangyMarkGradientDefs />
      {/* Flag ON, the panel IS the minimised affordance — it slides down to a
          sliver of its own header rather than handing off to anything else,
          so there is nothing to render here. Flag OFF keeps the classic
          corner launcher orb. Exactly one, never both. */}
      {peekDock.enabled ? null : (
        <LangyLauncher isOpen={isOpen} onOpen={toggle} />
      )}
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
 * The FLAG-OFF closed-state opener — a single circular launcher in the
 * bottom-right corner (the Notion-AI model). Retires in favour of the edge
 * peek — the panel sliding down to its own header sliver
 * (`release_ui_langy_peek_dock_enabled`); until that
 * flag ships, this remains the minimised affordance. Restrained on purpose —
 * the LangWatch mark on a plain surface with a soft neutral shadow, no mesh,
 * no loud colour. Hidden while the panel is open.
 */
function LangyLauncher({
  isOpen,
  onOpen,
}: {
  isOpen: boolean;
  onOpen: () => void;
}) {
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
  // The orb leans + glows toward the cursor as it approaches (the one place a
  // Langy surface reacts to the pointer — a hover affordance on the target
  // itself, not ambient chrome). Disabled under reduced motion. `transform` is
  // driven imperatively from the hook's rAF, so the button's own transition
  // must NOT list transform, or it would double-smooth and lag the deform.
  // `isOpen` must be part of `enabled`: the launcher stays MOUNTED while the
  // panel is open and merely renders null below, and the hook's effect keys on
  // [enabled] alone. Without this the listeners bind once against the orb node,
  // survive the button unmounting when the panel opens (rAF keeps writing
  // styles to a detached element, retaining it), and never rebind afterwards —
  // so the proximity glow is dead for the rest of the session.
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
          boxShadow:
            "0 2px 4px rgba(20,20,23,0.10), 0 12px 32px rgba(20,20,23,0.18)",
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
  const { organization, team, project, hasOrgPermission, hasPermission } =
    useOrganizationTeamProject();
  const projectId = project?.id;
  const organizationId = organization?.id;
  const utils = api.useUtils();
  const router = useRouter();

  // ── Client/UI state (single store) ────────────────────────────────────────
  const isOpen = useLangyStore((s) => s.isOpen);
  const closePanel = useLangyStore((s) => s.closePanel);
  const setDraft = useLangyStore((s) => s.setDraft);
  const modelOverride = useLangyStore((s) => s.modelOverride);
  const setModelOverride = useLangyStore((s) => s.setModelOverride);
  const activeConversationId = useLangyStore((s) => s.activeConversationId);
  const interruptedConversationId = useLangyStore(
    (s) => s.interruptedConversationId,
  );
  const pendingConversationId = useLangyStore((s) => s.pendingConversationId);
  const warmedConversationId = useLangyStore((s) => s.warmedConversationId);
  const historyLoadConversationId = useLangyStore(
    (s) => s.historyLoadConversationId,
  );
  const selectConversation = useLangyStore((s) => s.selectConversation);
  const startNewConversation = useLangyStore((s) => s.startNewConversation);
  const consumeHistoryLoad = useLangyStore((s) => s.consumeHistoryLoad);
  const requestComposerFocus = useLangyStore((s) => s.requestComposerFocus);
  // The command bar's "Ask Langy" hands a question over via the store; the panel
  // opens itself and auto-sends it (see the pendingPrompt effect below).
  const pendingPrompt = useLangyStore((s) => s.pendingPrompt);
  const consumePendingPrompt = useLangyStore((s) => s.consumePendingPrompt);
  const appliedOutcomes = useLangyStore((s) => s.appliedOutcomes);
  const discardedProposalIds = useLangyStore((s) => s.discardedProposalIds);
  const applyingProposalIds = useLangyStore((s) => s.applyingProposalIds);
  const markProposalApplying = useLangyStore((s) => s.markProposalApplying);
  const markProposalApplied = useLangyStore((s) => s.markProposalApplied);
  const clearProposalApplying = useLangyStore((s) => s.clearProposalApplying);
  const discardProposalInStore = useLangyStore((s) => s.discardProposal);
  const dismissChip = useLangyStore((s) => s.dismissChip);
  // Drop a page target onto the panel to hand it over. See
  // `useLangyContextDropZone`; the click path is `useLangyContextTarget`.
  const { isOver: isContextDropOver, dropProps: contextDropProps } =
    useLangyContextDropZone();
  const chooseChip = useLangyStore((s) => s.chooseChip);
  // Context handed to Langy by a surface (home cards, briefing receipts). Shown
  // prominently in the sidebar and forwarded to the agent alongside the derived
  // page chips.
  const attachedContext = useLangyStore((s) => s.attachedContext);
  const detachContext = useLangyStore((s) => s.detachContext);
  const panelMode = useLangyStore((s) => s.panelMode);
  const floating = panelMode === "floating";
  // An app shell (DashboardLayout) is mounted and places the dock as a second
  // content card; zero claims means a full-screen page and the flush dock.
  const dockShellClaimed = useLangyStore((s) => s.dockShellClaims > 0);
  const panelEffect = useLangyStore((s) => s.panelEffect);
  const reduceMotion = useReducedMotion();
  // The panel's own DOM node. The "fold" wave (<LangyWave>) reads its size off
  // it; nothing else needs it.
  const panelRef = useRef<HTMLDivElement>(null);
  // Langy's answers, and the cards built from what its tools returned, are
  // written from data the agent was handed — so a link's words are not a
  // promise about where it goes. One check at the panel root reads the real
  // destination of every link inside it, whatever rendered it.
  // Spec: specs/langy/langy-external-link-guard.feature
  const externalLinkGuard = useLangyExternalLinkGuard();
  const [devMode] = useLangyDevMode();
  const cardGalleryOpen = useLangyStore((s) => s.cardGalleryOpen);
  // The recents list takes over the panel BODY (see RecentChatsView) rather
  // than hanging off the header as a popover. Local state, not the store: the
  // only things that open, close or read it are this component and its own
  // header, and it is deliberately not persisted — reopening Langy should put
  // you back in your conversation, not in a file drawer.
  const [historyOpen, setHistoryOpen] = useState(false);
  // Developer mode's inspector, sliding out of the panel's LEFT edge. Leaving
  // developer mode must close it too — otherwise a stray drawer outlives the
  // mode that justified it (and keeps the wire tape recording).
  const [devDrawerOpen, setDevDrawerOpen] = useState(false);
  useEffect(() => {
    if (!devMode) setDevDrawerOpen(false);
  }, [devMode]);
  const devDrawerVisible = isOpen && devMode && devDrawerOpen;

  // The floating card's REAL height, measured for the inspector: the drawer is
  // a fixed sibling (the panel clips its own overflow), and "match the panel's
  // silhouette exactly" cannot be written in CSS when that silhouette is
  // content-driven. Observed only while the drawer is open, so a normal
  // session never pays for a ResizeObserver.
  const [panelHeightPx, setPanelHeightPx] = useState<number | null>(null);
  useEffect(() => {
    if (!devDrawerVisible) return;
    const node = panelRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const measure = () =>
      setPanelHeightPx(Math.round(node.getBoundingClientRect().height));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [devDrawerVisible]);

  // ── Opening a drawer beside the panel ─────────────────────────────────────
  // Two different moves, one per layout, so docked and floating stay visibly
  // distinct:
  //
  //  - DOCKED (sidebar): the panel becomes the drawer's COMPANION. It morphs
  //    (framer `layout`) to hold the right edge as a floating card wearing the
  //    drawer's chrome; the drawer yields left (see DrawerContent) and slides
  //    in from BEHIND the panel (Langy at a higher z-index). The dock's page
  //    reservation releases while it rides (see LangyShiftedRoot).
  //  - FLOATING: the panel DODGES. It keeps floating but hops to the LEFT so it
  //    is out of the drawer's way; the drawer opens full-width on the right,
  //    exactly as it does with Langy closed. This reads as a window getting
  //    out of the way, which is the whole point of floating.
  //
  // Spec: specs/langy/langy-panel-layout.feature
  const { currentDrawer } = useDrawer();
  const hasDrawer = isOpen && !!currentDrawer;
  const isDrawerCompanion = hasDrawer && !floating;
  // The dodge releases on a delay: the drawer leaves the right edge first,
  // then the panel glides back. Only the FLOATING dodge lingers, the docked
  // companion ride releases with the drawer itself.
  const drawerEdgeHeld = useLingeringDodge({
    active: !!currentDrawer,
    releaseDelayMs: LANGY_DODGE_STAGGER_MS,
    immediate: reduceMotion,
  });
  const floatingDodgesDrawer = isOpen && drawerEdgeHeld && floating;
  const viewportWidth = useViewportWidth();
  const floatingPanelWidth = resolveFloatingPanelWidth(viewportWidth);

  // ── The minimised peek: this panel, slid down to a sliver of itself ───────
  // `peeking` is the whole state. When it is on, the panel is CLOSED but
  // VISIBLE — a sliver of its own header resting at the viewport edge — so it
  // keeps pointer events, drops `aria-hidden`, and makes its own body inert
  // (below) so nothing behind the edge is tabbable. When it is off, closed
  // means what it always meant: invisible, and the launcher orb opens it.
  const peeking = peekEnabled && !isOpen;
  // ...and it gets out of the way while the home's ask field is in use. The
  // field and this panel are two ways to say the same thing, so a peek sitting
  // under the field's results is the page talking over itself.
  //
  // It FADES, and does not move. Standing the peek down by dropping it back to
  // the ordinary closed state made it hop and scale away toward its corner —
  // a departure, animated, for something the reader never asked to dismiss and
  // is about to get back. Holding its position and taking it to zero opacity
  // reads as the page quietly making room.
  const homeAskOpen = useLangyStore((s) => s.homeAskOpen);
  const peekDismissed = peeking && homeAskOpen;
  // The pointer approaching the sliver raises it a little further. One passive
  // rAF-throttled listener with hysteresis; off entirely under reduced motion,
  // where hover/focus alone does the raising.
  const peekNear = useLangyPeekProximity({
    enabled: peeking && !reduceMotion,
    mode: panelMode,
    // A right-anchored drawer owns the bottom-right corner, so the floating
    // panel dodges left — and the proximity zone has to follow it there,
    // on the same lingering release as the panel itself.
    dodgeLeft: drawerEdgeHeld && floating,
  });
  const [peekHovered, setPeekHovered] = useState(false);
  const [peekFocused, setPeekFocused] = useState(false);
  const peekPhase: LangyPeekPhase =
    peekNear || peekHovered || peekFocused ? "near" : "rest";
  // Leaving the peek behind must not strand a stale raise on the next minimise.
  useEffect(() => {
    if (isOpen) {
      setPeekHovered(false);
      setPeekFocused(false);
    }
  }, [isOpen]);
  // The ONE continuous motion. `translate` is its own CSS property, so it
  // composes with the `transform` framer owns (the layout morph, the open
  // variant) rather than fighting it — and it takes calc(), so the sliver is
  // exact without measuring the panel.
  const peekTranslate = peeking
    ? resolvePeekTranslate({ mode: panelMode, phase: peekPhase })
    : "none";
  /**
   * The panel's own body, made INERT while it peeks.
   *
   * Most of the panel is below the viewport edge when minimised, but "off
   * screen" is not "unreachable": without this, Tab walks straight into the
   * composer and the message log of a panel nobody can see, and a screen
   * reader reads a conversation that is not on screen. `inert` takes the whole
   * subtree out of focus order and out of the accessibility tree in one move,
   * leaving exactly one reachable thing — the open control above.
   *
   * Set through a ref rather than a prop so it works whatever this React
   * version does with `inert` (it only became a first-class prop in 19).
   */
  const peekInertRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = peekInertRef.current;
    if (!node) return;
    node.inert = peeking;
  }, [peeking]);

  const variants = useMemo(
    () => ({
      open: { opacity: 1, scale: 1, x: 0, y: 0 },
      // Peeking, the panel stays fully opaque and un-offset: the sliver IS the
      // panel, and its position is the `translate` above. Only the flag-off
      // closed state still fades and hops out of the way.
      peek: { opacity: 1, scale: 1, x: 0, y: 0 },
      // Same position as `peek`, just invisible: the peek standing aside for
      // the home's ask field must not read as the panel leaving.
      peekDismissed: { opacity: 0, scale: 1, x: 0, y: 0 },
      closed: floating ? FLOATING_CLOSED : SIDEBAR_CLOSED,
    }),
    [floating],
  );

  // Entering a project. `resetForProject` either RESTORES the conversation that
  // was open here (a refresh — the store rehydrated it from localStorage, and
  // the user expects to come back to what they left) or clears conversation
  // state (a project switch — the store is a module singleton that survives the
  // per-project remount, so the previous project's conversation is still in it).
  //
  // Keyed on `projectId` rather than mount, because the project arrives async:
  // running this once on mount with no id would compare against `undefined`,
  // fail to match, and wipe the very conversation we are meant to be restoring.
  useEffect(() => {
    if (!projectId) return;
    useLangyStore.getState().resetForProject(projectId);
  }, [projectId]);

  // The turn's request inputs, read at SEND time from a ref the render keeps
  // fresh (populated below, once the chips are resolved). The transport owns
  // these — which is what makes `regenerate()` (no per-send body) carry the
  // projectId + context, killing the old "Try again" 400.
  const turnContextRef = useRef<LangyTurnRequestContext | null>(null);
  // The text of the send in flight, held so a failure can hand it back.
  const lastSentTextRef = useRef<string | null>(null);

  // Navigate instructions already acted on, keyed by turnId+href
  // (`navigateDedupKey`) — `onTurnStream` yields bare entries with no id, so a
  // stream-tail replay after a reconnect could hand the same instruction
  // twice. Reset per turn in `onIds` below, mirroring `githubRedrivenRef`'s
  // "a double-fire must not repeat the effect" shape.
  const navigatedInstructionsRef = useRef<Set<string>>(new Set());

  // UI actions already claimed or dropped on this client, keyed by
  // turnId+actionId (`uiActionDedupKey`) — the same replay problem, and the
  // same per-turn reset, as the navigate dedup above.
  const uiActionSeenRef = useRef<Set<string>>(new Set());

  // The rollback lever for agent-driven page control: with the flag off this
  // page ignores `ui` stream entries, so switching it off during a live turn
  // stops the page changing under the user. Read through a ref because the
  // transport below is memoised once (`[]`), the same reason `routerRef` has
  // one. Only a RESOLVED off closes the channel: an unanswered flag query
  // means "not known yet", and dropping actions there would break the feature
  // for the first turn after every reload.
  const uiActionsFlag = useFeatureFlag("release_langy_ui_actions", {
    projectId,
    organizationId,
  });
  const isUiActionChannelClosedRef = useRef(false);
  isUiActionChannelClosedRef.current =
    !uiActionsFlag.isLoading && !uiActionsFlag.enabled;

  // `router` (from react-router underneath) gets a new identity on every
  // route change; the transport below is memoised once (`[]`), so it reads
  // through a ref the render keeps fresh rather than closing over a router
  // that would go stale after the very first navigation.
  const routerRef = useRef(router);
  routerRef.current = router;

  // The custom transport (memoised once): starts the turn via the
  // `langy.createConversation` / `langy.continueConversation` tRPC mutations,
  // then bridges the `langy.onTurnStream` tRPC subscription into the
  // UIMessageChunk stream useChat consumes. Conversation/turn adoption +
  // status/progress signals are pushed straight into the store (getState), so no
  // ref plumbing.
  const transport = useMemo(
    () =>
      createLangyChatTransport({
        getContext: () => {
          const ctx = turnContextRef.current;
          if (!ctx) throw new Error("Langy turn context not ready");
          return ctx;
        },
        onIds: ({ conversationId, turnId }) => {
          // The turn was dispatched: adopt the conversation + turn and enter the
          // `active` phase (which also clears the previous turn's live signals).
          useLangyStore.getState().beginTurn({ conversationId, turnId });
          // A fresh turn — clear the previous turn's navigate dedup too.
          navigatedInstructionsRef.current = new Set();
          uiActionSeenRef.current = new Set();
        },
        onNavigate: (entry) => {
          // Internal-target guard, mirroring MessageContent's isInternalHref:
          // even though the relay only ever resolves same-app relative hrefs,
          // this is the last line of defence before router.push actually runs.
          if (!isInternalHref(entry.href)) return;

          const turnId = useLangyStore.getState().activeTurnId;
          const key = navigateDedupKey({ turnId, href: entry.href });
          if (!reserveNavigate({ seen: navigatedInstructionsRef.current, key }))
            return;

          // router.push ONLY — never window.location. A same-project SPA
          // route change keeps ProjectLangyLayout (and this panel with it)
          // mounted, so the in-flight response keeps streaming right through
          // the move.
          void routerRef.current.push(entry.href);
        },
        onUiAction: (entry) => {
          if (isUiActionChannelClosedRef.current) return;
          dispatchUiActionToPage({
            entry,
            projectId: turnContextRef.current?.projectId,
            seen: uiActionSeenRef.current,
            handlers: actionHandlersRef?.current ?? {},
          });
        },
        onSignal: (signal) => {
          const store = useLangyStore.getState();
          if (signal.type === "status") {
            if (signal.readiness) store.setTurnReadinessStatus(signal.status);
            else store.setTurnStatus(signal.status);
          } else if (signal.type === "progress") {
            if (signal.message?.trim()) {
              store.setTurnStatus(signal.message);
            }
            if (signal.progress !== undefined) {
              store.setTurnProgress(signal.progress);
            }
            if (
              typeof signal.current === "number" &&
              Number.isFinite(signal.current) &&
              typeof signal.total === "number" &&
              Number.isFinite(signal.total) &&
              signal.current >= 0 &&
              signal.total > 0
            ) {
              store.setTurnProgressSample({
                current: signal.current,
                total: signal.total,
                ...(signal.batchItems !== undefined
                  ? { batchItems: signal.batchItems }
                  : {}),
                ...(signal.batchDurationMs !== undefined
                  ? { batchDurationMs: signal.batchDurationMs }
                  : {}),
                receivedAtMs: Date.now(),
              });
            }
          } else if (signal.type === "reasoning") {
            // Ephemeral thinking — accumulate the run onto the live reasoning so
            // it reads as one flowing block while it streams.
            store.appendTurnReasoning(signal.text);
          } else if (signal.type === "plan") {
            // The manager's typed plan snapshot — the checklist the plan card
            // prefers over parsing the raw todowrite part on the live turn.
            store.setTurnPlan(signal.items);
          }
          // milestone entries carry no numeric rollup and have no consumer yet.
        },
        // Developer mode's tape (see LangyDevDrawer). A no-op unless the
        // inspector is open and has armed recording, so a normal session pays
        // one boolean per entry.
        onWireEntry: (entry, turnId) => {
          useLangyDevLog.getState().record(entry, turnId);
        },
        onTurnSettled: ({ reason }) => {
          // The turn ended: drop the live status line. The streamed message
          // stands as the view; the durable fold is canonical on reload.
          const store = useLangyStore.getState();
          store.resetTurnSignals();
          // A genuine end-of-turn frame means the answer is COMPLETE — retire
          // the durable in-flight flag locally right now, because the fold
          // finalizes asynchronously and a refetch can cache it stale for
          // seconds. A silent close ("closed") or an error keeps the durable
          // truth in charge: the turn may genuinely still be running there.
          if (reason === "end") store.settleTurn(store.activeTurnId);
          // Refetch the durable view NOW. `isTurnInFlight` (which keeps the
          // thinking line mounted) is read from this query, and nothing else
          // ever invalidates it — a mid-turn fetch cached `true` and the line
          // outlived the answer by up to the 30s staleTime. Invalidate (never
          // setData(false)): a silent stream close also lands here while the
          // turn genuinely still runs, and a refetch returns the fold's truth
          // either way. No args on purpose — `utils` is the only referentially
          // stable capture this []-dep memo can rely on.
          void utils.langy.messages.invalidate();
        },
      }),
    [],
  );

  // Seed the picker with the model the gate currently resolves to. Once the
  // user picks something different, we don't overwrite — they're explicitly
  // choosing per-session. Only seed on first valid response.
  const resolvedDefaultQuery = api.modelProvider.getResolvedDefault.useQuery(
    { projectId: projectId ?? "", featureKey: LANGY_GATE_FEATURE_KEY },
    { enabled: !!projectId, staleTime: 300_000, refetchOnWindowFocus: false },
  );

  // No model resolves for Langy's gate key => the chat route will 409 ("no
  // model configured"). Surface an inline setup instead of letting the user
  // type into a dead composer.
  // Gate on SUCCESS, not on "no longer loading". An errored query also reports
  // isLoading === false with data === undefined, so testing !isLoading made a
  // transient failure of the gate lookup indistinguishable from "this project
  // has no model configured" — and the branch below replaces the whole
  // conversation with the provider-onboarding grid. With staleTime 300s, no
  // refetchInterval and refetchOnWindowFocus off, nothing would refetch it, so
  // the user's open transcript stayed hidden until a full reload.
  const langyNeedsModel =
    !!projectId &&
    resolvedDefaultQuery.isSuccess &&
    !resolvedDefaultQuery.data?.model;

  // The project's Langy VK carries an optional `modelsAllowed` allowlist. When
  // set, the composer's picker is narrowed to exactly those models; when
  // null/empty it falls back to all of the project's provider models. Served
  // as its own field — the VK itself is product-managed and no longer reaches
  // the client.
  const modelsAllowedQuery = api.langy.modelsAllowed.useQuery(
    { projectId: projectId ?? "" },
    {
      enabled: !!projectId,
      staleTime: 300_000,
      refetchOnWindowFocus: false,
    },
  );
  const langyModelsAllowed = modelsAllowedQuery.data?.modelsAllowed ?? null;

  const modelOptions = useMemo(
    () => langyModelsAllowed ?? allModelOptions,
    [langyModelsAllowed],
  );
  const langyDefaultModel = modelOptions.includes(
    resolvedDefaultQuery.data?.model ?? "",
  )
    ? resolvedDefaultQuery.data?.model
    : null;

  // Seed the picker with the model the gate resolves to — but keep it inside
  // the allowlist. If the resolved default isn't allowed, start on the first
  // allowed model instead.
  useEffect(() => {
    if (modelOverride) return;
    const resolved = resolvedDefaultQuery.data?.model;
    if (
      resolved &&
      (!langyModelsAllowed || langyModelsAllowed.includes(resolved))
    ) {
      setModelOverride(resolved);
    } else if (langyModelsAllowed) {
      setModelOverride(langyModelsAllowed[0]!);
    }
  }, [
    resolvedDefaultQuery.data?.model,
    modelOverride,
    langyModelsAllowed,
    setModelOverride,
  ]);

  // Race fix: if the allowlist lands AFTER we seeded an out-of-list model, snap
  // to the first allowed model.
  useEffect(() => {
    if (!langyModelsAllowed) return;
    if (modelOverride && !langyModelsAllowed.includes(modelOverride)) {
      setModelOverride(langyModelsAllowed[0]!);
    }
  }, [langyModelsAllowed, modelOverride, setModelOverride]);

  // ── "Make it the default?" — the ask that follows a model pick ──────────
  // The pick took effect for this conversation the moment it happened; the
  // dialog only offers to write it as the default at the scope the current
  // default lives at, and only to someone who can manage that scope (see
  // logic/langyMakeDefaultOffer).
  const setRoleAssignment =
    api.modelProvider.setRoleAssignmentForScope.useMutation();
  const setFeatureOverride =
    api.modelProvider.setFeatureOverrideForScope.useMutation();
  const [makeDefaultPlan, setMakeDefaultPlan] =
    useState<MakeDefaultWritePlan | null>(null);
  // Declines are per model per panel session: refusing once must not nag on
  // the next pick of the same model, and must not mute the ask forever.
  const makeDefaultDeclinedRef = useRef<Set<string>>(new Set());

  const offerMakeDefault = (picked: string) => {
    if (makeDefaultDeclinedRef.current.has(picked)) return;
    const plan = makeDefaultOffer({
      picked,
      resolvedDefault: resolvedDefaultQuery.data ?? null,
      canManage: {
        organization: hasOrgPermission("organization:manage"),
        team: hasPermission("team:manage"),
        project: hasPermission("project:update"),
      },
      scopeIds: {
        organizationId: organizationId ?? null,
        teamId: team?.id ?? null,
        projectId: projectId ?? null,
      },
    });
    if (plan) setMakeDefaultPlan(plan);
  };

  const confirmMakeDefault = () => {
    if (!makeDefaultPlan || !projectId) return;
    const plan = makeDefaultPlan;
    // The dialog closes the moment the question is answered; the write runs
    // behind it. Holding it open on a spinner made a yes/no feel like a form
    // submit, and the pick is already live for this conversation either way —
    // only a genuine write failure has anything to say, and it says it as a
    // toast.
    setMakeDefaultPlan(null);
    // The dialog took the cursor for one question about the model. Answering
    // it gives the cursor back to the message being written.
    requestComposerFocus();
    void (async () => {
      try {
        // The write mirrors what it replaces: a feature-level default moves via
        // the feature override, a role-level one via the LANGY role.
        if (plan.kind === "feature-override") {
          await setFeatureOverride.mutateAsync({
            scopeType: plan.scopeType,
            scopeId: plan.scopeId,
            featureKey: LANGY_GATE_FEATURE_KEY,
            model: plan.model,
          });
        } else {
          await setRoleAssignment.mutateAsync({
            scopeType: plan.scopeType,
            scopeId: plan.scopeId,
            role: "LANGY",
            model: plan.model,
          });
        }
        await syncLangyAfterDefaultModelWrite({
          utils,
          projectId,
          fallbackModel: plan.model,
        });
        toaster.create({
          title: "Langy default updated",
          type: "success",
          duration: 2500,
        });
      } catch (error) {
        showErrorToast({
          error,
          fallbackTitle: "Couldn't update the Langy default",
        });
      }
    })();
  };

  const declineMakeDefault = () => {
    if (makeDefaultPlan) {
      makeDefaultDeclinedRef.current.add(makeDefaultPlan.model);
    }
    setMakeDefaultPlan(null);
    requestComposerFocus();
  };

  const {
    messages,
    sendMessage,
    stop,
    status,
    error,
    regenerate,
    applyHistoryToEngine,
    resetEngine,
    clearError,
  } = useLangyChatEngine({ transport });

  // Pre-warm the worker on panel open and on conversation change, so the first
  // message finds it booted (specs/langy/langy-worker-prewarm.feature). The
  // model is passed only after both model queries settle, the picker's value
  // is what the turn will carry, and warming before the allowlist could snap
  // it away would boot a worker the turn cannot reuse. Held while a turn is
  // streaming: the worker is provably alive then, and a warm racing the turn
  // (a mid-stream model switch re-arms one) has nothing to add. Fire-and-
  // forget: the hook surfaces nothing.
  const modelQueriesSettled =
    !resolvedDefaultQuery.isLoading && !modelsAllowedQuery.isLoading;
  useLangyWarmWorker({
    projectId,
    isOpen,
    conversationId: activeConversationId,
    pendingConversationId,
    turnInFlight: status === "submitted" || status === "streaming",
    model: modelQueriesSettled
      ? modelOverride || langyDefaultModel || null
      : null,
  });

  // ── Server state (React Query, via the langy tRPC router) ─────────────────
  const {
    items: conversations,
    isLoading: isLoadingConversations,
    isError: hasListError,
    error: listError,
    refetch: refetchConversations,
  } = useLangyConversationList();
  // `fork` is deliberately not destructured: the mutation still exists on the
  // server, but the panel offers no way to branch a conversation (see the
  // recents list's row actions).
  const { remove: removeConversation, rename: renameConversation } =
    useLangyConversationCommands();
  const {
    messages: historyMessages,
    lastError: historyLastError,
    isTurnInFlight: isFoldTurnInFlight,
    inFlightTurnId: foldInFlightTurnId,
    shouldAskFeedback,
    isLoading: isLoadingHistory,
    isFetching: isFetchingHistory,
    isError: hasHistoryError,
    error: historyError,
    refetch: refetchHistory,
    eventCursor: snapshotEventCursor,
    currentTurnId: snapshotCurrentTurnId,
    lastModel: conversationLastModel,
  } = useLangyMessages(activeConversationId);

  // A conversation keeps the model it was last used with: when its history
  // lands, the picker follows the model of its latest turn — unless the user
  // already picked one since opening it, and never a model the allowlist
  // refuses (the snap effect above owns that rule).
  useEffect(() => {
    if (!activeConversationId || !conversationLastModel) return;
    if (
      langyModelsAllowed &&
      !langyModelsAllowed.includes(conversationLastModel)
    ) {
      return;
    }
    useLangyStore.getState().followConversationModel({
      conversationId: activeConversationId,
      model: conversationLastModel,
      resolvedDefault: resolvedDefaultQuery.data?.model ?? null,
    });
  }, [
    activeConversationId,
    conversationLastModel,
    langyModelsAllowed,
    resolvedDefaultQuery.data?.model,
  ]);

  /**
   * The conversation's own history failed to load.
   *
   * Ignoring this was a second silent hole: the hook has always exposed
   * `isError` and the panel simply never read it, so a `clickhouse_unavailable`
   * (Langy's messages live in ClickHouse) logged a TRPCClientError to the
   * console and rendered nothing at all. Same rule as everywhere else — a
   * failure may never be quieter than a success.
   */
  // A freshly-minted conversation may not be readable yet (see the store's
  // `unconfirmedConversations`): the create command is accepted before the
  // projection lands, and in that window the history read answers not-found.
  const isActiveConversationUnconfirmed = useLangyStore((s) =>
    s.activeConversationId
      ? s.unconfirmedConversations[s.activeConversationId] === true
      : false,
  );
  const suppressedNotFoundRef = useRef(false);

  const historyErrorPresentation = useMemo(() => {
    if (!hasHistoryError) return null;
    const domain = readLangyTrpcError(historyError);
    // Not-found for a conversation THIS tab just minted is the projection
    // lagging the accepted create — "not yet", never an error. The card would
    // claim a conversation doesn't exist moments before its turn is accepted;
    // render nothing and let the confirmation drive the refetch below.
    if (
      domain?.code === "langy_conversation_not_found" &&
      isActiveConversationUnconfirmed
    ) {
      suppressedNotFoundRef.current = true;
      return null;
    }
    if (domain) return explainLangyError(domain);
    return {
      kind: "langy_history_unavailable",
      title: "This conversation isn't loading",
      description:
        "Its messages can't be reached right now. You can still start a new chat.",
      render: "card" as const,
      action: { label: "Try again", kind: "retry" as const },
    };
  }, [hasHistoryError, historyError, isActiveConversationUnconfirmed]);

  // Confirmation arrived (a signal named the conversation, or a read
  // succeeded) while the history query still holds the suppressed not-found —
  // refetch so the real history replaces the stale error. The ref keeps this
  // from firing for genuine not-founds, which were never suppressed.
  useEffect(() => {
    if (!isActiveConversationUnconfirmed && suppressedNotFoundRef.current) {
      suppressedNotFoundRef.current = false;
      refetchHistory();
    }
  }, [isActiveConversationUnconfirmed, refetchHistory]);

  // The turn phase — the SINGLE, event-driven source of "is a turn in flight"
  // (ADR-078). It lives in the store as a machine (idle → active → stopping →
  // idle); here we only FEED it the durable fold signal so it reflects turns
  // this tab did not start (another tab, a resume after refresh) and settles
  // once the fold that CONFIRMED the turn goes idle. The old per-render
  // serverTurnInFlight / settled-marker / isStopping booleans are gone.
  const turnPhase = useLangyStore((s) => s.turnPhase);
  const turnActive = turnPhase !== "idle";
  useEffect(() => {
    useLangyStore.getState().observeBackendTurn(isFoldTurnInFlight);
  }, [isFoldTurnInFlight]);

  // A user Stop is a REAL backend stop (ADR-078): the durable stopped terminal is
  // the confirmation. `requestStop()` moves the phase to `stopping` (the Composer
  // shows the spinner) and it clears to `idle` only when the fold that saw the
  // turn goes idle — never on isBusy, which the client abort flips instantly,
  // long before the backend has actually stopped.
  const stopTurn = api.langy.stopTurn.useMutation();

  const handleStop = useCallback(() => {
    // WHICH turn to stop is resolved first, and everything else hangs off it:
    // this tab's own live turn if it has one, otherwise the turn the durable
    // record names (`inFlightTurnId`) — which is the only way a tab that did not
    // start the turn, or that rejoined it after a refresh, can stop it at all.
    // Read the live ids at click time from the store to dodge a stale closure.
    const store = useLangyStore.getState();
    const target = resolveLangyStopTarget({
      projectId,
      conversationId: store.activeConversationId,
      localTurnId: store.activeTurnId,
      localSettledTurnId: store.settledTurnId,
      durableTurnId: foldInFlightTurnId,
    });

    // Tape the ask itself, dispatched or not — the inspector's outbound lane
    // shows what this client TRIED, and a refused stop is exactly the kind of
    // moment it exists for.
    const targetTurnId =
      target.kind === "dispatch" ? target.turnId : store.activeTurnId;
    useLangyDevLog
      .getState()
      .recordOutbound("stop", `stop turn ${targetTurnId ?? "?"}`, {
        conversationId: store.activeConversationId,
        turnId: targetTurnId,
        resolution: target.kind === "dispatch" ? "dispatch" : target.reason,
      });

    if (target.kind !== "dispatch") {
      // Nothing to dispatch — so nothing may claim to be stopping. The old code
      // moved the phase to `stopping` BEFORE this check, which is exactly how
      // Stop became a lie: a disabled spinner, no request, an agent still
      // burning tokens. Say the true thing instead and leave Stop clickable.
      toaster.create({
        title: "Langy",
        description:
          target.reason === "no-conversation"
            ? "There's no answer in progress to stop."
            : "This answer is still starting up — try stopping it again in a moment.",
        type: "info",
        duration: 5000,
      });
      return;
    }

    // Only now: abort this browser's own subscription (snappy), enter the
    // stopping phase, and stop the turn on the backend for real.
    void stop();
    store.requestStop();
    void stopTurn
      .mutateAsync({
        projectId: target.projectId,
        conversationId: target.conversationId,
        turnId: target.turnId,
      })
      .catch(() => {
        // The request did not land, so the promise the spinner makes is not one
        // we can keep: hand the control back. If the turn really did end (a stop
        // a beat too late), the fold settles it to idle on its next read.
        useLangyStore.getState().abandonStop();
      });
  }, [stop, projectId, stopTurn, foldInFlightTurnId]);

  // Seed the LOCAL turn projection from the snapshot (ADR-059): its cursor is
  // where the durable-tail fold starts, and an in-flight turn id is what a
  // refreshed tab adopts (making Stop + live signals work again).
  //
  // A fold that is already seeded is never jump-seeded again: a fresher
  // polled cursor instead drives the SAME durable catch-up the freshness
  // signal does — fetch the tail, fold the events. Jump-seeding skipped the
  // events between the two cursors and reset the turn document, which is why
  // a tab whose SSE connection died froze mid-turn while the turn kept
  // running: the poll kept delivering fresher cursors and the seed kept
  // discarding the work they pointed at. With the poll as a second catch-up
  // driver, a dead live stream is a latency problem, not a frozen panel.
  useEffect(() => {
    if (!activeConversationId) return;
    const store = useLangyStore.getState();
    if (store.turnProjection.cursor === null) {
      store.seedTurnProjection({
        cursor: snapshotEventCursor,
        currentTurnId: snapshotCurrentTurnId,
      });
    } else if (projectId && snapshotEventCursor) {
      catchUpConversationFold({
        utils,
        projectId,
        conversationId: activeConversationId,
        targetCursor: snapshotEventCursor,
      }).catch(() => {
        // A failed catch-up is retried by the next poll or signal; the fold
        // never moved, so there is nothing to repair.
      });
    }
    useLangyDevLog.getState().recordSnapshot({
      conversationId: activeConversationId,
      cursor: snapshotEventCursor,
      currentTurnId: snapshotCurrentTurnId,
    });
  }, [
    activeConversationId,
    projectId,
    utils,
    snapshotEventCursor?.acceptedAt,
    snapshotEventCursor?.eventId,
    snapshotCurrentTurnId,
  ]);

  // Push a settled server history into the chat engine. Gated on a USER
  // selection (`historyLoadConversationId`) so a background refetch — or the
  // server's projection of a conversation we just created — never clobbers the
  // live in-flight stream. `keepPreviousData` means the query can briefly hold
  // the prior conversation's rows, so we wait for the fetch to settle.
  useEffect(() => {
    if (!historyLoadConversationId) return;
    if (historyLoadConversationId !== activeConversationId) return;
    if (isFetchingHistory) return;
    applyHistoryToEngine(historyMessages);
    consumeHistoryLoad();
  }, [
    historyLoadConversationId,
    activeConversationId,
    isFetchingHistory,
    historyMessages,
    applyHistoryToEngine,
    consumeHistoryLoad,
  ]);

  // When the active conversation clears (New chat / delete-active / fresh
  // project), empty the engine. Fires only on the transition to null, so a
  // first send (still null until the server adopts an id) is never wiped.
  useEffect(() => {
    if (activeConversationId === null) {
      applyHistoryToEngine([]);
    }
  }, [activeConversationId, applyHistoryToEngine]);

  const isBusy = status === "submitted" || status === "streaming";

  // Foreign-turn re-hydration. A turn this client did NOT drive (another tab, a
  // recovered/again-driven turn, a programmatic caller) grows the open
  // conversation's durable history; `useLangyFreshness` invalidates the
  // `langy.messages` query on the id-only signal. Reflect that growth in the
  // engine so the open thread updates without a manual refresh — the engine is
  // what renders, and the user-selection gate above only re-hydrates on an
  // explicit open. Four guards keep it from clobbering the live path:
  //   - a pending user selection owns the engine — let that effect apply it;
  //   - a live self-driven turn (submitted/streaming) owns the engine;
  //   - a refetch in flight (isFetchingHistory) — wait for it to settle;
  //   - apply ONLY when durable is AHEAD of the engine, never shrinking it, so a
  //     momentarily-stale refetch at a turn's settle boundary can't flash the
  //     pre-answer history.
  useEffect(() => {
    const durableCount = historyMessages.filter(
      (m) => m.role === "user" || m.role === "assistant",
    ).length;
    if (
      !shouldRehydrateEngineFromDurable({
        isHistoryLoadPending: historyLoadConversationId !== null,
        isStreaming: isBusy,
        isFetchingHistory,
        hasActiveConversation: activeConversationId !== null,
        durableMessageCount: durableCount,
        engineMessageCount: messages.length,
      })
    ) {
      return;
    }
    applyHistoryToEngine(historyMessages);
  }, [
    historyLoadConversationId,
    isBusy,
    isFetchingHistory,
    activeConversationId,
    historyMessages,
    messages.length,
    applyHistoryToEngine,
  ]);

  // A failed recents list surfaces INSIDE the panel as a dismissable Langy
  // domain-error card — never a toast: the panel is open (a closed panel
  // doesn't even run the query — see useLangyConversationListQuery), so the
  // panel owns its own failure. Dismissal holds until the list recovers, so
  // the card can't nag again for the same outage.
  const [listErrorDismissed, setListErrorDismissed] = useState(false);
  useEffect(() => {
    if (!hasListError) setListErrorDismissed(false);
  }, [hasListError]);
  const listErrorPresentation = useMemo(() => {
    if (!hasListError || listErrorDismissed) return null;
    const domain = readLangyTrpcError(listError);
    if (domain) return explainLangyError(domain);
    return {
      kind: "langy_conversations_unavailable",
      title: "Recent conversations aren't loading",
      description:
        "Chatting still works — your past conversations will be back once they can be reached again.",
      render: "card" as const,
      action: { label: "Try again", kind: "retry" as const },
    };
  }, [hasListError, listErrorDismissed, listError]);

  // Real-time coordinator: one SSE subscription for the whole panel. Applies
  // the pushed operational spine in place (or invalidates) so the recents list
  // and the open conversation's status stay fresh without heavy polling.
  useLangyFreshness(activeConversationId);

  const isEmpty = messages.length === 0;

  /**
   * The history read failed but the transcript is still HERE — a stale read,
   * not a lost conversation.
   *
   * `langy.messages` polls every 3s for the whole of a turn, and react-query
   * keeps the last good `data` when a background refetch fails: only `status`
   * flips to error. So one API blip mid-turn used to replace the entire message
   * column with "This conversation isn't loading" while tokens were still
   * streaming into messages sitting right there. A failure may never be quieter
   * than a success, but it may not shout over an answer either — say the quiet
   * thing at the head of the column and let the poll's next tick clear it.
   *
   * A turn in flight counts as content of its own: between send and a terminal
   * state the column owes the reader a working line, never a card claiming the
   * conversation is gone.
   *
   * WHICH failure arrived decides this as much as whether anything is on screen.
   * A conversation deleted in another tab answers `langy_conversation_not_found`
   * on every poll from then on, and the engine still holds its messages — so
   * "there is content, stay quiet" left the reader with a transcript that no
   * longer exists, no retry and no next step, permanently. Terminal kinds keep
   * the column (see `isStaleLangyHistoryRead`).
   */
  const isHistoryStale = isStaleLangyHistoryRead({
    presentation: historyErrorPresentation,
    hasContentOnScreen: !isEmpty || isBusy || turnActive,
  });
  /** The failure that really does own the column: nothing else can be shown. */
  const blockingHistoryError = isHistoryStale ? null : historyErrorPresentation;

  /**
   * Is another read already on its way, or is the quiet line the end of the road?
   *
   * The stale line's whole premise is "the next tick will clear this" — but
   * `langy.messages` only re-reads on an interval while the fold says a turn is
   * in flight (see `langyMessagesPollInterval`), which is the same flag this
   * reads. A settled conversation therefore has NOTHING coming: the reader is
   * left looking at a passive notice that nothing will ever refresh. So when
   * there is no tick to wait for, the line carries the retry instead.
   */
  const historyRetryIsComing = isFoldTurnInFlight;

  // RESTORING, not starting fresh. The panel remembered which conversation was
  // open, so the moment it mounts it already knows there is one — before the
  // history read lands. Without this the empty state's invitation painted over
  // a conversation the reader had already had and was swapped out a beat
  // later, which reads as Langy having forgotten them.
  //
  // A queued prompt or an in-flight turn is content of its own, and a
  // conversation whose projection has not landed yet (`unconfirmed`) is one
  // this tab JUST created — a new chat, so the invitation is right for it.
  const isRestoringConversation =
    !!activeConversationId &&
    isEmpty &&
    !pendingPrompt &&
    !isBusy &&
    isLoadingHistory &&
    !isActiveConversationUnconfirmed;

  // How big that conversation is going to be. The recents list already carries
  // every conversation's message count, so this is a known quantity rather
  // than a guess — the placeholder holds about the right amount of column and
  // the card opens at the size the content will need. Null while the list
  // itself is still loading; the skeleton then falls back to its own default.
  const restoringMessageCount = useMemo(() => {
    if (!isRestoringConversation) return null;
    const restored = conversations.find((c) => c.id === activeConversationId);
    return restored?.messageCount ?? null;
  }, [isRestoringConversation, conversations, activeConversationId]);

  // The empty state's asks, picked from the project's reach — the same
  // selection the home page runs (see logic/langyHomeSuggestions.ts), so a
  // project with no traces is offered ways to get set up rather than four
  // asks that can only dead-end. Empty until the reach is known: an ask that
  // appears and is then withdrawn is worse than a beat of nothing.
  const projectReach = useProjectReach();
  const emptySuggestions = useMemo(
    () =>
      projectReach.isLoading
        ? []
        : selectLangySuggestions({
            reach: {
              hasTraces: projectReach.hasTraces,
              hasEvaluations: projectReach.hasEvaluations,
              hasExperiments: projectReach.hasExperiments,
            },
            count: PANEL_SUGGESTION_COUNT,
          }),
    [
      projectReach.isLoading,
      projectReach.hasTraces,
      projectReach.hasEvaluations,
      projectReach.hasExperiments,
    ],
  );
  // The floating card's resting floor. While a turn is in flight we never fall
  // back to the empty floor, so sending from an empty thread steps UP
  // (340 → 410 → 520) instead of dropping to the minimised floor first and
  // bouncing back as the answer arrives.
  // A queued question is content, so the card must not drop to its empty floor
  // underneath one and bounce back up the instant the turn starts.
  // A conversation that is merely still loading is NOT an empty one: resting on
  // the empty floor underneath its placeholder only to step up as the messages
  // land is the same bounce this floor exists to prevent.
  const emptyAndSettled =
    isEmpty && !isBusy && !pendingPrompt && !isRestoringConversation;
  // What the card has to hold: the messages it has, or — while restoring — the
  // count the recents list says are coming.
  const expectedMessageCount = restoringMessageCount ?? messages.length;
  const restingFloorPx = langyRestingFloorPx({
    emptyAndSettled,
    expectedMessageCount,
  });
  // High-water mark: within a single conversation the floor only ever RISES, so
  // a mid-thread send can't collapse the card down and back up as the view
  // momentarily clears and refills — the jarring full → minimised → half
  // bounce. It resets only once the thread is genuinely empty and idle (a fresh
  // or closed panel). Paired with the min-height CSS transition below, every
  // resulting size change eases instead of snapping.
  const floatingFloorHwmRef = useRef(restingFloorPx);
  if (emptyAndSettled) {
    floatingFloorHwmRef.current = restingFloorPx;
  } else if (restingFloorPx > floatingFloorHwmRef.current) {
    floatingFloorHwmRef.current = restingFloorPx;
  }
  const floatingMinHeight = `min(${floatingFloorHwmRef.current}px, ${FLOATING_MAX_HEIGHT})`;

  // The ambient wash earns its place on the home screen (nothing else is on the
  // surface) and while Langy is working (a slow drift reads as alive). "Working"
  // is the LIVE stream OR the durable running-turn signal, so the wash stays lit
  // through a silent-worker gap just like the thinking line does — a settled
  // conversation is just a document, no wash under the text.
  // A conversation still loading is a document arriving, not an empty surface:
  // lighting the wash under the placeholder only to drop it as the messages
  // land is one more thing changing on open.
  const showWash =
    (isEmpty && !isRestoringConversation) || isBusy || turnActive;

  // The developer-mode card gallery takes over the message column entirely —
  // it is a lens onto the card kit, not something to interleave with a real
  // conversation. Guarded on devMode as well as the flag so it can never
  // survive a dev-mode toggle-off (the store clears it too; belt and braces).
  const showCardGallery = devMode && cardGalleryOpen;

  // Follow-the-stream scrolling, driven by a ResizeObserver on the content
  // rather than a dep list — Stream B's optimistic tokens and the turn signals
  // never pass through `messages`, so the old `[messages, status]` effect never
  // fired for them and the answer streamed off the bottom of the panel.
  // Disabled while the column is a top-down DOCUMENT (the inline model setup,
  // the card gallery): auto-follow there scrolled the heading straight out of
  // view as the form mounted.
  const { scrollRef, contentRef, endRef, isPinned, canScroll, jumpToLatest } =
    useLangyStickToBottom({
      enabled: !langyNeedsModel && !showCardGallery && !historyOpen,
    });

  // Drives the scroller's top mask (see CONVERSATION_EDGE_MASK_*): the fade
  // may only dim content actually scrolled off above, never the first
  // message at rest.
  const isConversationScrolledFromTop = useScrolledFromTop(scrollRef);

  // The setup verdict arrives ASYNC (the resolved-default query): between the
  // panel opening and `langyNeedsModel` flipping true, auto-follow is still
  // armed and the mounting grid can drag the column to the bottom. Snap back
  // to the top the moment the column becomes a document, so the heading is
  // where reading starts.
  useEffect(() => {
    if (langyNeedsModel && scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [langyNeedsModel, scrollRef]);

  // Page context (task #14): the experiment / trace / dataset / project the
  // user is viewing, surfaced as removable composer chips and forwarded with
  // the turn.
  const { chips: contextChips, addableChips } = useLangyPageContext();

  // Surface-attached context, adapted to the chip shape and merged with the
  // derived chips — deduped by id, so an attached trace and its route-derived
  // twin collapse into one. This one list feeds BOTH the wire payload and the
  // sidebar display, so what the user sees is exactly what the agent receives.
  const attachedChips = useMemo(
    () => attachedContext.map(attachedContextToChip),
    [attachedContext],
  );
  const allContextChips = useMemo(
    () => mergeContextChips([...contextChips, ...attachedChips]),
    [contextChips, attachedChips],
  );

  // The composer is the ONE remove affordance for context (the dock's old
  // banner restated these chips and is gone). A chip can be page-derived,
  // explicitly attached, or both (deduped above), clear every source it has,
  // or it reappears from the other one.
  const removeContextChip = useCallback(
    (id: string) => {
      if (useLangyStore.getState().attachedContext.some((c) => c.id === id)) {
        detachContext(id);
      }
      dismissChip(id);
    },
    [detachContext, dismissChip],
  );

  // Keep the transport's request context fresh every render; it is read at send
  // time (including on regenerate, which carries no per-send body). This is the
  // ONE definition of the turn's wire shape, mirroring the chat route's body.
  turnContextRef.current = {
    projectId: projectId ?? "",
    conversationId: activeConversationId,
    // The id a panel-open warm minted, for the create path to adopt so the
    // first turn reuses the worker the warm already booted.
    pendingConversationId,
    ...(modelOverride ? { modelOverride } : {}),
    ...(allContextChips.length > 0
      ? {
          pageContext: allContextChips.map(
            (chip): LangyResourceContext => ({
              kind: chip.kind,
              ref: chip.ref,
              label: chip.label,
            }),
          ),
        }
      : {}),
  };

  // The transport needs current context and recovery state, but the composer
  // must not receive a new callback on every streamed token. Keep its public
  // callback stable and refresh only the implementation it delegates to.
  const sendImplementationRef = useRef<(text: string) => Promise<void>>(
    async () => undefined,
  );
  const send = useCallback(
    (text: string) => sendImplementationRef.current(text),
    [],
  );
  sendImplementationRef.current = async (text: string) => {
    if (!text.trim() || !projectId || isBusy) return;
    // `/feedback` is a client command, not a message: it summons the rating
    // card under the latest answer (bypassing the backend cadence — the user
    // asking to rate is never nagging) and sends nothing to Langy. This
    // closure is reassigned every render and only runs after it, so reading
    // `latestAssistantMessage` (declared below) is safe — one derivation, not
    // two.
    if (text.trim().toLowerCase() === "/feedback") {
      setDraft("");
      if (latestAssistantMessage) {
        useLangyStore.getState().pinFeedback(latestAssistantMessage.id);
      }
      return;
    }
    // A new question opens a new recovery chain: the policy's attempt budget is
    // per-question, so the previous turn's spent attempts don't eat this one's.
    recovery.reset();
    // Consume the submitted draft immediately. The composer stays available
    // for a follow-up message while this turn runs; leaving the sent text in
    // the field makes it look unsent and causes an awkward visual jump once
    // the first assistant token arrives.
    setDraft("");
    // Remember what we consumed. `sendMessage` does NOT reliably reject — it
    // routes failures to useChat's `error` channel — so the catch below can
    // never be the only thing that gives the text back. The effect watching
    // `error` restores from here (see restoreDraftOnFailure).
    lastSentTextRef.current = text;
    try {
      // No per-send body: the custom transport sources projectId + conversation
      // + model + page-context + skills from `turnContextRef` (getContext) at
      // send time, so both a fresh send AND regenerate() carry the full context.
      useLangyDevLog
        .getState()
        .recordOutbound(
          "send",
          text.length > 60 ? `${text.slice(0, 60)}…` : text,
          {
            text,
            conversationId: useLangyStore.getState().activeConversationId,
          },
        );
      await sendMessage({ role: "user", parts: [{ type: "text", text }] });
    } catch {
      // Belt to the effect's braces, for the paths that DO reject.
      restoreDraftOnFailure();
    }
  };

  /**
   * Give the user their words back when a send fails.
   *
   * Losing typed text is the worst failure a composer has: the turn broke AND
   * the person has to retype the question to find out whether it will break
   * again. Restores only when the field is empty — if they have already started
   * typing a follow-up, that is theirs and we do not overwrite it.
   */
  const restoreDraftOnFailure = useCallback(() => {
    const text = lastSentTextRef.current;
    if (!text) return;
    lastSentTextRef.current = null;
    if (!useLangyStore.getState().draft.trim()) setDraft(text);
  }, [setDraft]);
  /**
   * Walking away from the current conversation — New chat, switching, deleting
   * the active one — must reset the CHAT ENGINE too, not just the store. Two
   * owned seams, composed here and nowhere else:
   *
   *   - `resetEngine` — everything `useChat` owns that Zustand cannot reach
   *     (the error, the messages; see useLangyChatEngine for the war stories).
   *   - `recovery.reset()` — the PENDING AUTO-RETRY. The nastiest leak: a
   *     recovery timer armed by the conversation you just left would fire
   *     `regenerate()` into the one you just opened, re-driving a turn you
   *     walked away from.
   *
   * One place, so the next field added to either seam can't be forgotten here.
   */
  const resetChatEngine = ({ clearMessages }: { clearMessages: boolean }) => {
    resetEngine({ clearMessages });
    recovery.reset();
  };

  // "Sign in to Codex" from the session-expired card: the message column swaps
  // to the inline model setup landed on codex, and completing it (the re-auth)
  // re-drives the failed turn. Declared here so every escape hatch below
  // (new chat, close, switching the composer model) can clear it — otherwise a
  // user who takes the plan-limit card's "pick another model" suggestion sends
  // successfully but the reply renders behind a stuck setup screen.
  const [reconnectCodex, setReconnectCodex] = useState(false);

  const handleNewChat = () => {
    setReconnectCodex(false);
    resetChatEngine({ clearMessages: true });
    startNewConversation();
    // Starting a chat means you want the chat, not the filing cabinet.
    setHistoryOpen(false);
  };

  // ── Command-bar handoff ───────────────────────────────────────────────────
  // A question queued by the Cmd+K "Ask Langy" activation. `askLangy` already
  // opened the panel and reset the STORE to a fresh conversation; here we reset
  // the chat ENGINE (which Zustand can't reach) and fire the send. Gated on
  // `!isBusy` so a question that lands mid-stream waits for the current turn to
  // settle instead of being dropped by send()'s busy guard; the effect re-runs
  // when isBusy flips false and sends then. Consuming the prompt first makes it
  // fire exactly once.
  useEffect(() => {
    if (!pendingPrompt || !projectId || isBusy) return;
    const prompt = pendingPrompt;
    consumePendingPrompt();
    resetChatEngine({ clearMessages: true });
    void send(prompt);
    // send / resetChatEngine are fresh closures each render; the pendingPrompt
    // guard makes the body a no-op once consumed, so they are deliberately not
    // deps (matching this file's other one-shot effects).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPrompt, projectId, isBusy]);

  const handleSelectConversation = (id: string) => {
    // Messages are replaced by the selected conversation's history, so don't
    // blank them here — that would flash an empty panel mid-switch.
    resetChatEngine({ clearMessages: false });
    selectConversation(id);
    // Picking a conversation IS leaving the list — the whole point of the
    // full view is that it hands the panel back once you have chosen.
    setHistoryOpen(false);
  };

  const handleDeleteConversation = async (id: string) => {
    const wasActive = id === activeConversationId;
    try {
      await removeConversation(id);
      if (wasActive) {
        resetChatEngine({ clearMessages: true });
        startNewConversation();
      }
    } catch {
      toaster.create({
        title: "Langy",
        description: "Failed to delete conversation.",
        type: "error",
        duration: 5000,
      });
    }
  };

  const handleRenameConversation = async (id: string, title: string) => {
    try {
      await renameConversation(id, title);
    } catch {
      toaster.create({
        title: "Langy",
        description: "Failed to rename conversation.",
        type: "error",
        duration: 5000,
      });
      throw new Error("Failed to rename conversation");
    }
  };

  const applyProposal = useCallback(
    async (proposalId: string, proposal: LangyProposal) => {
      if (applyingProposalIds.has(proposalId)) return;
      if (proposalId in appliedOutcomes) return;
      if (discardedProposalIds.has(proposalId)) return;
      const handler = proposalHandlersRef?.current?.[proposal.kind];
      if (!handler) {
        toaster.create({
          title: "Cannot apply",
          description: `No handler for '${proposal.kind}' on this page.`,
          type: "error",
          duration: 5000,
        });
        return;
      }
      markProposalApplying(proposalId);
      try {
        const outcome = await handler(proposal.payload);
        markProposalApplied(proposalId, outcome ?? {});
        toaster.create({
          title: "Applied",
          description: proposal.summary,
          type: "success",
          duration: 3000,
        });
      } catch (error) {
        showErrorToast({
          error,
          fallbackTitle: "Couldn't apply this suggestion",
        });
      } finally {
        clearProposalApplying(proposalId);
      }
    },
    [
      appliedOutcomes,
      applyingProposalIds,
      clearProposalApplying,
      discardedProposalIds,
      markProposalApplied,
      markProposalApplying,
      proposalHandlersRef,
    ],
  );

  // A card pinned open: a shown ask riding out refetches, or `/feedback`.
  const pinnedFeedbackMessageId = useLangyStore(
    (s) => s.pinnedFeedbackMessageId,
  );

  // Granular streaming state (PR3 transport seam) + domain-error rendering.
  const turnSignals = useLangyTurnSignals(activeConversationId);
  const turnError = useMemo(() => {
    // The LIVE failure. Two roads reach `error`, and BOTH must be classified:
    //  - a turn-START rejection from the create/continue MUTATION carries the
    //    domain error on `error.data.error` → readLangyTrpcError;
    //  - a mid-turn failure off the STREAM carries it as a JSON message →
    //    readLangyStreamError.
    // Reading only the stream shape (as this once did) collapsed EVERY mutation
    // rejection — model-not-configured, egress-misconfigured, insufficient-scope,
    // even a raw infra throw — into the generic "unknown" card, hiding the real
    // (and often actionable) error the server actually returned.
    if (error) {
      const domain = resolveLiveTurnError({
        error,
        durableLastError: historyLastError,
      });
      // The raw message is DEBUG context, so it is logged, not put on `meta` —
      // `meta` is the contract for what the card renders, and since #5984 a
      // handled error's message is only its code slug anyway. Logged solely
      // for the case nothing could name, which is the one worth reading.
      if (domain.code === "unknown") {
        console.warn("[Langy] unclassified turn failure", error.message);
      }
      return explainLangyError(domain);
    }
    // The DURABLE failure, off the conversation fold. A turn error lived only in
    // `useChat` state, so a refresh after a failed turn left the user's question
    // sitting there with no answer and no explanation — even though the failure
    // was on record the whole time. Suppressed while a turn is in flight: the
    // previous turn's error is not this one's.
    if (isBusy || !historyLastError) return null;
    const domain = readLangyStreamError(historyLastError);
    return domain ? explainLangyError(domain) : null;
  }, [error, isBusy, historyLastError]);

  // RE-DRIVE the turn; never RE-POST the message. The user's message was
  // persisted server-side before the turn ran, so the old `send(lastUserText)`
  // retry appended a SECOND copy of the same question — visibly in the
  // transcript, and durably as a second `message_sent` event. `regenerate`
  // truncates the dead assistant message, leaves the user's message where it is,
  // and POSTs with `trigger: "regenerate-message"`, which the chat route reads
  // to skip `recordUserMessage`.
  const retryTurn = useCallback(() => {
    if (messages.length === 0) return;
    void regenerate();
  }, [regenerate, messages.length]);

  // The history card's own retry. Deliberately NOT `onErrorAction`: that one
  // re-drives the last TURN, and nothing about a failed history read means a
  // turn should run. Re-reading is the whole remedy.
  const onHistoryErrorAction = useCallback(
    (
      kind: "connect-github" | "configure-model" | "reconnect-codex" | "retry",
    ) => {
      if (kind !== "retry") return;
      void refetchHistory();
    },
    [refetchHistory],
  );

  const onErrorAction = useCallback(
    (
      kind: "connect-github" | "configure-model" | "reconnect-codex" | "retry",
    ) => {
      if (kind === "reconnect-codex") {
        setReconnectCodex(true);
        return;
      }
      if (kind !== "retry") return;
      retryTurn();
    },
    [retryTurn],
  );

  // Typed failures can be HANDLED, not just reported: the policy decides which
  // kinds re-drive themselves (a deploy restart, a busy agent), how long to
  // wait, and how many times — and which are terminal (a lost session, an
  // unknown error). While a retry is pending the panel shows a calm recovering
  // line instead of the red card; only an exhausted policy falls through to it.
  const recovery = useLangyTurnRecovery({
    errorKind: turnError?.kind ?? null,
    // useChat mints a fresh Error per failure, so its reference IS the failure's
    // identity — the same error across re-renders must not re-arm the timer.
    errorId: error,
    sideEffectsObserved: turnHadSideEffects(messages),
    onRetry: retryTurn,
  });

  // A missing GitHub connection is not a failure — it is an unmet prerequisite,
  // and it reaches the user by exactly ONE road: the turn stops with a structured
  // `langy_github_not_connected` domain error, the explainer classifies it
  // `render: "suppress"` + `connect-github` (NOT a red card), and the connect
  // card goes inline into the message flow, right where Langy needed GitHub.
  //
  // The old road — the model printing `[langy:connect-github]` in its prose, and
  // us regexing it back out — is gone. We asked an LLM to be a reliable state
  // machine in text, then parsed the text to drive UI; the sentinel module's own
  // docs listed the failure modes it had already hit. The worker knows whether
  // GH_TOKEN exists without asking the model, so it says so structurally.
  const needsGithubConnect =
    turnError?.render === "suppress" &&
    turnError.action?.kind === "connect-github";

  // INVARIANT: between send and a terminal state the message column must always
  // show SOMETHING — a working line, a recovering line, a card, or the answer —
  // never blank.
  //
  // The turn is IN FLIGHT from two sources, and neither alone is enough:
  //
  //   isBusy        the LIVE transport (useChat "submitted"/"streaming"). Right
  //                 the instant the user sends — before the fold has projected
  //                 anything — but it lies the other way too: the onTurnStream
  //                 subscription closes the moment a silent worker stops pushing
  //                 frames, and because `reconnectToStream()` returns null,
  //                 useChat settles to "ready" and isBusy goes false LONG before
  //                 the turn is actually over (the liveness subscriber keeps
  //                 re-driving for up to its whole grace budget, ~90s).
  //   serverTurnInFlight  the DURABLE truth off the fold — status `active`
  //                 (message sent, worker cold-starting) OR `running` (agent
  //                 responding), pushed by the freshness coordinator. It stays
  //                 true across a silent worker, a dropped stream, and a full
  //                 page refresh, and only clears when the turn finalizes
  //                 (`idle`) or fails (`failed`) — exactly the window the UI
  //                 must not go blank in. It covers the cold-start that `running`
  //                 alone misses (the fold reaches `running` only once the agent
  //                 actually responds, minutes after a cold worker began).
  //
  // OR them, and stop the moment anything terminal resolves (the branches below
  // own the error card / recovering line / connect card). The line we show is
  // honest by construction: it escalates the startup steps → "taking longer…" →
  // "it may be stuck" and never fakes progress (see logic/langyThinkingLine.ts).
  const liveTurnInFlight =
    (isBusy || turnActive) &&
    !turnError &&
    !recovery.isRecovering &&
    !needsGithubConnect;

  /**
   * A failure landed: give the draft back, and reconcile a stale in-flight turn.
   *
   * Two things the user hit in one go. The send 500'd and the panel said nothing
   * while silently eating their question; then re-sending was rejected with
   * "Langy is still replying" for a turn that had already failed — the browser
   * believed it was idle (so Send was enabled) while the backend still held the
   * conversation open, and nothing reconciled the two.
   *
   * `langy_turn_in_progress` is exactly that disagreement, so treat it as a
   * SIGNAL rather than a dead end: refetch the fold. Whatever it says wins — if
   * a turn really is running the phase machine adopts it and the composer shows
   * Stop (so the next click can end it) instead of offering a Send that only
   * 409s again.
   */
  useEffect(() => {
    if (!turnError) return;
    restoreDraftOnFailure();
    if (turnError.kind === "langy_turn_in_progress") {
      void utils.langy.messages.invalidate();
    }
  }, [turnError, restoreDraftOnFailure, utils]);

  // ── TIME TRAVEL (developer mode) ──────────────────────────────────────────
  // While the inspector's scrubber is off LIVE, the panel renders the
  // conversation AS IT STOOD at that moment of the tape — a pure view built
  // from the recorded lanes and the durable history (see langyTimeTravel.ts).
  // Substitution happens HERE, at render inputs only: no store mutation, no
  // engine writes, and every control that could act on the past (the composer)
  // is veiled inert. Null whenever live, which makes all of this vanish.
  const devScrubSeq = useLangyDevLog((s) => s.scrubSeq);
  const devRecords = useLangyDevLog((s) => s.records);
  const timeTravel = useMemo(
    () =>
      buildTimeTravelView({
        // The tape records every lane globally; the moment being rendered is
        // this conversation's, so the view reads only its records (plus the
        // unattributed pre-adoption ones — see tapeForConversation).
        records: tapeForConversation(devRecords, activeConversationId),
        scrubSeq: devScrubSeq,
        historyMessages,
      }),
    [devRecords, devScrubSeq, historyMessages, activeConversationId],
  );
  const displayMessages = timeTravel
    ? (timeTravel.messages as unknown as typeof messages)
    : messages;

  // The ordered timeline the choices lock state derives from (ADR-060 §6) —
  // built from whatever is being DISPLAYED, so time travel shows a question
  // open before its answer and locked after it, for free.
  //
  // Held stable BY VALUE, not just memoised on the message list. The engine
  // hands React a new array (and a new last message) on every streamed token,
  // so a plain `useMemo` on `displayMessages` minted a new timeline at token
  // rate and passed it to every `memo(MessageContent)` in the column — the same
  // defeat-the-memo problem as `selectChoice` below, and the timeline's own
  // value barely moves within a turn: it changes only when a question or a
  // selection lands.
  const choicesTimelineRef = useRef<{
    key: string;
    value: ReturnType<typeof langyChoicesTimeline>;
  }>({ key: "", value: [] });
  const choicesTimeline = useMemo(() => {
    const next = langyChoicesTimeline(displayMessages);
    const key = JSON.stringify(next);
    if (key !== choicesTimelineRef.current.key) {
      choicesTimelineRef.current = { key, value: next };
    }
    return choicesTimelineRef.current.value;
  }, [displayMessages]);

  // Answer a choices card: the selection is the NEXT USER MESSAGE — a typed
  // part the record binds by blockId, plus the readable "Chose: X" the model
  // acts on (ADR-060 §6). Rides the ordinary send path; the turn lifecycle
  // is untouched.
  //
  // STABLE, the same way `send` is (see `sendImplementationRef`), and for a
  // sharper reason: this goes to every `memo(MessageContent)` in the column as
  // `onChoiceSelect`, so a callback that changed identity per render made memo
  // buy nothing — a 40-message conversation re-ran every message's tool-part
  // scan on every streamed token. `isBusy` and `sendMessage` both move under a
  // live turn, so the deps come off a ref rather than out of the dep array.
  const selectChoiceImplementationRef = useRef<
    (args: {
      selection: LangyChoiceSelection;
      card: LangyDerivedChoicesCard;
    }) => void
  >(() => undefined);
  const selectChoice = useCallback(
    (args: {
      selection: LangyChoiceSelection;
      card: LangyDerivedChoicesCard;
    }) => selectChoiceImplementationRef.current(args),
    [],
  );
  selectChoiceImplementationRef.current = ({ selection, card }) => {
    if (!projectId || isBusy) return;
    const text = renderLangyChoiceSelectionText({
      selection,
      optionLabelById: new Map(
        card.options.map((option) => [option.id, option.label]),
      ),
    });
    recovery.reset();
    useLangyDevLog.getState().recordOutbound("send", `choice: ${text}`, {
      text,
      conversationId: useLangyStore.getState().activeConversationId,
    });
    void sendMessage({
      role: "user",
      // The selection part rides beside its text rendering. The engine's
      // part union has no custom members — same honest cast the history
      // rehydration path documents.
      parts: [
        { type: LANGY_CHOICE_SELECTION_PART_TYPE, ...selection },
        { type: "text", text },
      ] as unknown as UIMessage["parts"],
    });
  };

  // The verify hint's binding (ADR-060 §5): ask Langy — in words, through
  // the ordinary send path — to run the real platform query. The measured
  // result then arrives as an ordinary measured card via the envelope path.
  const verifyDerivedCard = useCallback(
    ({ card }: { card: LangyDerivedCard }) => {
      const subject =
        "title" in card && card.title ? `"${card.title}"` : "this derived card";
      void send(
        `Verify ${subject} with a real analytics query and show the measured result.`,
      );
    },
    [send],
  );
  const turnInFlight = timeTravel
    ? timeTravel.isTurnInFlight
    : liveTurnInFlight;
  const displayBusy = timeTravel ? timeTravel.isTurnInFlight : isBusy;
  const displaySignals = timeTravel
    ? {
        ...turnSignals,
        status: timeTravel.signals.status,
        statusIsReadiness: false,
        progress: timeTravel.signals.progress,
        progressSample: null,
        reasoning: timeTravel.signals.reasoning,
        metrics: null,
        segment: null,
      }
    : turnSignals;

  const latestAssistantMessage = [...messages]
    .reverse()
    .find((message) => message.role === "assistant");
  const displayLatestAssistant = timeTravel
    ? [...displayMessages]
        .reverse()
        .find((message) => message.role === "assistant")
    : latestAssistantMessage;
  const hasInlineProgressOwner = displayLatestAssistant
    ? toPendingCapabilities(displayLatestAssistant).length > 0
    : false;

  // What the fold's motion is saying right now — Langy's own behaviour, never
  // the cursor. Derived from the SAME provable wire signals as the thinking
  // line (tool stream / streamed prose / live reasoning), so the fold cannot
  // perform work that isn't happening. See logic/langyWaveMotion.ts and
  // specs/langy/langy-panel-fold-motion.feature.
  const waveActivity = deriveWaveActivity({
    turnInFlight: timeTravel ? timeTravel.isTurnInFlight : isBusy || turnActive,
    isSettling: !timeTravel && (!!turnError || recovery.isRecovering),
    hasLiveReasoning: !!displaySignals.reasoning,
    messages: displayMessages,
  });

  // A status label (the orange-orbed "Analysing traces…" row) is showing on the
  // conversation right now — the trigger for the seam's fibre glitter. Mirrors
  // exactly what makes StreamingStatusLine render its status orb, so the seam
  // shimmers in sympathy with that orb.
  // A readiness status is a placeholder for silence, and it may NEVER render
  // under an answer that is already on screen: a stream replay (reconnect,
  // resumed turn) re-delivers it after text has streamed, and "Thinking…"
  // below the visible reply reads as a contradiction. Suppress it the moment
  // the current turn has provable output; statuses the agent reports mid-turn
  // are untouched.
  const currentTurnMessage = currentTurnAssistant(displayMessages);
  const turnHasVisibleOutput =
    !!runningTool(currentTurnMessage) ||
    hasTokens(currentTurnMessage) ||
    settledTool(currentTurnMessage) ||
    !!displaySignals.reasoning;
  const statusForDisplay =
    displaySignals.statusIsReadiness && turnHasVisibleOutput
      ? null
      : displaySignals.status;
  const hasTurnDetail =
    !!statusForDisplay ||
    displaySignals.progress !== null ||
    (displaySignals.metrics?.length ?? 0) > 0;
  const activityOwnership = resolveLangyActivityOwnership({
    hasInlineProgressOwner,
    turnInFlight,
    status: statusForDisplay,
    progress: displaySignals.progress,
    progressSample: displaySignals.progressSample,
    metricsCount: displaySignals.metrics?.length ?? 0,
  });

  // A double-click on the card must not fire two turns.
  const githubRedrivenRef = useRef(false);
  useEffect(() => {
    if (isBusy) githubRedrivenRef.current = false;
  }, [isBusy]);

  const onGithubConnected = useCallback(() => {
    void utils.github.getConnectionStatus.invalidate({
      organizationId: organizationId ?? "",
    });
    if (githubRedrivenRef.current) return;
    githubRedrivenRef.current = true;
    // The turn stalled on a missing integration; now that it's there, re-drive
    // it so the user doesn't have to retype what they already asked for.
    //
    // `retryTurn` is `regenerate()`, NOT `sendMessage()` — it re-runs the last
    // turn without re-posting the user's message, so connecting can't duplicate
    // it in the transcript (pinned by langy-chat-retry.unit.test.ts).
    retryTurn();
  }, [utils, organizationId, retryTurn]);

  // The failure surface, in priority order: a pending auto-retry reads as a calm
  // recovering line (recovering beats failing), a missing integration is a setup
  // card rather than an error, and anything else that is not a composer notice
  // is a domain-error card. Derived here so it can be rendered from ONE place
  // regardless of whether the conversation has messages yet.
  const failureSurface =
    recovery.isRecovering && recovery.message ? (
      <LangyRecoveringLine message={recovery.message} />
    ) : needsGithubConnect && organizationId ? (
      // NOT an error. A missing integration is a setup step, so it surfaces as the
      // connect card at the point in the conversation where Langy needed it —
      // never a red card and never a toast.
      <LangyGitHubConnectCard
        organizationId={organizationId}
        onConnected={onGithubConnected}
      />
    ) : turnError &&
      turnError.render !== "composer-notice" &&
      !recovery.willAutoRecover ? (
      // `!willAutoRecover` pins the card OUT the moment a failure is known to be
      // auto-retryable, so it cannot flash for a frame before the retry timer
      // arms. A `composer-notice` error rides above the composer instead.
      <LangyError presentation={turnError} onAction={onErrorAction} />
    ) : null;

  // The generated title for the open conversation, read off the recents list —
  // the SAME server state, kept fresh by the useLangyFreshness SSE coordinator,
  // so the title-generation subscriber's `conversation_title_generated` event
  // lands here without a second fetch. Null until the subscriber produces one: the
  // header shows nothing that pretends to be a title in the meantime.
  const conversationTitle = useMemo(() => {
    if (!activeConversationId) return null;
    const title = conversations.find(
      (conversation) => conversation.id === activeConversationId,
    )?.title;
    const trimmed = typeof title === "string" ? title.trim() : "";
    return trimmed.length > 0 ? trimmed : null;
  }, [conversations, activeConversationId]);

  return (
    <Profiler id="LangyPanel" onRender={onLangyProfilerRender}>
      {/* OUTSIDE the panel box on purpose: the panel clips its own overflow
          (it owns its scroller and has to contain the fold), so a drawer
          sliding out of its left edge has to be a fixed sibling rather than a
          child. Only ever mounted while the panel is open — an inspector for a
          minimised panel inspects nothing. */}
      <LangyDevDrawer
        open={devDrawerVisible}
        onClose={() => setDevDrawerOpen(false)}
        floating={floating}
        dockShellClaimed={dockShellClaimed}
        panelHeightPx={panelHeightPx}
      />
      <LangyExternalLinkDialog {...externalLinkGuard.dialogProps} />
      <LangyMakeDefaultDialog
        plan={makeDefaultPlan}
        onDecline={declineMakeDefault}
        onConfirm={confirmMakeDefault}
      />
      <MotionBox
        ref={panelRef}
        {...contextDropProps}
        // Capture phase, at the root: a link that leaves LangWatch is caught
        // here before whatever rendered it can act on the click.
        {...externalLinkGuard.guardProps}
        className="langy-root"
        // `layout="position"` morphs the same mounted surface between
        // placements without a teleport: dock to floating card, and
        // dock/floating to the drawer companion. POSITION, never the full
        // FLIP: framer's size half animates a box delta as scaleX/scaleY, and
        // on the peek→open expansion that squashed the panel's whole content
        // — text and cards visibly stretching, then snapping to true layout.
        // Position deltas still travel; size changes ease as REAL layout (the
        // width/min-height/max-height transitions in `css` below), so content
        // is always laid out at its final size while the box grows.
        layout="position"
        position="fixed"
        // The dock is deliberately slimmer than the floating card — see
        // SIDEBAR_PANEL_WIDTH. The drawer companion keeps the dock width.
        width={
          isDrawerCompanion || !floating
            ? `${SIDEBAR_PANEL_WIDTH}px`
            : FLOATING_PANEL_CSS_WIDTH
        }
        // Dialogs, drawers, and command surfaces must be able to cover Langy.
        // Riding beside a drawer, the panel sits ABOVE the drawer CARD (Chakra's
        // drawer positioner is z 1500) so the drawer slides IN from behind the
        // companion rather than over it. 1600 stays BELOW the overlay layer
        // (menus/popovers/dialogs are z 2000+, including Langy's own header
        // menus), so those still open above the panel. Equal z-index alone
        // isn't enough: the drawer portal is later in the DOM and would win the
        // paint on a tie.
        zIndex={isDrawerCompanion ? 1600 : 1200}
        background="bg.surface"
        borderStyle="solid"
        // The brand's workhorse hairline (white/10 on dark, a warm paper line on
        // light) — `border.muted` was too faint to hold a floating card's edge.
        borderColor={isContextDropOver ? "purple.emphasized" : "border"}
        overflow="hidden"
        // Langy owns its scrolling surface. `contain` still permits macOS's
        // elastic overscroll, briefly exposing the black page behind the panel;
        // `none` stops both the page scroll and that visual rubber-band.
        overscrollBehavior="none"
        // The panel is the flex COLUMN itself, so its single in-flow child can
        // claim the full height. Without this the child's `height: 100%` resolves
        // against `height: auto` (floating mode) and collapses to content height —
        // which is what let the composer float up under a short conversation
        // instead of sitting on the panel's bottom edge.
        display="flex"
        flexDirection="column"
        // Own isolated group, so the Split effect's difference-blend inverts
        // only the panel — never the page behind it. Both layouts: the effect
        // runs on the dock too.
        isolation="isolate"
        // A peeking panel is visible and clickable — it is the affordance.
        // But invisible must also mean untouchable: a peek faded to zero
        // (dismissed) still covers its corner, and a click landing on nothing
        // visible is worse than a peek that stayed.
        pointerEvents={(isOpen || peeking) && !peekDismissed ? "auto" : "none"}
        // ...and therefore must NOT be hidden from assistive tech; its body is
        // made inert instead (see the content wrapper below), so the only
        // thing reachable behind the edge is the open control.
        aria-hidden={!isOpen && !peeking}
        role="complementary"
        aria-label="Langy assistant"
        // The peek's identity for CSS (langyTheme.css): the phase drives the
        // seam's brightness, the mode picks which edge it runs along, and
        // `working` breathes it while a turn is still running underneath — so
        // a minimised panel still shows that it is busy.
        data-langy-peek={peeking ? peekPhase : undefined}
        data-langy-peek-mode={peeking ? panelMode : undefined}
        data-langy-peek-working={peeking && turnActive ? "" : undefined}
        // The box framer transforms. The home page's send has to measure this
        // panel's composer while the panel is still CLOSED, and closed is a
        // transform on exactly this element — so it needs to be able to find
        // it and suppress it for one synchronous read.
        {...{ [PANEL_ROOT_ATTR]: "" }}
        // Floating rises from the peek's corner; sidebar slides from the
        // edge its peek sliver rests on.
        transformOrigin={floating ? "bottom right" : "right center"}
        initial={false}
        animate={
          isOpen
            ? "open"
            : peekDismissed
              ? "peekDismissed"
              : peeking
                ? "peek"
                : "closed"
        }
        variants={variants}
        // The peek's whole motion, on the one element: rest → near → open is
        // a single property easing on the panel's own curve. Never set while
        // open ("none"), so an opened panel carries no residue.
        style={{ translate: peekTranslate }}
        transition={
          reduceMotion
            ? { duration: 0 }
            : {
                ...(isOpen ? OPEN_TRANSITION : CLOSE_TRANSITION),
                layout: PANEL_LAYOUT_TRANSITION,
              }
        }
        // Any change in the floating card's resolved size eases instead of
        // snapping — chiefly the min-height floor stepping up as the conversation
        // grows (send: 340 → 410 → 520), but also the viewport cap. Transform-driven
        // open/close is motion's own inline transform;
        // this CSS transition names only the size floor/cap, so the two never
        // fight. Off under reduced motion.
        css={
          floating
            ? {
                ...(reduceMotion
                  ? {}
                  : {
                      // `width` rides along for the dock ↔ floating morph:
                      // with the framer layout animation position-only (see
                      // `layout="position"` above), the size change eases as
                      // genuine layout — content reflows at its real size —
                      // instead of a scale that squashes it.
                      transition: `min-height 340ms cubic-bezier(0.32, 0.72, 0, 1), max-height 340ms cubic-bezier(0.32, 0.72, 0, 1), width 340ms cubic-bezier(0.32, 0.72, 0, 1), translate ${LANGY_TRANSITION}`,
                    }),
                // The capped silhouette is handsome on a normal display, but on a
                // short split terminal/browser it leaves no actual conversation
                // viewport between header and composer. Short windows use the
                // available canvas instead of preserving decorative air.
                "@media (max-height: 620px)": {
                  height: "calc(100dvh - 24px)",
                  minHeight: "0",
                  maxHeight: "calc(100dvh - 24px)",
                },
              }
            : // The dock peeks on X, and needs the same eased travel. `width`
              // rides along for the dock ↔ floating morph (see above).
              reduceMotion
              ? undefined
              : {
                  transition: `translate ${LANGY_TRANSITION}, width 340ms cubic-bezier(0.32, 0.72, 0, 1)`,
                }
        }
        {...(isDrawerCompanion
          ? {
              // Riding beside the open drawer: the panel HOLDS the right
              // edge as another floating card and the drawer sits to its
              // left. EXACTLY the drawer's chrome (the app drawer recipe:
              // surface at alpha over the drawer blur, the same hairline,
              // radius and shadow) so the pair reads as two of one thing.
              top: "8px",
              right: "8px",
              bottom: "8px",
              background: "bg.surface/80",
              backdropFilter: "blur(25px)",
              borderWidth: "1px",
              borderColor: "border",
              borderRadius: "lg",
              boxShadow: "lg",
            }
          : floating
            ? {
                // Anchored bottom corner, growing UPWARD, capped by
                // FLOATING_MAX_VIEWPORT_DVH so a sliver of page always shows and
                // the card reads as floating over it. The resting floor is
                // deliberately short — a compact card at rest that GROWS with its
                // conversation up to the cap, rather than opening as a tall stub over
                // an empty thread.
                // While a drawer is open it DODGES to the left corner so the
                // drawer keeps the full right edge — a floating window getting out
                // of the way. Otherwise it rests bottom-right as usual.
                ...(floatingDodgesDrawer
                  ? { left: `${PANEL_INSET}px` }
                  : { right: `${PANEL_INSET}px` }),
                bottom: `${PANEL_INSET}px`,
                height: "auto",
                minHeight: floatingMinHeight,
                maxHeight: FLOATING_MAX_HEIGHT,
                // Floating reads as glass: a touch translucent over a blur of the
                // page behind it. (Sidebar stays fully opaque — it's docked, not
                // floating over content.) Light uses the platform's standard
                // glass recipe (surface at alpha over an 8px blur); dark keeps
                // the heavier ink glass, whose ground needs the stronger blur
                // to stay legible.
                background: "bg.surface/85",
                backdropFilter: "blur(8px)",
                borderWidth: "1px",
                borderRadius: "20px",
                boxShadow:
                  "0 1px 2px rgba(20,20,23,0.04), 0 12px 28px rgba(20,20,23,0.10), 0 32px 64px rgba(20,20,23,0.10)",
                _dark: {
                  background: "bg.surface/88",
                  backdropFilter: "blur(16px) saturate(1.1)",
                  // The stacked drop shadows give depth from OUTSIDE; the inset
                  // hairline gives the top edge a lit rim from INSIDE, so the panel
                  // reads as a raised object catching light rather than a flat cut-
                  // out. white/12 — one notch above the border's white/10.
                  boxShadow:
                    "0 1px 2px rgba(0,0,0,0.4), 0 12px 28px rgba(0,0,0,0.5), 0 32px 64px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.12)",
                },
              }
            : dockShellClaimed
              ? {
                  // An app shell is mounted: the dock joins it as a SECOND
                  // content card. It starts below the full-width header,
                  // aligned with the content card's top edge, and wears the
                  // card's own language: the same top-left radius, the same
                  // muted hairline on the two edges that meet the page ground,
                  // and (dark) the same faint lit top rim. The strip of page
                  // ground between the two cards is reserved by the shell, see
                  // DashboardLayout. Spec: specs/langy/langy-panel-layout.feature
                  top: `${APP_HEADER_HEIGHT}px`,
                  right: 0,
                  bottom: 0,
                  borderTopWidth: "1px",
                  borderLeftWidth: "1px",
                  borderColor: "border.muted",
                  borderTopLeftRadius: "xl",
                  borderBottomLeftRadius: 0,
                  boxShadow: "none",
                  _dark: { boxShadow: "inset 0 1px 0 rgba(255,255,255,0.07)" },
                }
              : {
                  // No shell on this page (a full-screen tool like the studio):
                  // the dock stays a flush full-height pane on the viewport edge.
                  top: 0,
                  right: 0,
                  bottom: 0,
                  borderLeftWidth: "1px",
                  borderTopLeftRadius: 0,
                  borderBottomLeftRadius: 0,
                  boxShadow: "none",
                })}
      >
        {/* Texture, under the content (which stacks at zIndex 1) and inert to
          the pointer. Two gates on purpose: the JSX renders it in the FLOATING
          card only (the docked card stays plain), and langyTheme.css shows it
          on the dark ground only (light is the app's own clean surface). */}
        {floating ? <Box className="langy-signal-grid" aria-hidden /> : null}
        {/* A whisper of the brand rising from the top of the panel, so the ink
          ground has depth and a hint of identity instead of reading flat. Dark
          only, always on, single-digit alpha — see `.langy-panel-glow` in
          langyTheme.css. */}
        {floating ? <Box className="langy-panel-glow" aria-hidden /> : null}
        {/* The "fold": a living seam splitting the panel into two faint brand
          tones, moving with Langy's own activity — never the cursor. Both
          layouts share the one driver; only while open — see LangyWave. */}
        <LangyWave
          containerRef={panelRef}
          active={isOpen && panelEffect !== "plain"}
          activity={waveActivity}
          statusActive={activityOwnership.waveStatusActive}
          compact={!floating}
          reduceMotion={reduceMotion}
        />
        {/* THE PEEK'S ONLY CONTROL. While the panel rests as a sliver, this
            covers it: a real button, so Tab reaches it and Enter/Space opens,
            sitting over the panel's own header rather than replacing it (what
            you see is still the panel's header — this is just the hit area).
            It is a CHILD of the panel, so the thing that slides is still one
            element. Gone entirely once open, where the header's own controls
            take over. */}
        {peeking ? (
          <chakra.button
            type="button"
            onClick={onOpen}
            onPointerEnter={() => setPeekHovered(true)}
            onPointerLeave={() => setPeekHovered(false)}
            onFocus={() => setPeekFocused(true)}
            onBlur={() => setPeekFocused(false)}
            aria-label="Open Langy assistant"
            aria-keyshortcuts="Meta+I Control+I"
            position="absolute"
            // The target covers the WHOLE visible sliver, which is a different
            // shape in each mode: floating leaves a strip of header along the
            // top, the dock leaves a strip of its edge running the entire
            // height of the viewport. Sized to the RISEN sliver in both, so the
            // pointer never falls off the target as the panel rises to meet it.
            {...(floating
              ? {
                  top: 0,
                  left: 0,
                  right: 0,
                  height: `${FLOATING_PEEK_NEAR_PX}px`,
                }
              : {
                  top: 0,
                  bottom: 0,
                  left: 0,
                  width: `${SIDEBAR_PEEK_NEAR_PX}px`,
                })}
            zIndex={3}
            cursor="pointer"
            background="transparent"
            borderWidth={0}
            borderRadius="inherit"
            _focusVisible={{
              outline: "2px solid",
              outlineColor: "orange.emphasized",
              outlineOffset: "-2px",
            }}
          />
        ) : null}
        {/* Fills whatever height the panel resolved to (min 440px floating, full
          viewport docked). Header and composer are flexShrink=0; the message
          list between them takes the slack — so the composer is ALWAYS the
          bottom edge, however short the conversation. */}
        <VStack
          ref={peekInertRef}
          data-langy-peek-body=""
          gap={0}
          align="stretch"
          flex={1}
          minHeight={0}
          position="relative"
          zIndex={1}
        >
          {/* A render crash anywhere in the panel's content draws an inline
              error INSIDE the panel frame instead of white-screening the host
              page. The panel chrome stays mounted (unmounting would tear down
              the in-flight stream); switching conversation re-attempts. */}
          <IsolatedErrorBoundary
            scope="Langy hit a snag"
            resetKeys={[activeConversationId]}
          >
            <PanelHeader
              conversationTitle={conversationTitle}
              onNewChat={handleNewChat}
              onClose={() => {
                setReconnectCodex(false);
                closePanel();
              }}
              // Riding beside a drawer, the drawer owns the only close affordance
              // on screen; a second X on the companion read as "close the drawer"
              // and kept dismissing Langy instead. Closing the drawer returns
              // Langy to its dock, where its own Minimise is back.
              hideClose={isDrawerCompanion}
              historyOpen={historyOpen}
              onToggleHistory={() => setHistoryOpen((open) => !open)}
              devMode={devMode}
              devDrawerOpen={devDrawerOpen}
              onToggleDevDrawer={() => setDevDrawerOpen((open) => !open)}
            />
            {/* HISTORY IS A PLACE. When the recents list is open it takes the
            whole panel body — the message column AND the composer — rather
            than floating over the conversation as a popover. You are browsing,
            not composing, so a live composer under the list would only invite
            you to type into a conversation you cannot see. Picking a chat (or
            Back / Escape) hands the panel straight back. */}
            {historyOpen ? (
              <RecentChatsView
                conversations={conversations}
                isLoading={isLoadingConversations}
                hasError={hasListError}
                activeConversationId={activeConversationId}
                onSelect={handleSelectConversation}
                onDelete={(id) => void handleDeleteConversation(id)}
                onRename={handleRenameConversation}
                onBack={() => setHistoryOpen(false)}
                compact={!floating}
              />
            ) : (
              <>
                {/* The context Langy is holding lives in ONE place, the composer's
            own summary row (both layouts). A second banner above the
            conversation restated the same chips and read as duplication. */}
                {/* The message column and, BEHIND it, the ambient wash. The wash is a
            sibling of the scroller (not a child) so it never scrolls, never
            repaints on scroll, and never reaches the composer below.

            It earns its place twice — on the empty state, where there is
            nothing else on the surface, and while a turn is in flight, where a
            slow drift signals life. A settled conversation gets a plain
            surface; the wash fades out rather than popping. */}
                {/* A flex COLUMN, so the scroller below gets a flex-resolved height.
            It used to be a plain block while the scroller asked for
            `height:100%` — a percentage against a parent whose own `height` is
            `auto` (its size comes from `flex:1`). Percentage-of-auto resolves to
            auto, so the scroller grew to fit its content, never overflowed,
            never engaged `overflow-y:auto`, and the panel's `overflow:hidden`
            simply clipped the conversation. That was "it just goes off screen".
            No percentage heights survive in this column. */}
                <Box
                  position="relative"
                  flex={1}
                  minHeight={0}
                  display="flex"
                  flexDirection="column"
                >
                  {/* The wrapper carries the FADE (0 -> 1); the wash itself carries its
              own near-nothing opacity in CSS. Animating the wash's opacity
              directly would have let motion's inline `opacity: 1` overwrite the
              0.05 that makes it subtle at all. */}
                  <MotionBox
                    position="absolute"
                    inset={0}
                    overflow="hidden"
                    pointerEvents="none"
                    aria-hidden
                    initial={false}
                    animate={{ opacity: showWash ? 1 : 0 }}
                    transition={{
                      duration: reduceMotion ? 0 : 0.8,
                      ease: "easeInOut",
                    }}
                  >
                    <Box className="langy-wash" />
                  </MotionBox>
                  <Box
                    ref={scrollRef}
                    position="relative"
                    flex={1}
                    minHeight={0}
                    overflowY="auto"
                    overscrollBehaviorY="none"
                    aria-live="polite"
                    // Focusable, so the column answers PageUp/PageDown/Home/End. Without
                    // a tabindex it is not a keyboard scroll target at all.
                    tabIndex={0}
                    role="log"
                    aria-label="Langy conversation"
                    // Edge masks: why a mask and why the top one follows the
                    // scroll position is documented at CONVERSATION_EDGE_MASK_*.
                    css={{
                      "&:focus-visible": { outline: "none" },
                      maskImage: isConversationScrolledFromTop
                        ? CONVERSATION_EDGE_MASK_SCROLLED
                        : CONVERSATION_EDGE_MASK_AT_TOP,
                      WebkitMaskImage: isConversationScrolledFromTop
                        ? CONVERSATION_EDGE_MASK_SCROLLED
                        : CONVERSATION_EDGE_MASK_AT_TOP,
                    }}
                  >
                    {/* The ResizeObserver's subject: one stable element whose height IS
                the content height, whatever happens to be rendering inside.
                Floating uses `display: flow-root` so a child's margin can't
                collapse through it and shorten the observed box. The docked
                sidebar is a tall column with little content, so here it becomes a
                flex column filling the scroller (`minHeight: 100%`) — that lets
                the empty state CENTRE and a starting conversation GRAVITATE to the
                bottom (near the composer) instead of stranding at the top. Flex
                items don't margin-collapse either, so the flow-root guarantee is
                preserved. (`measure()` reads the scroller, not this box, so
                filling it never fakes an overflow — see useLangyStickToBottom.) */}
                    <Box
                      ref={contentRef}
                      display={floating ? "flow-root" : "flex"}
                      flexDirection="column"
                      minHeight={floating ? undefined : "100%"}
                    >
                      {/* The recents list failed while the panel was open: one calm,
                  dismissable domain-error card at the top of the surface. */}
                      {listErrorPresentation ? (
                        <Box
                          position="relative"
                          paddingX={floating ? "19px" : "14px"}
                          paddingTop={floating ? "19px" : "14px"}
                        >
                          <LangyError
                            presentation={listErrorPresentation}
                            onAction={(kind) => {
                              if (kind === "retry") void refetchConversations();
                            }}
                          />
                          <IconButton
                            aria-label="Dismiss"
                            size="2xs"
                            variant="ghost"
                            color="fg.muted"
                            position="absolute"
                            top={floating ? "25px" : "20px"}
                            right={floating ? "25px" : "20px"}
                            onClick={() => setListErrorDismissed(true)}
                          >
                            <X size={13} />
                          </IconButton>
                        </Box>
                      ) : null}
                      {/* A refresh of the open conversation failed while the
                          conversation itself is still on screen. One line, no
                          card: the messages below are real — see
                          `isHistoryStale`. While a turn is running the poll
                          behind it clears this on its own, so the line stays
                          silent; on a settled conversation nothing is coming,
                          so it carries the retry (`historyRetryIsComing`). */}
                      {isHistoryStale ? (
                        <HStack
                          data-testid="langy-history-stale"
                          gap={1.5}
                          align="baseline"
                          paddingX={floating ? "19px" : "14px"}
                          paddingTop={floating ? "19px" : "14px"}
                        >
                          <Text textStyle="2xs" color="fg.subtle">
                            Showing the messages we last loaded. This
                            conversation couldn&apos;t be refreshed.
                          </Text>
                          {historyRetryIsComing ? null : (
                            // The same quiet retry the inline error uses (see
                            // LangyError's `inline` render): a plain amber link,
                            // no box, no alarm.
                            <chakra.button
                              type="button"
                              onClick={() => refetchHistory()}
                              flexShrink={0}
                              borderWidth={0}
                              background="transparent"
                              color="orange.fg"
                              cursor="pointer"
                              textStyle="2xs"
                              fontWeight="560"
                              _hover={{ textDecoration: "underline" }}
                            >
                              Try again
                            </chakra.button>
                          )}
                        </HStack>
                      ) : null}
                      {showCardGallery ? (
                        <LangyCardGallery />
                      ) : langyNeedsModel || reconnectCodex ? (
                        <VStack
                          align="stretch"
                          gap={2}
                          paddingX="18px"
                          paddingTop="18px"
                        >
                          <Text fontSize="sm" fontWeight="semibold">
                            {reconnectCodex
                              ? "Sign in to Codex again"
                              : "Langy needs a model to get started"}
                          </Text>
                          {/* The one subtitle under this heading is the provider
                        grid's own description; a second line here read as a
                        double title. */}
                          <ModelProviderScreen
                            variant="langy"
                            {...(reconnectCodex
                              ? { initialProviderKey: "codex" as const }
                              : {})}
                            onComplete={() => {
                              void resolvedDefaultQuery.refetch();
                              if (reconnectCodex) {
                                // Re-authenticated: back to the conversation and
                                // re-drive the turn the dead session failed.
                                setReconnectCodex(false);
                                retryTurn();
                              }
                            }}
                          />
                        </VStack>
                      ) : blockingHistoryError ? (
                        // Ahead of the empty state deliberately: a conversation we
                        // could not READ is not a conversation with nothing in it,
                        // and "How can I help?" over a failed load tells the reader
                        // their messages are gone.
                        <VStack
                          align="stretch"
                          paddingX={floating ? "19px" : "14px"}
                          paddingTop={floating ? "19px" : "14px"}
                        >
                          <LangyError
                            presentation={blockingHistoryError}
                            onAction={onHistoryErrorAction}
                          />
                        </VStack>
                      ) : isRestoringConversation ? (
                        // Coming back to a conversation whose messages have not
                        // arrived. Its shape, not an invitation to start one.
                        <VStack
                          align="stretch"
                          paddingX={floating ? "19px" : "14px"}
                          paddingTop={floating ? "19px" : "14px"}
                        >
                          <ConversationSkeleton
                            count={skeletonMessageCount(restoringMessageCount)}
                            dense={!floating}
                          />
                        </VStack>
                      ) : isEmpty && !pendingPrompt ? (
                        // A queued question counts as content: showing the empty
                        // state's "How can I help?" over a question the reader
                        // has already asked reads as the panel losing it.
                        <EmptyState
                          variant={floating ? "floating" : "sidebar"}
                          panelWidth={
                            floating ? floatingPanelWidth : SIDEBAR_PANEL_WIDTH
                          }
                          suggestions={emptySuggestions}
                          onPick={(prompt) => void send(prompt)}
                        />
                      ) : (
                        <VStack
                          // The slimmer dock also runs denser: at 416px the floating
                          // card's air turns into two-word lines, so the column trades
                          // padding for measure.
                          gap={floating ? "16px" : "12px"}
                          align="stretch"
                          paddingX={floating ? "19px" : "14px"}
                          paddingTop={floating ? "19px" : "14px"}
                          paddingBottom="12px"
                          // Conversations always read top-to-bottom. The old sidebar
                          // `marginTop:auto` made every short chat rise out of the
                          // composer, which looked like messages were entering from the
                          // bottom and made history jump as it grew.
                        >
                          {displayMessages.map((message, index) => (
                            // One message's render crash stays that message's:
                            // a malformed tool part or card payload draws an
                            // inline error where the message would have been,
                            // and the rest of the conversation stands.
                            <IsolatedErrorBoundary
                              key={message.id}
                              scope="This message failed to render"
                              resetKeys={[message.id]}
                            >
                              <MessageContent
                                message={message}
                                organizationId={organizationId}
                                appliedOutcomes={appliedOutcomes}
                                discardedProposals={discardedProposalIds}
                                applyingProposals={applyingProposalIds}
                                onApply={applyProposal}
                                onDiscard={discardProposalInStore}
                                conversationId={activeConversationId}
                                isStreaming={
                                  displayBusy &&
                                  index === displayMessages.length - 1 &&
                                  message.role === "assistant"
                                }
                                interrupted={
                                  interruptedConversationId != null &&
                                  interruptedConversationId ===
                                    activeConversationId &&
                                  index === displayMessages.length - 1 &&
                                  message.role === "assistant"
                                }
                                // Only ever on a turn that COMPLETED. We were asking
                                // "How did Langy do?" above a timeout card — rating an
                                // answer that never arrived. The failure IS the feedback;
                                // asking the user to score it as well is insulting, and
                                // whatever they clicked would be noise in the data.
                                //
                                // `!turnError` covers the failure; `!recovery.isRecovering`
                                // covers the turn that is still being re-driven and might
                                // yet succeed. This is only the position + settled gate:
                                // whether a card actually shows is `shouldAskFeedback` (the
                                // backend cadence), the directive, or the pin.
                                showFeedback={
                                  !isBusy &&
                                  // The durable phase too — never ask "How did Langy
                                  // do?" while a turn is still in flight. And never
                                  // while time-travelling: you cannot rate the past.
                                  !timeTravel &&
                                  !turnActive &&
                                  !turnError &&
                                  !recovery.isRecovering &&
                                  message.role === "assistant" &&
                                  index === displayMessages.length - 1
                                }
                                shouldAskFeedback={shouldAskFeedback}
                                isFeedbackPinned={
                                  pinnedFeedbackMessageId === message.id
                                }
                                // The block channel (ADR-060). Interaction is
                                // live-only: while time-travelling the cards
                                // render read-only from the replayed record.
                                choicesTimeline={choicesTimeline}
                                onChoiceSelect={
                                  timeTravel ? undefined : selectChoice
                                }
                                onVerifyDerivedCard={
                                  timeTravel ? undefined : verifyDerivedCard
                                }
                                // (No connect-card prop: MessageContent no longer sniffs
                                // the prose for `[langy:connect-github]`. The connect card
                                // is driven by the structured `langy_github_not_connected`
                                // error below — one road, not two.)
                              />
                            </IsolatedErrorBoundary>
                          ))}
                          {/* The question the reader has already asked but which
                            has not become a message yet.

                            `askLangy` blanks the draft the moment it queues the
                            prompt — correct, the panel's composer must open
                            empty for the follow-up — and the effect that sends
                            it waits for `!isBusy`. If an earlier turn is still
                            settling that wait is not one frame, it is however
                            long that turn takes, and for all of it the reader's
                            text exists only in the store and is drawn nowhere.
                            That is not a polish gap, it is input that looks
                            lost. Drawn as the real bubble, in the place the
                            real bubble will appear, so the swap is invisible. */}
                          {!timeTravel && pendingPrompt ? (
                            <QueuedPrompt
                              prompt={pendingPrompt}
                              reduceMotion={reduceMotion}
                            />
                          ) : null}
                          {turnInFlight ? (
                            // No extra air above the working lines. The answer
                            // takes this exact slot when it arrives, so any
                            // margin here is a jump the reader sees at the one
                            // moment they are watching: the line sat 8px lower
                            // than the first line of the reply that replaced it.
                            // The row's own padding is zero for the same reason
                            // (STATUS_LINE_ROW), which lands the two text boxes
                            // on the same optical line.
                            <VStack align="stretch" gap={2.5}>
                              {/* Reasoning is a SIGNAL, never a surface: the model's
                          thinking is not shown to the user, so it reaches the
                          line as a boolean that only changes its words
                          ("Thinking…" instead of a false escalation toward
                          "stuck"). The store still accumulates the text — the
                          fold's `thinking` motion is derived from it. */}
                              {hasTurnDetail &&
                              activityOwnership.showStandaloneSignals ? (
                                <StreamingStatusLine
                                  status={activityOwnership.standaloneStatus}
                                  progress={
                                    activityOwnership.standaloneProgress
                                  }
                                  progressSample={
                                    activityOwnership.standaloneProgressSample
                                  }
                                  metrics={displaySignals.metrics}
                                  segment={displaySignals.segment}
                                />
                              ) : !hasInlineProgressOwner ? (
                                <LangyThinkingLine
                                  messages={displayMessages}
                                  hasLiveReasoning={!!displaySignals.reasoning}
                                  // The panel-open warm proved this
                                  // conversation's worker alive, so the first
                                  // message reads "Thinking…" instead of the
                                  // cold-boot ladder.
                                  workerReady={
                                    warmedConversationId != null &&
                                    (warmedConversationId ===
                                      activeConversationId ||
                                      warmedConversationId ===
                                        pendingConversationId)
                                  }
                                />
                              ) : null}
                            </VStack>
                          ) : null}
                          {/* Recovering beats failing. While the policy has a retry
                    pending, the turn is — as far as the user is concerned —
                    still in flight, so it reads as a quiet status line, not a
                    red card asking them to do something they need not do. The
                    card appears only once the policy has given up, or never had
                    a retry to give (a lost session, an unknown error). */}
                        </VStack>
                      )}
                      {/* FAILURE RENDERS WHETHER OR NOT THE THREAD HAS MESSAGES.
                      This block used to live INSIDE the non-empty branch above,
                      which meant a turn that failed before any message reached
                      the engine — the first send of a fresh chat, the exact case
                      a user hits — rendered the empty state and nothing else.
                      The turn 500'd and the panel said nothing at all. A failure
                      must never be quieter than a success. Suppressed while the
                      inspector scrubs the past: a live failure is not part of
                      the moment being replayed. */}
                      {/* Padded to the message column's own measure. This block
                        sits OUTSIDE the column (it has to — a failure renders
                        whether or not the thread has messages), and outside it
                        there is no padding at all, so the card ran edge to edge
                        against the panel while every message beside it was
                        inset. */}
                      {!timeTravel && failureSurface ? (
                        <Box
                          paddingX={floating ? "19px" : "14px"}
                          paddingBottom="12px"
                        >
                          {failureSurface}
                        </Box>
                      ) : null}
                      {/* The live edge. A smooth `scrollIntoView` on this sentinel is
                  what follows the stream — see useLangyStickToBottom. */}
                      <Box ref={endRef} height="1px" aria-hidden />
                    </Box>
                  </Box>
                  {/* Released the pin, and content is still arriving below the fold?
              Offer the way back. Absolutely positioned inside the wrapper — a
              SIBLING of the scroller — so it neither scrolls nor repaints on
              scroll, the same reason the wash lives there. */}
                  <JumpToLatest
                    visible={!isPinned && canScroll}
                    onClick={jumpToLatest}
                  />
                </Box>
                {/* "One turn at a time" is a WAIT, not a failure: it rides here, a
            dismissable notice attached above the composer, and the draft the user
            just tried to send stays in the field (restored in `send`) rather than
            being lost to a history card. Dismiss clears the useChat error. It
            slides up out of the composer (height + fade) instead of snapping. */}
                <AnimatePresence initial={false}>
                  {turnError?.render === "composer-notice" ? (
                    <MotionNotice
                      key="composer-notice"
                      position="relative"
                      overflow="hidden"
                      paddingX={floating ? "19px" : "14px"}
                      paddingBottom="6px"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.18, ease: "easeOut" }}
                    >
                      <LangyError
                        presentation={turnError}
                        onAction={() => undefined}
                      />
                      <IconButton
                        aria-label="Dismiss"
                        size="2xs"
                        variant="ghost"
                        color="fg.muted"
                        position="absolute"
                        top="6px"
                        right={floating ? "25px" : "20px"}
                        onClick={() => clearError()}
                      >
                        <X size={13} />
                      </IconButton>
                    </MotionNotice>
                  ) : null}
                </AnimatePresence>
                {/* TIME TRAVEL veil. While the inspector's scrubber is off LIVE,
                the composer is visible but inert — you cannot send into, or
                stop, the past. The strip names the viewed moment and is the way
                back. */}
                {timeTravel ? (
                  <HStack
                    paddingX={floating ? "19px" : "14px"}
                    paddingBottom="4px"
                    gap={2}
                  >
                    <Text textStyle="2xs" color="orange.fg" fontWeight="600">
                      Viewing tape @{" "}
                      {timeTravel.atMs
                        ? new Date(timeTravel.atMs).toLocaleTimeString()
                        : "start"}
                    </Text>
                    <chakra.button
                      type="button"
                      onClick={() => useLangyDevLog.getState().setScrub(null)}
                      borderWidth={0}
                      borderRadius="sm"
                      paddingX={1.5}
                      paddingY={0.5}
                      cursor="pointer"
                      textStyle="2xs"
                      fontWeight="600"
                      background="orange.subtle"
                      color="orange.fg"
                    >
                      back to live
                    </chakra.button>
                  </HStack>
                ) : null}
                {/* The composer reads the turn phase straight from the store (ADR-078):
            it shows Send when idle and Stop while a turn is in flight or
            stopping — no isBusy / serverTurnInFlight / isStopping / queue props. */}
                <Box
                  pointerEvents={timeTravel ? "none" : undefined}
                  opacity={timeTravel ? 0.55 : undefined}
                  aria-hidden={timeTravel ? true : undefined}
                >
                  <Composer
                    model={modelOverride}
                    modelOptions={modelOptions}
                    langyDefaultModel={langyDefaultModel}
                    onModelChange={(model) => {
                      // Switching models is choosing the other way out of a dead
                      // codex session; leaving the reconnect screen up would trap
                      // the panel on the sign-in it no longer needs.
                      setReconnectCodex(false);
                      setModelOverride(model);
                      // The pick is done; this only ASKS whether it should also
                      // become the default, when the picker can grant that.
                      offerMakeDefault(model);
                    }}
                    onSend={send}
                    onStop={handleStop}
                    variant={floating ? "floating" : "sidebar"}
                    disabled={!projectId}
                    // ALL chips — page-derived AND explicitly attached (home-briefing
                    // investigate/attach) — so the `#` palette can reference everything
                    // the conversation will actually be given.
                    contextChips={allContextChips}
                    onRemoveChip={removeContextChip}
                    addableChips={addableChips}
                    onAddChip={chooseChip}
                  />
                </Box>
              </>
            )}
          </IsolatedErrorBoundary>
        </VStack>
      </MotionBox>
    </Profiler>
  );
}

/**
 * A question that has been asked but has not become a message yet.
 *
 * Deliberately identical to the real user bubble rather than a "pending" style
 * of its own: the moment the turn starts, the real message takes this exact
 * position with this exact appearance, and a distinct treatment here would make
 * that swap into a visible flicker. It is not interactive and carries no
 * status; if the send is waiting on something, the thing it is waiting on says
 * so in its own line below.
 *
 * Spec: specs/home/langy-home-morph.feature
 */
function QueuedPrompt({
  prompt,
  reduceMotion,
}: {
  prompt: string;
  reduceMotion: boolean;
}) {
  return (
    <MotionBox
      alignSelf="flex-end"
      maxWidth="85%"
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={
        reduceMotion ? { duration: 0 } : { duration: 0.22, ease: "easeOut" }
      }
    >
      <Box
        paddingX={3}
        paddingY={2}
        background="langy.userBubbleBg"
        color="fg"
        borderWidth="1px"
        borderStyle="solid"
        borderColor="langy.userBubbleBorder"
        borderRadius="15px"
        borderBottomRightRadius="5px"
        textStyle="sm"
        lineHeight="1.5"
        whiteSpace="pre-wrap"
      >
        {prompt}
      </Box>
    </MotionBox>
  );
}

/**
 * The way back to the live edge.
 *
 * Auto-follow releases the moment the user scrolls up to read — which is
 * correct, but it leaves them stranded: without this, the only route back to a
 * streaming answer is to scroll all the way down by hand. Appears only when the
 * pin is released AND the content actually overflows, so it never floats over a
 * conversation that has nowhere to go.
 */
function JumpToLatest({
  visible,
  onClick,
}: {
  visible: boolean;
  onClick: () => void;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <AnimatePresence>
      {visible ? (
        <MotionBox
          position="absolute"
          bottom="10px"
          left="50%"
          zIndex={2}
          initial={reduceMotion ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
          transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
          style={{ x: "-50%" }}
        >
          <chakra.button
            type="button"
            onClick={onClick}
            aria-label="Jump to latest"
            display="inline-flex"
            alignItems="center"
            gap={1.5}
            height="28px"
            paddingLeft={2.5}
            paddingRight={3}
            borderRadius="full"
            borderWidth="1px"
            borderStyle="solid"
            borderColor="border"
            background="bg.surface/90"
            color="fg.muted"
            textStyle="2xs"
            fontWeight="500"
            cursor="pointer"
            css={{ backdropFilter: "blur(10px)" }}
            transition="color 130ms ease, border-color 130ms ease"
            _hover={{ color: "fg", borderColor: "border.emphasized" }}
          >
            <ArrowDown size={12} />
            Jump to latest
          </chakra.button>
        </MotionBox>
      ) : null}
    </AnimatePresence>
  );
}

function PanelHeader({
  conversationTitle,
  onNewChat,
  onClose,
  hideClose,
  historyOpen,
  onToggleHistory,
  devMode,
  devDrawerOpen,
  onToggleDevDrawer,
}: {
  /** The conversation's GENERATED title, or null while it has none yet. */
  conversationTitle: string | null;
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
      {/* ONE line, at the trace explorer search bar's height, a chat app's
          header, not a masthead. Identity leads: the generated conversation
          title (the wordmark until one lands), as a LABEL, not a control; it
          truncates so it can never shove the rail off the edge. Then the
          actions, compose, history (its own icon, which swaps the panel to the
          full-height chat list), the layout toggle, more, and finally Minimise,
          held apart by a divider so it is unmistakably the last control.
          Spec: specs/langy/langy-panel-header.feature */}
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
          {conversationTitle ? (
            <AnimatedConversationTitle title={conversationTitle} />
          ) : (
            "Langy"
          )}
        </Box>

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
            <Tooltip
              content="Dock to side"
              positioning={{ placement: "bottom" }}
            >
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

          <LangyOverflowMenu
            devDrawerOpen={devDrawerOpen}
            onToggleDevDrawer={onToggleDevDrawer}
          />

          {/* The exit stands apart — always the rightmost control. Hidden while
              riding beside a drawer: the drawer's own X is the single close, so
              Langy doesn't offer a confusable twin.

              It says MINIMISE, because that is what it does. The panel stays
              mounted (unmounting would tear down the in-flight stream), the
              conversation is untouched, `isOpen` persists across a reload, and
              the panel sinks to a sliver of its own header — so the
              honest word is minimise, and a second "minimise" control beside
              a "close" that did the same thing would only be two names for
              one behaviour. */}
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
 * The header's overflow — one `⋯` for everything that is a SETTING rather than
 * an action you take mid-conversation.
 *
 * Layout (Floating / Sidebar, persisted) and developer mode each used to own a
 * permanent icon on a six-button rail in a 380px header. Neither is touched
 * more than once in a session, so both live here now and the rail is down to
 * the three things you actually reach for.
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
      {/* TriggerAnchor is LOAD-BEARING here, not decoration.
          Tooltip and Menu.Trigger are BOTH `asChild`, and both clone their own
          `id` onto the same child DOM node. Nested directly, the Tooltip's id
          wins and clobbers the trigger's, Zag's id-based anchor lookup finds
          nothing, and the menu renders at the page's raw top-left origin instead
          of under the button. That is precisely what was wrong with this
          dropdown. The span gives each clone its own node.
          The recents view's row menus already do this; this menu was the one
          that didn't. */}
      <Tooltip content="More" positioning={{ placement: "bottom" }}>
        <TriggerAnchor>
          <Menu.Trigger asChild>
            <IconButton
              size="xs"
              variant="ghost"
              aria-label="More Langy options"
              color="fg.muted"
            >
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
