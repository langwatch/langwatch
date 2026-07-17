import { useChat } from "@ai-sdk/react";
import {
  Box,
  chakra,
  HStack,
  IconButton,
  Separator,
  Text,
  VStack,
} from "@chakra-ui/react";
import { type UIMessage } from "ai";
import {
  AppWindow,
  ArrowDown,
  Braces,
  Check,
  ChevronDown,
  LayoutGrid,
  type LucideIcon,
  MoreHorizontal,
  PanelRight,
  Square,
  SquarePen,
  Waves,
  X,
} from "lucide-react";
import {
  forwardRef,
  Profiler,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import { isLangyManagedVk } from "~/components/gateway/langyVk";
import { allModelOptions } from "~/components/ModelSelector";
import { Kbd } from "~/components/ops/shared/Kbd";
import { toaster } from "~/components/ui/toaster";
import { Tooltip } from "~/components/ui/tooltip";
import { TriggerAnchor } from "~/components/ui/TriggerAnchor";
import { ModelProviderScreen } from "~/features/onboarding/components/sections/ModelProviderScreen";
import { LangyMark, LangyMarkGradientDefs } from "./LangyMark";
import { langyThinkingShimmerStyles } from "./langyShimmer";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import { api } from "~/utils/api";
import { isHandledByGlobalHandler } from "~/utils/trpcError";
import { AnimatedConversationTitle } from "./AnimatedConversationTitle";
import { Composer } from "./Composer";
import {
  type LangyRevealableKind,
  useLangyContextTargetStore,
} from "../stores/langyContextTargetStore";
import { LangyContextTargetLayer } from "./LangyContextTargetLayer";
import { SURFACE_PATH_FOR_KIND } from "../logic/langyContextKindIntent";
import { useRouter } from "~/utils/compat/next-router";
import { LangyCardGallery } from "./LangyCardGallery";
import { EmptyState } from "./EmptyState";
import { LangyWave } from "./LangyWave";
import { deriveWaveActivity } from "../logic/langyWaveMotion";
import { useLangyDevMode } from "../hooks/useLangyDevMode";
import { LangyFoundryMenu } from "./LangyFoundryMenu";
import { LangyGitHubConnectCard } from "./github/LangyGitHubConnectCard";
import {
  type LangyProposal,
  MessageContent,
  type ProposalHandlers,
} from "./MessageContent";
import { RecentChatsMenu } from "./RecentChatsMenu";
import { useGlobalLangyShortcut } from "../hooks/useGlobalLangyShortcut";
import { useLangyOrbProximity } from "../hooks/useLangyOrbProximity";
import { useLangyConversationList } from "../data/useLangyConversationList";
import { useLangyConversationCommands } from "../data/useLangyConversationCommands";
import { useLangyMessages } from "../data/useLangyMessages";
import type { LangyMessageDto } from "../data/langy.dtos";
import { useLangyFreshness } from "../hooks/useLangyFreshness";
import {
  createLangyChatTransport,
  type LangyTurnRequestContext,
} from "../logic/langyChatTransport";
import { useLangyStickToBottom } from "../hooks/useLangyStickToBottom";
import { useLangyTurnSignals } from "../hooks/useLangyTurnSignals";
import {
  attachedContextToChip,
  type LangyPanelEffect,
  type LangyPanelMode,
  useLangyStore,
} from "../stores/langyStore";
import { mergeContextChips } from "../logic/langyContextChips";
import {
  LangySidebarContext,
  type SidebarContextEntry,
} from "./LangySidebarContext";
import { Menu } from "~/components/ui/menu";
import { useLangyPageContext } from "../hooks/useLangyPageContext";
// ONE definition of the wire shape, server-side, imported by both ends — the
// route spreads `langyTurnContextSchema.shape` into its body schema, and this
// types the payload against the same source. If the route stops accepting a
// field, this stops compiling. That is the whole point: the last time these two
// drifted, `safeParse` silently dropped `pageContext` on every single turn and
// nobody found out for weeks.
import type { LangyResourceContext } from "~/server/app-layer/langy/langyTurnContext.schema";
import { LangyError } from "./LangyError";
import { LangyRecoveringLine } from "./LangyRecoveringLine";
import { LangyThinkingLine } from "./LangyThinkingLine";
import { StreamingStatusLine } from "./StreamingStatusLine";
import { toPendingCapabilities } from "./LangyToolActivity";
import { resolveLangyActivityOwnership } from "../logic/langyActivityOwnership";
import {
  FLOATING_PANEL_CSS_WIDTH,
  resolveFloatingPanelWidth,
} from "../logic/langyPanelLayout";
import {
  explainLangyError,
  readLangyStreamError,
  readLangyTrpcError,
} from "../logic/langyErrorExplainer";
import {
  turnHadSideEffects,
  useLangyTurnRecovery,
} from "../hooks/useLangyTurnRecovery";
import { shouldAskFeedback } from "../logic/langyFeedbackDirective";
// Langy's own skin: scoped warm/cream palette + serif display face. The
// `.langy-root` class (below) is where the Chakra semantic-token overrides land.
import "../langyTheme.css";

// The same feature key Langy's chat route resolves against. Used to seed the
// composer's model picker with whatever's actually resolving today — opening
// Langy on a project that already has a configured default model lands on
// THAT model, not on an unrelated branch-primary pick.
const LANGY_GATE_FEATURE_KEY = "prompt.create_default";

// A lean default: slim enough to read as a quiet companion rather than a second
// pane, still wide enough that a trace table, a diff or a capability card can
// breathe (the 380px sidecar forced everything into a column of two-word lines,
// so we stay clear of that floor). Still a sidecar, not a split view: the page
// keeps the majority of the viewport. The panel is expected to GROW with its
// content later (a wide card can widen the card); this is the resting width.
// The docked sidebar runs narrower than the floating card: floating OVERLAYS
// the page, so its width is free; the dock takes its width FROM the page for
// as long as it is open, and at 432px a 13" laptop (~1280–1440px viewport)
// loses a big slice of its working room. 392px keeps cards readable (still clear
// of the 380px two-word-lines floor) while giving the page back 40px.
// Spec: specs/langy/langy-panel-layout.feature
const SIDEBAR_PANEL_WIDTH = 392;

// The sidecar FLOATS: a rounded card with a small, SYMMETRIC inset on every
// side (a soft brand glow + shadow behind it). Page content reserves exactly
// the card + one inset of breathing room — NOT an extra handle-width band,
// which is what left the awful always-there gutter. The collapse handle rides
// on the card's left edge (a tab) rather than in a reserved gutter.
//
// NOTE: the whole open/close/dock model is under review (a Notion-AI-style
// bottom-right launcher that pins to the side, and how it coexists with the app
// drawer) — see LANGY_UI_STREAMING_PLAN.md. This is the interim.
const PANEL_INSET = 12;

/** The docked panel's rounded left edge. */
const DOCK_RADIUS = 0;

/**
 * How far the docked panel OVERLAPS the page content.
 *
 * The dock is full-height with a rounded left edge, so its corners curve away
 * from the content. Reserve exactly `PANEL_WIDTH` and those two arcs expose a
 * sliver of bare page between the content's edge and the panel — a gap that
 * reads as a rendering glitch.
 *
 * Overlapping by precisely the corner radius closes it: the curve now sits ON
 * TOP of content rather than over a void, so there is nothing to see through.
 * It is deliberately no larger than the radius — an overlap is a clip, and 18px
 * of a page's right margin is a price worth paying where 40px of live content
 * would not be.
 */
const DOCK_OVERLAP = 0;

// Sidebar mode pushes page content left by the dock width MINUS the overlap
// above; Floating mode overlays and reserves nothing (see LangyShiftedRoot,
// which pads only in sidebar mode).
export const LANGY_DOCKED_OFFSET = SIDEBAR_PANEL_WIDTH - DOCK_OVERLAP;
export const LANGY_TRANSITION = "240ms cubic-bezier(0.32, 0.72, 0, 1)";

// A Chakra Box that also takes framer-motion props — used for the thinking
// line's blur-crossfade when its text changes. `css` still routes through
// emotion (so the shimmer keyframes inject), while motion drives opacity /
// blur / y.
const MotionText = motion.create(Box);

// The panel itself. It stays MOUNTED when closed (unmounting would tear down
// useChat's in-flight stream), so open/close is a variant swap, not an
// AnimatePresence mount.
const MotionBox = motion.create(Box);

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
// A layout morph is deliberately slower than open/close. Switching between the
// dock and the floating companion changes both the page's reserved gutter and
// the panel's geometry; treating that as one spring makes it feel picked up and
// placed, rather than a sidebar disappearing while a card pops in elsewhere.
const PANEL_LAYOUT_TRANSITION = {
  type: "spring",
  stiffness: 330,
  damping: 34,
  mass: 0.82,
} as const;

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
  experimentSlug?: string;
}

