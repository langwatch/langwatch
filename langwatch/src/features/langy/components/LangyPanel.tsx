import {
  Box,
  chakra,
  HStack,
  IconButton,
  Separator,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { UIMessage } from "ai";
import {
  AppWindow,
  ArrowDown,
  Braces,
  PanelLeftOpen,
  Check,
  LayoutGrid,
  type LucideIcon,
  History,
  Minus,
  MoreHorizontal,
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
import { allModelOptions } from "~/components/ModelSelector";
import { Kbd } from "~/components/ops/shared/Kbd";
import { Menu } from "~/components/ui/menu";
import { TriggerAnchor } from "~/components/ui/TriggerAnchor";
import { toaster } from "~/components/ui/toaster";
import { Tooltip } from "~/components/ui/tooltip";
import { ModelProviderScreen } from "~/features/onboarding/components/sections/ModelProviderScreen";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useReducedMotion } from "~/hooks/useReducedMotion";
// ONE definition of the wire shape, server-side, imported by both ends, the
// route spreads `langyTurnContextSchema.shape` into its body schema, and this
// types the payload against the same source. If the route stops accepting a
// field, this stops compiling. That is the whole point: the last time these two
// drifted, `safeParse` silently dropped `pageContext` on every single turn and
// nobody found out for weeks.
import type { LangyResourceContext } from "~/server/app-layer/langy/langyTurnContext.schema";
import { api } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";
import { isHandledByGlobalHandler } from "~/utils/trpcError";
import { useLangyConversationCommands } from "../data/useLangyConversationCommands";
import { useLangyConversationList } from "../data/useLangyConversationList";
import { useLangyMessages } from "../data/useLangyMessages";
import { useGlobalLangyShortcut } from "../hooks/useGlobalLangyShortcut";
import { useLangyChatEngine } from "../hooks/useLangyChatEngine";
import { useLangyDevMode } from "../hooks/useLangyDevMode";
import { useLangyExternalLinkGuard } from "../hooks/useLangyExternalLinkGuard";
import { useLangyFreshness } from "../hooks/useLangyFreshness";
import { useLangyOrbProximity } from "../hooks/useLangyOrbProximity";
import { useLangyPageContext } from "../hooks/useLangyPageContext";
import { useLangyContextDropZone } from "../hooks/useLangyContextDropZone";
import { useLangyStickToBottom } from "../hooks/useLangyStickToBottom";
import {
  turnHadSideEffects,
  useLangyTurnRecovery,
} from "../hooks/useLangyTurnRecovery";
import { useLangyTurnSignals } from "../hooks/useLangyTurnSignals";
import { shouldRehydrateEngineFromDurable } from "../logic/foreignTurnRehydration";
import { resolveLangyActivityOwnership } from "../logic/langyActivityOwnership";
import {
  createLangyChatTransport,
  type LangyTurnRequestContext,
} from "../logic/langyChatTransport";
import { mergeContextChips } from "../logic/langyContextChips";
import { SURFACE_PATH_FOR_KIND } from "../logic/langyContextKindIntent";
import {
  explainLangyError,
  readLangyStreamError,
  readLangyTrpcError,
} from "../logic/langyErrorExplainer";
import { PANEL_ROOT_ATTR } from "../logic/composerMorphGeometry";
import {
  APP_HEADER_HEIGHT,
  FLOATING_PANEL_CSS_WIDTH,
  PANEL_LAYOUT_TRANSITION,
  resolveFloatingPanelWidth,
  SIDEBAR_PANEL_WIDTH,
} from "../logic/langyPanelLayout";
import { resolveLangyStopTarget } from "../logic/langyStopTarget";
import { deriveWaveActivity } from "../logic/langyWaveMotion";
import {
  type LangyRevealableKind,
  useLangyContextTargetStore,
} from "../stores/langyContextTargetStore";
import { useLangyDevLog } from "../stores/langyDevLog";
import {
  attachedContextToChip,
  type LangyPanelEffect,
  type LangyPanelMode,
  useLangyStore,
} from "../stores/langyStore";
import { AnimatedConversationTitle } from "./AnimatedConversationTitle";
import { Composer } from "./Composer";
import { EmptyState } from "./EmptyState";
import { LangyGitHubConnectCard } from "./github/LangyGitHubConnectCard";
import { LangyCardGallery } from "./LangyCardGallery";
import { LangyDevDrawer } from "./LangyDevDrawer";
import { useLangyDevLog } from "../stores/langyDevLog";
import { LangyContextTargetLayer } from "./LangyContextTargetLayer";
import { LangyDevDrawer } from "./LangyDevDrawer";
import { LangyError } from "./LangyError";
import { LangyExternalLinkDialog } from "./LangyExternalLinkDialog";
import { LangyMark, LangyMarkGradientDefs } from "./LangyMark";
import { LangyRecoveringLine } from "./LangyRecoveringLine";
import { RecentChatsView } from "./RecentChatsView";
import { LangyThinkingLine } from "./LangyThinkingLine";
import { toPendingCapabilities } from "./LangyToolActivity";
import { LangyWave } from "./LangyWave";
import {
  type LangyProposal,
  MessageContent,
  type ProposalHandlers,
} from "./MessageContent";
import { StreamingStatusLine } from "./StreamingStatusLine";
// Langy's own skin: scoped warm/cream palette + serif display face. The
// `.langy-root` class (below) is where the Chakra semantic-token overrides land.
import "../langyTheme.css";

// The same feature key Langy's chat route resolves against. Used to seed the
// composer's model picker with whatever's actually resolving today — opening
// Langy on a project that already has a configured default model lands on
// THAT model, not on an unrelated branch-primary pick.
const LANGY_GATE_FEATURE_KEY = "prompt.create_default";

// The floating card's symmetric viewport inset: a rounded card with a small,
// SYMMETRIC inset on every side (a soft brand glow + shadow behind it).
const PANEL_INSET = 12;

// A Chakra Box that also takes framer-motion props — used for the thinking
// line's blur-crossfade when its text changes. `css` still routes through
// emotion (so the shimmer keyframes inject), while motion drives opacity /
// blur / y.
const MotionText = motion.create(Box);
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

// Floating grows OUT OF the launcher it replaces: scaled down and offset toward
// the bottom-right corner, then springing up to rest — the card feels like it
// unfolds from the button you just pressed rather than sliding in from off-canvas.
// Sidebar is a dock, so it does the honest thing and slides in from the edge.
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

interface LangySidecarProps {
  proposalHandlersRef?: React.RefObject<ProposalHandlers>;
}

export function LangySidecar({ proposalHandlersRef }: LangySidecarProps) {
  const isOpen = useLangyStore((s) => s.isOpen);
  const toggle = useLangyStore((s) => s.togglePanel);
  useGlobalLangyShortcut(toggle);

  return (
    <>
      <LangyMarkGradientDefs />
      <LangyLauncher isOpen={isOpen} onOpen={toggle} />
      <LangyContextTargetLayer />
      <LangyPanel proposalHandlersRef={proposalHandlersRef} />
    </>
  );
}

/**
 * The closed-state opener — a single circular launcher in the bottom-right
 * corner (the Notion-AI model), NOT an edge chip. There is no reserved gutter
 * and no collapse tab: opening is this button, collapsing is the panel header's
 * Minimise. Restrained on purpose — the LangWatch mark on a plain surface with a soft
 * neutral shadow, no mesh, no loud colour. Hidden while the panel is open.
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
  // Dodge to the bottom-LEFT corner while a drawer is open.
  const { currentDrawer } = useDrawer();
  const dodgeLeft = !!currentDrawer;
  // The orb leans + glows toward the cursor as it approaches (the one place a
  // Langy surface reacts to the pointer — a hover affordance on the target
  // itself, not ambient chrome). Disabled under reduced motion. `transform` is
  // driven imperatively from the hook's rAF, so the button's own transition
  // must NOT list transform, or it would double-smooth and lag the deform.
  const { orbRef, glowRef, activate } = useLangyOrbProximity({
    enabled: !reduceMotion,
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
}: {
  proposalHandlersRef?: React.RefObject<ProposalHandlers>;
}) {
  const { organization, project } = useOrganizationTeamProject();
  const projectId = project?.id;
  const organizationId = organization?.id;
  const utils = api.useUtils();
  const router = useRouter();

  // `#trace` in the palette, answered: light matching targets up here, or —
  // when this page has none — go to the surface that has them and let the
  // pending reveal light them up as they mount.
  const requestReveal = useLangyContextTargetStore((s) => s.requestReveal);
  const onKindIntent = useCallback(
    ({
      kind,
      action,
    }: {
      kind: LangyRevealableKind;
      action: "reveal" | "browse";
    }) => {
      requestReveal({ kind });
      if (action === "browse" && project?.slug) {
        void router.push(`/${project.slug}/${SURFACE_PATH_FOR_KIND[kind]}`);
      }
    },
    [requestReveal, project?.slug, router],
  );

  // ── Client/UI state (single store) ────────────────────────────────────────
  const isOpen = useLangyStore((s) => s.isOpen);
  const closePanel = useLangyStore((s) => s.closePanel);
  const setDraft = useLangyStore((s) => s.setDraft);
  const modelOverride = useLangyStore((s) => s.modelOverride);
  const setModelOverride = useLangyStore((s) => s.setModelOverride);
  const activeConversationId = useLangyStore((s) => s.activeConversationId);
  const historyLoadConversationId = useLangyStore(
    (s) => s.historyLoadConversationId,
  );
  const selectConversation = useLangyStore((s) => s.selectConversation);
  const startNewConversation = useLangyStore((s) => s.startNewConversation);
  const consumeHistoryLoad = useLangyStore((s) => s.consumeHistoryLoad);
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
  const floatingDodgesDrawer = hasDrawer && floating;
  const viewportWidth = useViewportWidth();
  const floatingPanelWidth = resolveFloatingPanelWidth(viewportWidth);

  const variants = useMemo(
    () => ({
      open: { opacity: 1, scale: 1, x: 0, y: 0 },
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
        },
        onSignal: (signal) => {
          const store = useLangyStore.getState();
          if (signal.type === "status") store.setTurnStatus(signal.status);
          else if (signal.type === "progress") {
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
  const langyNeedsModel =
    !!projectId &&
    !resolvedDefaultQuery.isLoading &&
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

  const {
    messages,
    sendMessage,
    stop,
    status,
    error,
    regenerate,
    applyHistoryToEngine,
    resetEngine,
  } = useLangyChatEngine({ transport });

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
    isFetching: isFetchingHistory,
    isError: hasHistoryError,
    error: historyError,
    refetch: refetchHistory,
    eventCursor: snapshotEventCursor,
    currentTurnId: snapshotCurrentTurnId,
  } = useLangyMessages(activeConversationId);

  /**
   * The conversation's own history failed to load.
   *
   * Ignoring this was a second silent hole: the hook has always exposed
   * `isError` and the panel simply never read it, so a `clickhouse_unavailable`
   * (Langy's messages live in ClickHouse) logged a TRPCClientError to the
   * console and rendered nothing at all. Same rule as everywhere else — a
   * failure may never be quieter than a success.
   */
  const historyErrorPresentation = useMemo(() => {
    if (!hasHistoryError) return null;
    const domain = readLangyTrpcError(historyError);
    if (domain) return explainLangyError(domain);
    return {
      kind: "langy_history_unavailable",
      title: "This conversation isn't loading",
      description:
        "Its messages can't be reached right now. You can still start a new chat.",
      render: "card" as const,
      action: { label: "Try again", kind: "retry" as const },
    };
  }, [hasHistoryError, historyError]);

  // The turn phase — the SINGLE, event-driven source of "is a turn in flight"
  // (ADR-058). It lives in the store as a machine (idle → active → stopping →
  // idle); here we only FEED it the durable fold signal so it reflects turns
  // this tab did not start (another tab, a resume after refresh) and settles
  // once the fold that CONFIRMED the turn goes idle. The old per-render
  // serverTurnInFlight / settled-marker / isStopping booleans are gone.
  const turnPhase = useLangyStore((s) => s.turnPhase);
  const turnActive = turnPhase !== "idle";
  useEffect(() => {
    useLangyStore.getState().observeBackendTurn(isFoldTurnInFlight);
  }, [isFoldTurnInFlight]);

  // A user Stop is a REAL backend stop (ADR-058): the durable stopped terminal is
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
        meta: { closable: true },
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
  // refreshed tab adopts (making Stop + live signals work again). The seed
  // reducer never rewinds a fresher local fold, so refetches are harmless.
  useEffect(() => {
    if (!activeConversationId) return;
    useLangyStore.getState().seedTurnProjection({
      cursor: snapshotEventCursor,
      currentTurnId: snapshotCurrentTurnId,
    });
  }, [
    activeConversationId,
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
  // The floating card's resting floor. While a turn is in flight we never fall
  // back to the empty floor, so sending from an empty thread steps UP
  // (340 → 410 → 520) instead of dropping to the minimised floor first and
  // bouncing back as the answer arrives.
  // A queued question is content, so the card must not drop to its empty floor
  // underneath one and bounce back up the instant the turn starts.
  const emptyAndSettled = isEmpty && !isBusy && !pendingPrompt;
  const restingFloorPx = emptyAndSettled
    ? 340
    : messages.length <= 1
      ? 410
      : 520;
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
  const showWash = isEmpty || isBusy || turnActive;

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

  const handleNewChat = () => {
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
        meta: { closable: true },
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
        meta: { closable: true },
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
          meta: { closable: true },
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
          meta: { closable: true },
        });
      } catch (error) {
        if (!isHandledByGlobalHandler(error)) {
          toaster.create({
            title: "Failed to apply",
            description:
              error instanceof Error ? error.message : "Unknown error",
            type: "error",
            duration: 5000,
            meta: { closable: true },
          });
        }
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
  const hasTurnDetail =
    !!turnSignals.status ||
    turnSignals.progress !== null ||
    (turnSignals.metrics?.length ?? 0) > 0;
  const turnError = useMemo(() => {
    // The LIVE failure. Two roads reach `error`, and BOTH must be classified:
    //  - a turn-START rejection from the create/continue MUTATION carries the
    //    domain error on `error.data.error` → readLangyTrpcError;
    //  - a mid-turn failure off the STREAM carries it as a JSON message →
    //    readLangyStreamError.
    // Reading only the stream shape (as this once did) collapsed EVERY mutation
    // rejection — model-not-configured, egress-misconfigured, insufficient-scope,
    // even a raw infra throw — into the generic "unknown" card, hiding the real
    // (and often actionable) error the server actually returned. The unknown
    // fallback now also carries the raw message so a genuinely-unhandled error
    // stays legible in the dev-mode debug drawer instead of being a black box.
    if (error) {
      const domain = readLangyTrpcError(error) ??
        readLangyStreamError(error.message) ?? {
          code: "unknown",
          meta: error.message ? { error: error.message } : {},
          httpStatus: 500,
        };
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
    (kind: "connect-github" | "configure-model" | "retry") => {
      if (kind !== "retry") return;
      void refetchHistory();
    },
    [refetchHistory],
  );

  const onErrorAction = useCallback(
    (kind: "connect-github" | "configure-model" | "retry") => {
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
  //                 the turn is actually over (the liveness reactor keeps
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
  // honest by construction: it escalates "Starting up…" → "taking longer…" →
  // "it may be stuck" and never fakes progress (see logic/langyThinkingLine.ts).
  const turnInFlight =
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

  const latestAssistantMessage = [...messages]
    .reverse()
    .find((message) => message.role === "assistant");
  const hasInlineProgressOwner = latestAssistantMessage
    ? toPendingCapabilities(latestAssistantMessage).length > 0
    : false;

  // What the fold's motion is saying right now — Langy's own behaviour, never
  // the cursor. Derived from the SAME provable wire signals as the thinking
  // line (tool stream / streamed prose / live reasoning), so the fold cannot
  // perform work that isn't happening. See logic/langyWaveMotion.ts and
  // specs/langy/langy-panel-fold-motion.feature.
  const waveActivity = deriveWaveActivity({
    turnInFlight: isBusy || turnActive,
    isSettling: !!turnError || recovery.isRecovering,
    hasLiveReasoning: !!turnSignals.reasoning,
    messages,
  });

  // A status label (the orange-orbed "Analysing traces…" row) is showing on the
  // conversation right now — the trigger for the seam's fibre glitter. Mirrors
  // exactly what makes StreamingStatusLine render its status orb, so the seam
  // shimmers in sympathy with that orb.
  const activityOwnership = resolveLangyActivityOwnership({
    hasInlineProgressOwner,
    turnInFlight,
    status: turnSignals.status,
    progress: turnSignals.progress,
    progressSample: turnSignals.progressSample,
    metricsCount: turnSignals.metrics?.length ?? 0,
  });

  // A double-click on the card must not fire two turns.
  const githubRedrivenRef = useRef(false);
  useEffect(() => {
    if (isBusy) githubRedrivenRef.current = false;
  }, [isBusy]);

  const onGithubConnected = useCallback(() => {
    void utils.langyGithub.getInstallStatus.invalidate({
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
  // so the title-generation reactor's `conversation_title_generated` event
  // lands here without a second fetch. Null until the reactor produces one: the
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
        open={isOpen && devMode && devDrawerOpen}
        onClose={() => setDevDrawerOpen(false)}
        floating={floating}
      />
      <LangyExternalLinkDialog {...externalLinkGuard.dialogProps} />
      <MotionBox
        ref={panelRef}
        {...contextDropProps}
        // Capture phase, at the root: a link that leaves LangWatch is caught
        // here before whatever rendered it can act on the click.
        {...externalLinkGuard.guardProps}
        className="langy-root"
        // `layout` morphs the same mounted surface between placements without a
        // teleport: dock to floating card, and dock/floating to the drawer
        // companion. The panel grows taller and lifts above content in place,
        // rather than sliding off-screen and back.
        layout
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
        pointerEvents={isOpen ? "auto" : "none"}
        aria-hidden={!isOpen}
        role="complementary"
        aria-label="Langy assistant"
        // The box framer transforms. The home page's send has to measure this
        // panel's composer while the panel is still CLOSED, and closed is a
        // transform on exactly this element — so it needs to be able to find
        // it and suppress it for one synchronous read.
        {...{ [PANEL_ROOT_ATTR]: "" }}
        // Floating unfolds from the launcher's corner; sidebar slides from the
        // edge it docks to.
        transformOrigin={floating ? "bottom right" : "right center"}
        initial={false}
        animate={isOpen ? "open" : "closed"}
        variants={variants}
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
                      transition:
                        "min-height 340ms cubic-bezier(0.32, 0.72, 0, 1), max-height 340ms cubic-bezier(0.32, 0.72, 0, 1)",
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
            : undefined
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
        {/* Fills whatever height the panel resolved to (min 440px floating, full
          viewport docked). Header and composer are flexShrink=0; the message
          list between them takes the slack — so the composer is ALWAYS the
          bottom edge, however short the conversation. */}
        <VStack
          gap={0}
          align="stretch"
          flex={1}
          minHeight={0}
          position="relative"
          zIndex={1}
        >
          <PanelHeader
            conversationTitle={conversationTitle}
            onNewChat={handleNewChat}
            onClose={closePanel}
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
                  css={{ "&:focus-visible": { outline: "none" } }}
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
                    {showCardGallery ? (
                      <LangyCardGallery />
                    ) : langyNeedsModel ? (
                      <VStack
                        align="stretch"
                        gap={2}
                        paddingX="18px"
                        paddingTop="18px"
                      >
                        <Text fontSize="sm" fontWeight="semibold">
                          Langy needs a model to get started
                        </Text>
                        {/* The one subtitle under this heading is the provider
                        grid's own description; a second line here read as a
                        double title. */}
                        <ModelProviderScreen
                          variant="langy"
                          onComplete={() => void resolvedDefaultQuery.refetch()}
                        />
                      </VStack>
                    ) : historyErrorPresentation ? (
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
                          presentation={historyErrorPresentation}
                          onAction={onHistoryErrorAction}
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
                        {messages.map((message, index) => (
                          <MessageContent
                            key={message.id}
                            message={message}
                            organizationId={organizationId}
                            appliedOutcomes={appliedOutcomes}
                            discardedProposals={discardedProposalIds}
                            applyingProposals={applyingProposalIds}
                            onApply={applyProposal}
                            onDiscard={discardProposalInStore}
                            conversationId={activeConversationId}
                            isStreaming={
                              isBusy &&
                              index === messages.length - 1 &&
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
                              // do?" while a turn is still in flight.
                              !turnActive &&
                              !turnError &&
                              !recovery.isRecovering &&
                              message.role === "assistant" &&
                              index === messages.length - 1
                            }
                            shouldAskFeedback={shouldAskFeedback}
                            isFeedbackPinned={
                              pinnedFeedbackMessageId === message.id
                            }
                            // (No connect-card prop: MessageContent no longer sniffs
                            // the prose for `[langy:connect-github]`. The connect card
                            // is driven by the structured `langy_github_not_connected`
                            // error below — one road, not two.)
                          />
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
                        {pendingPrompt ? (
                          <QueuedPrompt
                            prompt={pendingPrompt}
                            reduceMotion={reduceMotion}
                          />
                        ) : null}
                        {turnInFlight ? (
                          // Extra air above the working lines: the column's gap
                          // alone left them hugging the cards of the streaming
                          // answer, which read as part of the message rather than
                          // the live edge below it.
                          <VStack align="stretch" gap={2.5} marginTop={1.5}>
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
                                progress={activityOwnership.standaloneProgress}
                                progressSample={
                                  activityOwnership.standaloneProgressSample
                                }
                                metrics={turnSignals.metrics}
                                segment={turnSignals.segment}
                              />
                            ) : !hasInlineProgressOwner ? (
                              <LangyThinkingLine
                                messages={messages}
                                hasLiveReasoning={!!turnSignals.reasoning}
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
                      must never be quieter than a success. */}
                    {failureSurface}
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
              {/* The composer reads the turn phase straight from the store (ADR-058):
            it shows Send when idle and Stop while a turn is in flight or
            stopping — no isBusy / serverTurnInFlight / isStopping / queue props. */}
              <Composer
                model={modelOverride}
                modelOptions={modelOptions}
                langyDefaultModel={langyDefaultModel}
                onModelChange={setModelOverride}
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
                onKindIntent={onKindIntent}
              />
            </>
          )}
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
              the launcher orb comes back — so the honest word is minimise, and
              a second "minimise" control beside a "close" that did the same
              thing would only be two names for one behaviour. */}
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