export function LangySidecar({
  proposalHandlersRef,
  experimentSlug,
}: LangySidecarProps) {
  const isOpen = useLangyStore((s) => s.isOpen);
  const toggle = useLangyStore((s) => s.togglePanel);
  useGlobalLangyShortcut(toggle);

  return (
    <>
      <LangyMarkGradientDefs />
      <LangyLauncher isOpen={isOpen} onOpen={toggle} />
      <LangyContextTargetLayer />
      <LangyPanel
        proposalHandlersRef={proposalHandlersRef}
        experimentSlug={experimentSlug}
      />
    </>
  );
}

/**
 * The closed-state opener — a single circular launcher in the bottom-right
 * corner (the Notion-AI model), NOT an edge chip. There is no reserved gutter
 * and no collapse tab: opening is this button, collapsing is the panel header's
 * ✕. Restrained on purpose — the LangWatch mark on a plain surface with a soft
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
        right="20px"
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
  experimentSlug,
}: {
  proposalHandlersRef?: React.RefObject<ProposalHandlers>;
  experimentSlug?: string;
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
  const restoreChip = useLangyStore((s) => s.restoreChip);
  // Context handed to Langy by a surface (home cards, briefing receipts). Shown
  // prominently in the sidebar and forwarded to the agent alongside the derived
  // page chips.
  const attachedContext = useLangyStore((s) => s.attachedContext);
  const detachContext = useLangyStore((s) => s.detachContext);
  const panelMode = useLangyStore((s) => s.panelMode);
  const floating = panelMode === "floating";
  const panelEffect = useLangyStore((s) => s.panelEffect);
  const reduceMotion = useReducedMotion();
  // The panel's own DOM node. The "fold" wave (<LangyWave>) reads its size off
  // it; nothing else needs it.
  const panelRef = useRef<HTMLDivElement>(null);
  const [devMode] = useLangyDevMode();
  const cardGalleryOpen = useLangyStore((s) => s.cardGalleryOpen);

  // ── Getting out of the drawer's way ───────────────────────────────────────
  // Drawers (the trace view among them) are right-anchored overlays, and the
  // floating panel is a right-anchored overlay. They were fighting for the same
  // corner: open a trace and the panel sat on top of it.
  //
  // So while a drawer is open, the floating card CROSSES TO THE OTHER SIDE —
  // it slides to the left edge and the drawer gets the right. Both are then
  // fully visible, which is the whole point of asking Langy about the thing you
  // just opened.
  //
  // The shift is computed from the viewport rather than measured off the
  // drawer's DOM: drawers vary in width and are rendered by a registry this
  // panel has no business reaching into, and a measurement would be a race with
  // the drawer's own open animation. Translating to the left EDGE is correct for
  // any drawer narrower than the space it leaves — which is all of them at a
  // normal viewport — and degrades gracefully rather than wrongly when it isn't
  // (the panel keeps its higher z-index, so it still floats ABOVE the drawer,
  // which is the behaviour originally asked for).
  const { currentDrawer } = useDrawer();
  const isDrawerOpen = !!currentDrawer;
  const viewportWidth = useViewportWidth();
  const floatingPanelWidth = resolveFloatingPanelWidth(viewportWidth);

  const drawerShiftX =
    floating && isDrawerOpen
      ? -Math.max(0, viewportWidth - floatingPanelWidth - PANEL_INSET * 2)
      : 0;

  const variants = useMemo(
    () => ({
      open: { opacity: 1, scale: 1, x: drawerShiftX, y: 0 },
      closed: floating ? FLOATING_CLOSED : SIDEBAR_CLOSED,
    }),
    [drawerShiftX, floating],
  );

  // Conversation-scoped client state belongs to the active project only; the
  // store is a module singleton that survives the per-project panel remount, so
  // wipe it on mount (a panel mount happens on first project entry / a project
  // switch — never on same-project navigation, which keeps the layout mounted).
  useEffect(() => {
    useLangyStore.getState().resetForProject();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Follow-the-stream scrolling, driven by a ResizeObserver on the content
  // rather than a dep list — Stream B's optimistic tokens and the turn signals
  // never pass through `messages`, so the old `[messages, status]` effect never
  // fired for them and the answer streamed off the bottom of the panel.
  const { scrollRef, contentRef, endRef, isPinned, canScroll, jumpToLatest } =
    useLangyStickToBottom();

  // The turn's request inputs, read at SEND time from a ref the render keeps
  // fresh (populated below, once the chips are resolved). The transport owns
  // these — which is what makes `regenerate()` (no per-send body) carry the
  // projectId + context, killing the old "Try again" 400.
  const turnContextRef = useRef<LangyTurnRequestContext | null>(null);

  // The custom transport (memoised once): POSTs the turn to /langy/chat, then
  // bridges the `langy.onTurnStream` tRPC subscription into the UIMessageChunk
  // stream useChat consumes. Conversation/turn adoption + status/progress
  // signals are pushed straight into the store (getState), so no ref plumbing.
  const transport = useMemo(
    () =>
      createLangyChatTransport({
        getContext: () => {
          const ctx = turnContextRef.current;
          if (!ctx) throw new Error("Langy turn context not ready");
          return ctx;
        },
        onIds: ({ conversationId, turnId }) => {
          const store = useLangyStore.getState();
          store.adoptConversation(conversationId);
          store.setActiveTurnId(turnId);
          // A fresh turn — clear the previous turn's status line.
          store.resetTurnSignals();
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
        onTurnSettled: () => {
          // The turn ended: drop the live status line. The streamed message
          // stands as the view; the durable fold is canonical on reload.
          useLangyStore.getState().resetTurnSignals();
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
  // null/empty it falls back to all of the project's provider models.
  const virtualKeysQuery = api.virtualKeys.list.useQuery(
    { organizationId: organizationId ?? "" },
    {
      enabled: !!organizationId,
      staleTime: 300_000,
      refetchOnWindowFocus: false,
    },
  );
  const langyModelsAllowed = useMemo<string[] | null>(() => {
    const langyVk = virtualKeysQuery.data?.find(
      (vk) =>
        isLangyManagedVk(vk) &&
        vk.scopes.some(
          (s) => s.scopeType === "PROJECT" && s.scopeId === projectId,
        ),
    );
    const allowed = (langyVk?.config as { modelsAllowed?: string[] | null })
      ?.modelsAllowed;
    return allowed && allowed.length > 0 ? allowed : null;
  }, [virtualKeysQuery.data, projectId]);

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
    setMessages,
    error,
    regenerate,
    clearError,
  } = useChat({
    transport,
    onError: (error) => {
      // Global-handled errors (license / lite-member) are owned by their own
      // handler — leave them to it.
      if (isHandledByGlobalHandler(error)) return;
      // Every live turn failure is already surfaced inline — as the recovering
      // line, the GitHub connect card, or a <LangyError> card (see turnError and
      // the render branch below), which falls back to a generic card even for a
      // non-structured error. A toast would double the same failure on a second
      // surface, so we never raise one here: one calm surface only.
    },
  });

  const handleStop = useCallback(() => {
    void stop();
  }, [stop]);

  // ── Server state (React Query, via the langy tRPC router) ─────────────────
  const {
    items: conversations,
    isLoading: isLoadingConversations,
    isError: hasListError,
    error: listError,
    refetch: refetchConversations,
  } = useLangyConversationList();
  const {
    remove: removeConversation,
    rename: renameConversation,
    fork: forkConversation,
  } = useLangyConversationCommands();
  const {
    messages: historyMessages,
    lastError: historyLastError,
    isTurnInFlight: serverTurnInFlight,
    isFetching: isFetchingHistory,
  } = useLangyMessages(activeConversationId);

  // Push a settled server history into the chat engine. Gated on a USER
  // selection (`historyLoadConversationId`) so a background refetch — or the
  // server's projection of a conversation we just created — never clobbers the
  // live in-flight stream. `keepPreviousData` means the query can briefly hold
  // the prior conversation's rows, so we wait for the fetch to settle.
  // useChat's setMessages identity is not guaranteed stable across renders.
  // Capture it in a ref so the hydrate/clear effects key on real state changes
  // (a conversation-id transition) without re-firing every render — which would
  // loop against setMessages and wipe the in-flight turn.
  const setMessagesRef = useRef(setMessages);
  setMessagesRef.current = setMessages;

  const applyHistoryToEngine = useCallback((history: LangyMessageDto[]) => {
    const uiMessages = history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ id: m.id, role: m.role, parts: m.parts }));
    // Cast to setMessages's own parameter type rather than `ai`'s UIMessage:
    // useChat is typed via @ai-sdk/react's nested `ai`, a different version
    // than the app's direct `ai`, so an `ai` UIMessage[] isn't assignable.
    setMessagesRef.current(
      uiMessages as unknown as Parameters<typeof setMessages>[0],
    );
  }, []);

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

  const isBusy = status === "submitted" || status === "streaming";
  const [queuedMessages, setQueuedMessages] = useState<string[]>([]);
  const canDrainQueuedMessages = !isBusy && !serverTurnInFlight;
  const isEmpty = messages.length === 0;
  // The floating card's resting floor. While a turn is in flight we never fall
  // back to the empty floor, so sending from an empty thread steps UP
  // (340 → 410 → 520) instead of dropping to the minimised floor first and
  // bouncing back as the answer arrives.
  const restingFloorPx =
    isEmpty && !isBusy ? 340 : messages.length <= 1 ? 410 : 520;
  // High-water mark: within a single conversation the floor only ever RISES, so
  // a mid-thread send can't collapse the card down and back up as the view
  // momentarily clears and refills — the jarring full → minimised → half
  // bounce. It resets only once the thread is genuinely empty and idle (a fresh
  // or closed panel). Paired with the min-height CSS transition below, every
  // resulting size change eases instead of snapping.
  const floatingFloorHwmRef = useRef(restingFloorPx);
  if (isEmpty && !isBusy) {
    floatingFloorHwmRef.current = restingFloorPx;
  } else if (restingFloorPx > floatingFloorHwmRef.current) {
    floatingFloorHwmRef.current = restingFloorPx;
  }
  const floatingMinHeight = `min(${floatingFloorHwmRef.current}px, calc(80dvh - 12px))`;

  // The ambient wash earns its place on the home screen (nothing else is on the
  // surface) and while Langy is working (a slow drift reads as alive). "Working"
  // is the LIVE stream OR the durable running-turn signal, so the wash stays lit
  // through a silent-worker gap just like the thinking line does — a settled
  // conversation is just a document, no wash under the text.
  const showWash = isEmpty || isBusy || serverTurnInFlight;

  // The developer-mode card gallery takes over the message column entirely —
  // it is a lens onto the card kit, not something to interleave with a real
  // conversation. Guarded on devMode as well as the flag so it can never
  // survive a dev-mode toggle-off (the store clears it too; belt and braces).
  const showCardGallery = devMode && cardGalleryOpen;

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

  // What the sidebar renders: every held chip tagged by source, so removing one
  // routes to the right store action (dismiss a derived chip / detach an
  // attached one).
  const sidebarContextEntries = useMemo<SidebarContextEntry[]>(() => {
    const seen = new Set<string>();
    const entries: SidebarContextEntry[] = [];
    for (const chip of contextChips) {
      if (seen.has(chip.id)) continue;
      seen.add(chip.id);
      entries.push({ chip, source: "page" });
    }
    for (const chip of attachedChips) {
      if (seen.has(chip.id)) continue;
      seen.add(chip.id);
      entries.push({ chip, source: "attached" });
    }
    return entries;
  }, [contextChips, attachedChips]);

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
    // A new question opens a new recovery chain: the policy's attempt budget is
    // per-question, so the previous turn's spent attempts don't eat this one's.
    recovery.reset();
    // Consume the submitted draft immediately. The composer stays available
    // for a follow-up message while this turn runs; leaving the sent text in
    // the field makes it look unsent and causes an awkward visual jump once
    // the first assistant token arrives.
    setDraft("");
    try {
      // No per-send body: the custom transport sources projectId + conversation
      // + model + page context from `turnContextRef` (getContext) at
      // send time, so both a fresh send AND regenerate() carry the full context.
      await sendMessage({ role: "user", parts: [{ type: "text", text }] });
    } catch {
      // sendMessage surfaces the error via the useChat() error channel. Restore
      // the draft only if the user has not already started typing a follow-up.
      if (!useLangyStore.getState().draft.trim()) setDraft(text);
    }
  };
  const queueMessage = useCallback(
    (text: string) => {
      const next = text.trim();
      if (!next) return;
      setQueuedMessages((messages) => [...messages, next]);
      setDraft("");
    },
    [setDraft],
  );

  // Send exactly one queued message only after BOTH the live stream and the
  // durable turn state are idle. The latter avoids racing the worker's final
  // event with the next command on a slow projection.
  useEffect(() => {
    if (!canDrainQueuedMessages || queuedMessages.length === 0) return;
    const [next, ...rest] = queuedMessages;
    if (!next) return;
    setQueuedMessages(rest);
    void send(next);
  }, [canDrainQueuedMessages, queuedMessages, send]);
  /**
   * Walking away from the current conversation — New chat, switching, deleting
   * the active one — must reset the CHAT ENGINE too, not just the store. useChat
   * owns state Zustand cannot reach, and `setMessages([])` clears none of it:
   *
   *   - the ERROR. This is the bug people saw: start a new chat after a failed
   *     turn and the red error card is still sitting under an empty panel,
   *     because nothing ever cleared `useChat`'s error. `clearError()` is the
   *     only thing that does. (`stop()` is a no-op once the turn has errored —
   *     it returns early unless the status is streaming/submitted — so it was
   *     never going to.)
   *   - the PENDING AUTO-RETRY. The nastiest one: a recovery timer armed by the
   *     conversation you just left would fire `regenerate()` into the one you
   *     just opened, re-driving a turn you walked away from.
   *   - the MESSAGES. Cleared explicitly rather than via the
   *     `activeConversationId === null` effect, which only fires on a TRANSITION
   *     to null — so a new chat started from an already-null conversation (a
   *     first message that failed before the server adopted an id) left the dead
   *     messages on screen.
   *
   * One place, so the next field added here can't be forgotten in three.
   */
  const resetChatEngine = ({ clearMessages }: { clearMessages: boolean }) => {
    void stop();
    setQueuedMessages([]);
    clearError();
    recovery.reset();
    if (clearMessages) applyHistoryToEngine([]);
  };

  const handleNewChat = () => {
    resetChatEngine({ clearMessages: true });
    startNewConversation();
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

  const handleForkConversation = async (id: string) => {
    try {
      const forkedId = await forkConversation(id);
      // Let the normal history query hydrate the fork. We do not duplicate its
      // messages locally — the event-sourced operational projection owns them.
      handleSelectConversation(forkedId);
      toaster.create({
        title: "Chat forked",
        description: "A private copy is ready for your next idea.",
        type: "success",
        duration: 3000,
        meta: { closable: true },
      });
    } catch {
      toaster.create({
        title: "Langy",
        description: "Failed to fork conversation.",
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

  // Default (non-directive) feedback is throttled so we don't nag; a
  // [langy:feedback] directive from Langy bypasses this in MessageContent.
  const canAskFeedback = useMemo(() => shouldAskFeedback(), [messages.length]);

  // Granular streaming state (PR3 transport seam) + domain-error rendering.
  const turnSignals = useLangyTurnSignals(activeConversationId);
  const hasTurnDetail =
    !!turnSignals.status ||
    turnSignals.progress !== null ||
    (turnSignals.metrics?.length ?? 0) > 0;
  const turnError = useMemo(() => {
    // The LIVE failure. Two roads reach `error`, and BOTH must be classified:
    //  - a turn-START rejection from the create/continue MUTATION carries the
    //    domain error on `error.data.domainError` → readLangyTrpcError;
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
    (isBusy || serverTurnInFlight) &&
    !turnError &&
    !recovery.isRecovering &&
    !needsGithubConnect;

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
    turnInFlight: isBusy || serverTurnInFlight,
    isSettling: !!turnError || recovery.isRecovering,
    hasLiveReasoning: !!turnSignals.reasoning,
    messages: messages as unknown as Parameters<
      typeof deriveWaveActivity
    >[0]["messages"],
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

  const subtitle = experimentSlug
    ? `On: ${experimentSlug}`
    : isEmpty
      ? "Your AI copilot"
      : "Working in this project";

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
      <MotionBox
        ref={panelRef}
        className="langy-root"
        // `layout` turns the same mounted surface from a full-height dock into a
        // floating card (and back) without a teleport. It also picks up the
        // drawer-clearance x shift, so all placement changes share one motion
        // language rather than competing CSS transitions.
        layout
        position="fixed"
        // The dock is deliberately slimmer than the floating card — see
        // SIDEBAR_PANEL_WIDTH.
        width={floating ? FLOATING_PANEL_CSS_WIDTH : `${SIDEBAR_PANEL_WIDTH}px`}
        // Dialogs, drawers, and command surfaces must be able to cover Langy.
        zIndex={1200}
        background="bg.surface"
        borderStyle="solid"
        // The brand's workhorse hairline (white/10 on dark, a warm paper line on
        // light) — `border.muted` was too faint to hold a floating card's edge.
        borderColor="border"
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
        // grows (send: 340 → 410 → 520), but also the 80dvh cap. Transform-driven
        // open/close and the drawer cross-shift are motion's own inline transform;
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
                // The 80vh silhouette is handsome on a normal display, but on a
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
        {...(floating
          ? {
              // Anchored bottom-right, growing UPWARD. The 80vh cap (never cover
              // the top fifth of the page) is the rule. The resting floor is
              // deliberately short — a compact card at rest that GROWS with its
              // conversation up to the cap, rather than opening as a tall stub over
              // an empty thread. (Dynamic content-driven sizing is the next step.)
              right: `${PANEL_INSET}px`,
              bottom: `${PANEL_INSET}px`,
              height: "auto",
              minHeight: floatingMinHeight,
              maxHeight: "calc(80dvh - 12px)",
              // Floating reads as glass: a touch translucent over a blur of the
              // page behind it. (Sidebar stays fully opaque — it's docked, not
              // floating over content.)
              background: "bg.surface/88",
              backdropFilter: "blur(16px) saturate(1.1)",
              borderWidth: "1px",
              borderRadius: "20px",
              boxShadow:
                "0 1px 2px rgba(20,20,23,0.04), 0 12px 28px rgba(20,20,23,0.10), 0 32px 64px rgba(20,20,23,0.10)",
              _dark: {
                // The stacked drop shadows give depth from OUTSIDE; the inset
                // hairline gives the top edge a lit rim from INSIDE, so the panel
                // reads as a raised object catching light rather than a flat cut-
                // out. white/12 — one notch above the border's white/10.
                boxShadow:
                  "0 1px 2px rgba(0,0,0,0.4), 0 12px 28px rgba(0,0,0,0.5), 0 32px 64px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.12)",
              },
            }
          : {
              top: 0,
              right: 0,
              bottom: 0,
              borderLeftWidth: "1px",
              borderTopLeftRadius: 0,
              borderBottomLeftRadius: 0,
              boxShadow: "none",
            })}
      >
        {/* Texture, under the content (which stacks at zIndex 1) and inert to the
          pointer. Exactly one of these is ever visible: grain on paper, the
          site's signal grid on ink. CSS does the switch — see langyTheme.css. */}
        {floating ? <Box className="langy-grain" aria-hidden /> : null}
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
            subtitle={subtitle}
            conversationTitle={conversationTitle}
            onNewChat={handleNewChat}
            onClose={closePanel}
            conversations={conversations}
            isLoadingConversations={isLoadingConversations}
            hasListError={hasListError}
            onSelectConversation={handleSelectConversation}
            onDeleteConversation={(id) => void handleDeleteConversation(id)}
            onForkConversation={handleForkConversation}
            onRenameConversation={handleRenameConversation}
          />
          {/* Docked only: the context Langy is holding, shown loud with remove
            affordances. The floating card keeps its compact composer summary
            (it floats over the page and must stay small); the dock has the room
            and the "working alongside you" job, so it makes context explicit. */}
          {!floating ? (
            <LangySidebarContext
              entries={sidebarContextEntries}
              addableChips={addableChips}
              onRemovePage={dismissChip}
              onDetach={detachContext}
              onAdd={restoreChip}
            />
          ) : null}
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
                    <Text fontSize="xs" color="fg.muted">
                      Add a provider key and pick a default model — Langy starts
                      working the moment you save.
                    </Text>
                    <ModelProviderScreen
                      variant="langy"
                      onComplete={() => void resolvedDefaultQuery.refetch()}
                    />
                  </VStack>
                ) : isEmpty ? (
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
                        // yet succeed.
                        showFeedback={
                          !isBusy &&
                          !turnError &&
                          !recovery.isRecovering &&
                          message.role === "assistant" &&
                          index === messages.length - 1 &&
                          canAskFeedback
                        }
                        // (No connect-card prop: MessageContent no longer sniffs
                        // the prose for `[langy:connect-github]`. The connect card
                        // is driven by the structured `langy_github_not_connected`
                        // error below — one road, not two.)
                      />
                    ))}
                    {turnInFlight ? (
                      <>
                        {/* Reasoning is independent from status/progress. The old
                          either/or hid it as soon as any progress frame existed,
                          which is most useful turns. */}
                        {turnSignals.reasoning ? (
                          <LangyThinkingLine
                            messages={messages}
                            reasoning={turnSignals.reasoning}
                          />
                        ) : null}
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
                        ) : !turnSignals.reasoning &&
                          !hasInlineProgressOwner ? (
                          <LangyThinkingLine messages={messages} />
                        ) : null}
                      </>
                    ) : null}
                    {/* Recovering beats failing. While the policy has a retry
                    pending, the turn is — as far as the user is concerned —
                    still in flight, so it reads as a quiet status line, not a
                    red card asking them to do something they need not do. The
                    card appears only once the policy has given up, or never had
                    a retry to give (a lost session, an unknown error). */}
                    {recovery.isRecovering && recovery.message ? (
                      <LangyRecoveringLine message={recovery.message} />
                    ) : needsGithubConnect && organizationId ? (
                      // NOT an error. A missing integration is a setup step, so it
                      // surfaces as the connect card, inline, at the point in the
                      // conversation where Langy needed it — never a red card and
                      // never a toast. This is what the explainer's `suppress` mode
                      // has always meant ("show the connect card instead"); it just
                      // had no producer and no caller until now.
                      <LangyGitHubConnectCard
                        organizationId={organizationId}
                        onConnected={onGithubConnected}
                      />
                    ) : turnError && !recovery.willAutoRecover ? (
                      // `!willAutoRecover` is belt-and-braces with the recovering
                      // branch above: it pins the card OUT the moment a failure is
                      // known to be auto-retryable, so it cannot flash for a frame
                      // before the retry timer arms — recovering beats failing from
                      // the very first paint.
                      <LangyError
                        presentation={turnError}
                        onAction={onErrorAction}
                      />
                    ) : null}
                  </VStack>
                )}
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
          <Composer
            model={modelOverride}
            modelOptions={modelOptions}
            langyDefaultModel={langyDefaultModel}
            onModelChange={setModelOverride}
            onSend={send}
            onQueue={queueMessage}
            onStop={handleStop}
            variant={floating ? "floating" : "sidebar"}
            isBusy={isBusy}
            queuedCount={queuedMessages.length}
            disabled={!projectId}
            // ALL chips — page-derived AND explicitly attached (home-briefing
            // investigate/attach) — so the `#` palette can reference everything
            // the conversation will actually be given.
            contextChips={allContextChips}
            onRemoveChip={dismissChip}
            addableChips={addableChips}
            onAddChip={restoreChip}
            onKindIntent={onKindIntent}
          />
        </VStack>
      </MotionBox>
    </Profiler>
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
  subtitle,
  conversationTitle,
  onNewChat,
  onClose,
  conversations,
  isLoadingConversations,
  hasListError,
  onSelectConversation,
  onDeleteConversation,
  onForkConversation,
  onRenameConversation,
}: {
  subtitle: string;
  /** The conversation's GENERATED title, or null while it has none yet. */
  conversationTitle: string | null;
  onNewChat: () => void;
  onClose: () => void;
  conversations: React.ComponentProps<typeof RecentChatsMenu>["conversations"];
  isLoadingConversations: boolean;
  hasListError: boolean;
  onSelectConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onForkConversation: (id: string) => Promise<void>;
  onRenameConversation: (id: string, title: string) => Promise<void>;
}) {
  const panelMode = useLangyStore((s) => s.panelMode);
  const setPanelMode = useLangyStore((s) => s.setPanelMode);
  const dockedToSide = panelMode === "sidebar";

  return (
    <>
      {/* A chat app's header, not a toolbar. Identity LEADS: the title doubles
          as the recents dropdown and TRUNCATES, so a long title can never shove
          the controls off the edge (it used to). Then the actions — compose,
          Foundry, dock, more — and finally the exit, held apart by a divider so
          Close is unmistakably the last control and never lost in a row of
          look-alike ghost icons. No avatar (the mark lives on the launcher and
          above the empty state), no permanent GitHub icon (that connect lives
          in the conversation, where it matters). */}
      <HStack
        paddingTop="13px"
        paddingBottom="12px"
        paddingLeft="12px"
        paddingRight="10px"
        gap={1}
        flexShrink={0}
      >
        {/* The TITLE IS the history control — the pattern every chat app uses,
            and it retires a whole icon from the rail. RecentChatsMenu is
            re-parented onto it (same list, same select, same delete); when
            there is nothing to list it renders the title bare, so an empty
            account never gets a dropdown that opens onto nothing. */}
        <RecentChatsMenu
          conversations={conversations}
          isLoading={isLoadingConversations}
          hasError={hasListError}
          onSelect={onSelectConversation}
          onDelete={onDeleteConversation}
          onFork={onForkConversation}
          onRename={onRenameConversation}
          placement="bottom-start"
          trigger={
            <HeaderTitleTrigger
              conversationTitle={conversationTitle}
              subtitle={subtitle}
            />
          }
        />

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

          <LangyFoundryMenu />

          {/* Dock ⇄ pop-out: the "minimize"/place control, now a real button in
              the rail instead of buried in the overflow menu. */}
          <Tooltip
            content={dockedToSide ? "Pop out" : "Dock to side"}
            positioning={{ placement: "bottom" }}
          >
            <IconButton
              size="xs"
              variant="ghost"
              aria-label={
                dockedToSide
                  ? "Pop out into a floating panel"
                  : "Dock to the side"
              }
              color="fg.muted"
              onClick={() =>
                setPanelMode(dockedToSide ? "floating" : "sidebar")
              }
            >
              {dockedToSide ? (
                <AppWindow size={15} />
              ) : (
                <PanelRight size={15} />
              )}
            </IconButton>
          </Tooltip>

          <LangyOverflowMenu />

          {/* The exit stands apart — Close is always the rightmost control. */}
          <Box
            width="1px"
            alignSelf="stretch"
            marginY="4px"
            marginX="3px"
            background="border"
          />

          <Tooltip content="Close" positioning={{ placement: "bottom" }}>
            <IconButton
              size="xs"
              variant="ghost"
              aria-label="Close Langy"
              color="fg.muted"
              onClick={onClose}
            >
              <X size={15} />
            </IconButton>
          </Tooltip>
        </HStack>
      </HStack>
      <Separator />
    </>
  );
}

/**
 * The header's title block, doubling as the recents dropdown trigger.
 *
 * Idle it is TEXT — no border, no background, no button chrome; the chevron is
 * invisible. On hover, on `:focus-visible`, and while the menu is open it grows
 * a faint surface and reveals the chevron, so the affordance is discoverable
 * without the header permanently looking like a row of buttons.
 *
 * It is a real `<button>`, so it is tabbable and Enter/Space open the menu.
 * `forwardRef` + prop-spreading matter here: Chakra's `Menu.Trigger asChild`
 * clones this element and needs to land its ref and its aria/data attributes on
 * the DOM node.
 */
const HeaderTitleTrigger = forwardRef<
  HTMLButtonElement,
  {
    conversationTitle: string | null;
    subtitle: string;
  } & React.ButtonHTMLAttributes<HTMLButtonElement>
>(function HeaderTitleTrigger({ conversationTitle, subtitle, ...rest }, ref) {
  return (
    <chakra.button
      ref={ref}
      type="button"
      // Sans, deliberately. Sentient is a DISPLAY face — it belongs on the empty
      // state's one big line, not on chrome. Once the title reactor lands a
      // generated title it REPLACES the wordmark, written in with the same
      // blur-reveal the recents list uses. Until then there is no title at all —
      // no skeleton, no id, no "New chat" stand-in. Absent, then present.
      {...rest}
      display="flex"
      alignItems="center"
      gap={1}
      flex={1}
      minWidth={0}
      textAlign="left"
      paddingX={1.5}
      paddingY={1}
      borderRadius="8px"
      background="transparent"
      cursor="pointer"
      transition="background 130ms ease"
      _hover={{ background: "bg.subtle" }}
      _focusVisible={{ outline: "none", background: "bg.subtle" }}
      css={{
        "&:hover .title-chev, &:focus-visible .title-chev, &[data-state='open'] .title-chev":
          { opacity: 1 },
      }}
    >
      <VStack align="start" gap={0} flex={1} minWidth={0}>
        <Box
          textStyle="sm"
          fontWeight="600"
          letterSpacing="-0.01em"
          lineHeight="1.25"
          color="fg"
          width="full"
          // minWidth:0 lets this shrink below the title's intrinsic width so the
          // ellipsis engages instead of the title pushing the header controls
          // off the panel's edge — the whole point of the truncation chain here
          // and inside AnimatedConversationTitle.
          minWidth={0}
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
        <Text
          textStyle="2xs"
          color="fg.muted"
          lineHeight="1.3"
          marginTop="1px"
          truncate
          width="full"
        >
          {subtitle}
        </Text>
      </VStack>
      <Box
        className="title-chev"
        color="fg.subtle"
        opacity={0}
        flexShrink={0}
        transition="opacity 130ms ease"
        display="grid"
        placeItems="center"
      >
        <ChevronDown size={14} />
      </Box>
    </chakra.button>
  );
});

/**
 * The header's overflow — one `⋯` for everything that is a SETTING rather than
 * an action you take mid-conversation.
 *
 * Layout (Floating / Sidebar, persisted) and developer mode each used to own a
 * permanent icon on a six-button rail in a 380px header. Neither is touched
 * more than once in a session, so both live here now and the rail is down to
 * the three things you actually reach for.
 */
function LangyOverflowMenu() {
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
          RecentChatsMenu and LangyFoundryMenu already did this; this menu was
          the one that didn't. */}
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
