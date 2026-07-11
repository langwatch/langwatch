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
import { DefaultChatTransport, type UIMessage } from "ai";
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
  SquarePen,
  X,
} from "lucide-react";
import {
  forwardRef,
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
import { LangyCardGallery } from "./LangyCardGallery";
import { EmptyState } from "./EmptyState";
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
import { useLangyConversationList } from "../data/useLangyConversationList";
import { useLangyConversationCommands } from "../data/useLangyConversationCommands";
import { useLangyMessages } from "../data/useLangyMessages";
import type { LangyMessageDto } from "../data/langy.dtos";
import { useLangyFreshness } from "../hooks/useLangyFreshness";
import { useLangyFastStream } from "../hooks/useLangyFastStream";
import { useLangyStickToBottom } from "../hooks/useLangyStickToBottom";
import { useLangyTurnSignals } from "../hooks/useLangyTurnSignals";
import { type LangyPanelMode, useLangyStore } from "../stores/langyStore";
import { Menu } from "~/components/ui/menu";
import { useLangyPageContext } from "../hooks/useLangyPageContext";
import { findSkill } from "~/shared/langy/langySkills";
// ONE definition of the wire shape, server-side, imported by both ends — the
// route spreads `langyTurnContextSchema.shape` into its body schema, and this
// types the payload against the same source. If the route stops accepting a
// field, this stops compiling. That is the whole point: the last time these two
// drifted, `safeParse` silently dropped `pageContext` on every single turn and
// nobody found out for weeks.
import type {
  LangyResourceContext,
  LangySkillContext,
} from "~/server/services/langy/langyTurnContext.schema";
import { LangyError } from "./LangyError";
import { LangyRecoveringLine } from "./LangyRecoveringLine";
import { LangyThinkingLine } from "./LangyThinkingLine";
import { StreamingStatusLine } from "./StreamingStatusLine";
import {
  explainLangyError,
  readLangyStreamError,
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

// Wide enough that a trace table, a diff or a capability card can breathe — the
// 380px sidecar forced everything into a column of two-word lines. Still a
// sidecar, not a split view: the page keeps the majority of the viewport.
const PANEL_WIDTH = 468;

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
const DOCK_RADIUS = 18;

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
const DOCK_OVERLAP = DOCK_RADIUS;

// Sidebar mode pushes page content left by the dock width MINUS the overlap
// above; Floating mode overlays and reserves nothing (see LangyShiftedRoot,
// which pads only in sidebar mode).
export const LANGY_DOCKED_OFFSET = PANEL_WIDTH - DOCK_OVERLAP;
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
  x: PANEL_WIDTH,
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
        type="button"
        className="langy-root"
        onClick={onOpen}
        aria-label="Open Langy assistant"
        aria-keyshortcuts="Meta+I Control+I"
        position="fixed"
        bottom="20px"
        right="20px"
        zIndex={1600}
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
        transition="transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease"
        _hover={{
          transform: "translateY(-2px)",
          borderColor: "orange.emphasized",
          boxShadow:
            "0 2px 4px rgba(20,20,23,0.10), 0 12px 32px rgba(20,20,23,0.18)",
        }}
      >
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

  // ── Client/UI state (single store) ────────────────────────────────────────
  const isOpen = useLangyStore((s) => s.isOpen);
  const closePanel = useLangyStore((s) => s.closePanel);
  const draft = useLangyStore((s) => s.draft);
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
  const activeTurnId = useLangyStore((s) => s.activeTurnId);
  const optimisticStreamText = useLangyStore((s) => s.optimisticText);
  const appliedOutcomes = useLangyStore((s) => s.appliedOutcomes);
  const discardedProposalIds = useLangyStore((s) => s.discardedProposalIds);
  const applyingProposalIds = useLangyStore((s) => s.applyingProposalIds);
  const markProposalApplying = useLangyStore((s) => s.markProposalApplying);
  const markProposalApplied = useLangyStore((s) => s.markProposalApplied);
  const clearProposalApplying = useLangyStore((s) => s.clearProposalApplying);
  const discardProposalInStore = useLangyStore((s) => s.discardProposal);
  const dismissChip = useLangyStore((s) => s.dismissChip);
  const restoreChip = useLangyStore((s) => s.restoreChip);
  const skillChips = useLangyStore((s) => s.skillChips);
  const addSkillChip = useLangyStore((s) => s.addSkillChip);
  const removeSkillChip = useLangyStore((s) => s.removeSkillChip);
  const setSkillTarget = useLangyStore((s) => s.setSkillTarget);
  const clearSkillChips = useLangyStore((s) => s.clearSkillChips);

  // The palette hands back a skill ID; the label is resolved from the real
  // catalogue so a chip can never carry a name the catalogue doesn't recognise.
  const addSkill = useCallback(
    (id: string) => {
      const skill = findSkill(id);
      if (!skill) return;
      addSkillChip({ id: skill.id, label: skill.label });
    },
    [addSkillChip],
  );
  const panelMode = useLangyStore((s) => s.panelMode);
  const floating = panelMode === "floating";
  const reduceMotion = useReducedMotion();
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

  const drawerShiftX =
    floating && isDrawerOpen
      ? -Math.max(0, viewportWidth - PANEL_WIDTH - PANEL_INSET * 2)
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

  // The chat transport (memoised once) writes conversation-adoption + the
  // Stream-B turn id straight into the store via getState(), so it never needs
  // recreating and no ref plumbing is required.
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/langy/chat",
        fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
          const response = await fetch(input, init);
          // Adopt the conversation the server created / reused so the NEXT send
          // stays in it instead of forking a fresh one (and a fresh worker,
          // keyed by conversation id).
          const conversationId = response.headers.get(
            "x-langy-conversation-id",
          );
          if (conversationId) {
            useLangyStore.getState().adoptConversation(conversationId);
          }
          // Capture the turn id for the Stream B fast-path (ADR-048), available
          // as soon as the headers arrive — before body streaming — so we
          // subscribe during spawn latency and miss no visible tokens.
          const turnId = response.headers.get("x-langy-turn-id");
          if (turnId) useLangyStore.getState().setActiveTurnId(turnId);
          return response;
        }) as typeof fetch,
      }),
    [],
  );

  // Seed the picker with the model the gate currently resolves to. Once the
  // user picks something different, we don't overwrite — they're explicitly
  // choosing per-session. Only seed on first valid response.
  const resolvedDefaultQuery = api.modelProvider.getResolvedDefault.useQuery(
    { projectId: projectId ?? "", featureKey: LANGY_GATE_FEATURE_KEY },
    { enabled: !!projectId },
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
    { enabled: !!organizationId },
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
      if (isHandledByGlobalHandler(error)) return;
      // A structured domain error renders as an inline <LangyError> card (see
      // turnError below); don't also toast it — one calm surface only.
      if (readLangyStreamError(error.message)) return;
      toaster.create({
        title: "Langy error",
        description: error.message,
        type: "error",
        duration: 5000,
        meta: { closable: true },
      });
    },
  });

  // ── Server state (React Query, via the langy tRPC router) ─────────────────
  const {
    items: conversations,
    isLoading: isLoadingConversations,
    isError: hasListError,
  } = useLangyConversationList();
  const { remove: removeConversation } = useLangyConversationCommands();
  const {
    messages: historyMessages,
    lastError: historyLastError,
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

  // Surface a one-time toast if the recents list fails to load.
  const listErrorToastedRef = useRef(false);
  useEffect(() => {
    if (hasListError && !listErrorToastedRef.current) {
      listErrorToastedRef.current = true;
      toaster.create({
        title: "Langy",
        description: "Failed to load Langy conversations.",
        type: "error",
        duration: 5000,
        meta: { closable: true },
      });
    }
    if (!hasListError) listErrorToastedRef.current = false;
  }, [hasListError]);

  // Real-time coordinator: one SSE subscription for the whole panel. Applies
  // the pushed operational spine in place (or invalidates) so the recents list
  // and the open conversation's status stay fresh without heavy polling.
  useLangyFreshness(activeConversationId);

  const isBusy = status === "submitted" || status === "streaming";
  const isEmpty = messages.length === 0;

  // The ambient wash earns its place on the home screen (nothing else is on the
  // surface) and while Langy is working (a slow drift reads as alive). A
  // settled conversation is just a document — no wash under the text.
  const showWash = isEmpty || isBusy;

  // The developer-mode card gallery takes over the message column entirely —
  // it is a lens onto the card kit, not something to interleave with a real
  // conversation. Guarded on devMode as well as the flag so it can never
  // survive a dev-mode toggle-off (the store clears it too; belt and braces).
  const showCardGallery = devMode && cardGalleryOpen;

  // Stream B optimistic tokens for the in-flight turn (ADR-048). The hook
  // writes them into the store; enabled only while a turn is streaming.
  useLangyFastStream({
    projectId,
    conversationId: activeConversationId,
    turnId: activeTurnId,
    enabled: isBusy,
  });

  // Page context (task #14): the experiment / trace / dataset / project the
  // user is viewing, surfaced as removable composer chips and forwarded with
  // the turn.
  const { chips: contextChips, addableChips } = useLangyPageContext();

  const send = async (text: string) => {
    if (!text.trim() || !projectId || isBusy) return;
    // A new question opens a new recovery chain: the policy's attempt budget is
    // per-question, so the previous turn's spent attempts don't eat this one's.
    recovery.reset();
    try {
      await sendMessage(
        { role: "user", parts: [{ type: "text", text }] },
        {
          body: {
            projectId,
            // Stay in the active conversation; null/absent means "start a new
            // one" and the transport adopts the id the server returns.
            ...(activeConversationId
              ? { conversationId: activeConversationId }
              : {}),
            ...(modelOverride ? { modelOverride } : {}),
            // What the user is looking at, so the agent can resolve "this
            // experiment / trace" without an explicit id.
            // The turn's attached context, built to `langyTurnContextSchema` —
            // the ONE definition of this wire shape, which the chat route
            // spreads into its body schema. Typing the payload against the
            // schema is what stops the two ends drifting apart again: the last
            // time they did, `safeParse` silently dropped `pageContext` on every
            // single turn and nobody found out for weeks.
            ...(contextChips.length > 0
              ? {
                  pageContext: contextChips.map(
                    (chip): LangyResourceContext => ({
                      kind: chip.kind,
                      ref: chip.ref,
                      label: chip.label,
                    }),
                  ),
                }
              : {}),
            ...(skillChips.length > 0
              ? {
                  skills: skillChips.map((skill): LangySkillContext => {
                    // Resolve the association at SEND time, against the chips
                    // actually present. A skill bound to a chip the user has
                    // since removed sends unbound rather than pointing at a
                    // resource that is no longer part of the turn.
                    const target = contextChips.find(
                      (chip) => chip.id === skill.targetChipId,
                    );
                    return {
                      id: skill.id,
                      label: skill.label,
                      ...(target ? { on: target.label } : {}),
                    };
                  }),
                }
              : {}),
          },
        },
      );
      // Clear AFTER success so a failed send leaves the typed text — and the
      // skills the user chose — in place to retry with.
      setDraft("");
      // Skills steer ONE turn. Leaving "use GitHub" attached to the next message
      // would be the composer quietly making decisions for the user. Page
      // context is different: it describes where they still are, so it stays.
      clearSkillChips();
    } catch {
      // sendMessage surfaces the error via the useChat() error channel; keep
      // the draft populated so the user can retry without retyping.
    }
  };

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
    clearError();
    recovery.reset();
    if (clearMessages) applyHistoryToEngine([]);
  };

  const handleNewChat = () => {
    resetChatEngine({ clearMessages: true });
    startNewConversation();
  };

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

  const applyProposal = async (proposalId: string, proposal: LangyProposal) => {
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
          description: error instanceof Error ? error.message : "Unknown error",
          type: "error",
          duration: 5000,
          meta: { closable: true },
        });
      }
    } finally {
      clearProposalApplying(proposalId);
    }
  };

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
    // The LIVE failure, off the stream.
    if (error) {
      const domain = readLangyStreamError(error.message) ?? {
        kind: "unknown",
        meta: {},
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

  // A double-click on the card must not fire two turns.
  const githubRedrivenRef = useRef(false);
  useEffect(() => {
    if (isBusy) githubRedrivenRef.current = false;
  }, [isBusy]);

  const onGithubConnected = useCallback(() => {
    void utils.langyGithub.getConnection.invalidate({
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
    <MotionBox
      className="langy-root"
      position="fixed"
      width={`${PANEL_WIDTH}px`}
      zIndex={1500}
      background="bg.surface"
      borderStyle="solid"
      // The brand's workhorse hairline (white/10 on dark, a warm paper line on
      // light) — `border.muted` was too faint to hold a floating card's edge.
      borderColor="border"
      overflow="hidden"
      // The panel is the flex COLUMN itself, so its single in-flow child can
      // claim the full height. Without this the child's `height: 100%` resolves
      // against `height: auto` (floating mode) and collapses to content height —
      // which is what let the composer float up under a short conversation
      // instead of sitting on the panel's bottom edge.
      display="flex"
      flexDirection="column"
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
          : isOpen
            ? OPEN_TRANSITION
            : CLOSE_TRANSITION
      }
      {...(floating
        ? {
            // Anchored bottom-right, growing UPWARD. The 80vh cap (never cover
            // the top fifth of the page) is the rule; the floor now sits just
            // under it, so the card actually USES that space instead of
            // hovering as a stub over an empty conversation.
            right: `${PANEL_INSET}px`,
            bottom: `${PANEL_INSET}px`,
            height: "auto",
            minHeight: "min(640px, calc(80vh - 12px))",
            maxHeight: "calc(80vh - 12px)",
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
              boxShadow:
                "0 1px 2px rgba(0,0,0,0.4), 0 12px 28px rgba(0,0,0,0.5), 0 32px 64px rgba(0,0,0,0.5)",
            },
          }
        : {
            top: 0,
            right: 0,
            bottom: 0,
            borderLeftWidth: "1px",
            borderTopLeftRadius: `${DOCK_RADIUS}px`,
            borderBottomLeftRadius: `${DOCK_RADIUS}px`,
            boxShadow: "-16px 0 40px rgba(20,20,23,0.10)",
            _dark: { boxShadow: "-18px 0 48px rgba(0,0,0,0.5)" },
          })}
    >
      {/* Texture, under the content (which stacks at zIndex 1) and inert to the
          pointer. Exactly one of these is ever visible: grain on paper, the
          site's signal grid on ink. CSS does the switch — see langyTheme.css. */}
      <Box className="langy-grain" aria-hidden />
      <Box className="langy-signal-grid" aria-hidden />
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
        />
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
            transition={{ duration: reduceMotion ? 0 : 0.8, ease: "easeInOut" }}
          >
            <Box className="langy-wash" />
          </MotionBox>
          <Box
            ref={scrollRef}
            position="relative"
            flex={1}
            minHeight={0}
            overflowY="auto"
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
                (`display: flow-root` so a child's margin can't collapse through
                it and make the observed box shorter than what is drawn.) */}
            <Box ref={contentRef} display="flow-root">
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
                <EmptyState onPick={(prompt) => void send(prompt)} />
              ) : (
                <VStack
                  gap="16px"
                  align="stretch"
                  paddingX="19px"
                  paddingTop="19px"
                  paddingBottom="12px"
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
                      optimisticText={
                        isBusy &&
                        index === messages.length - 1 &&
                        message.role === "assistant"
                          ? optimisticStreamText
                          : undefined
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
                  {isBusy ? (
                    hasTurnDetail ? (
                      <StreamingStatusLine
                        status={turnSignals.status}
                        progress={turnSignals.progress}
                        metrics={turnSignals.metrics}
                        segment={turnSignals.segment}
                      />
                    ) : (
                      <LangyThinkingLine
                        messages={messages}
                        optimisticText={optimisticStreamText}
                      />
                    )
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
                  ) : turnError ? (
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
          input={draft}
          onInputChange={setDraft}
          model={modelOverride}
          modelOptions={modelOptions}
          onModelChange={setModelOverride}
          onSend={() => void send(draft)}
          onStop={() => void stop()}
          isBusy={isBusy}
          disabled={!projectId}
          canSend={!!draft.trim() && !isBusy && !!projectId}
          contextChips={contextChips}
          onRemoveChip={dismissChip}
          addableChips={addableChips}
          onAddChip={restoreChip}
          skillChips={skillChips}
          onAddSkill={addSkill}
          onRemoveSkill={removeSkillChip}
          onRetargetSkill={setSkillTarget}
        />
      </VStack>
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
  subtitle,
  conversationTitle,
  onNewChat,
  onClose,
  conversations,
  isLoadingConversations,
  hasListError,
  onSelectConversation,
  onDeleteConversation,
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
}) {
  return (
    <>
      {/* A chat app's header, not a toolbar: compose on the left, identity in
          the middle, settings and exit on the right. No avatar (the mark lives
          on the launcher and above the empty state's display line — a logo in
          the chrome of a panel you opened from a logo button is a tautology),
          and no GitHub button: a permanent icon for ONE integration is chrome
          that earns nothing, and connecting now happens where it matters, as a
          card in the conversation. */}
      <HStack
        paddingTop="13px"
        paddingBottom="12px"
        paddingLeft="10px"
        paddingRight="10px"
        gap={2}
        flexShrink={0}
      >
        <Tooltip content="New chat" positioning={{ placement: "bottom" }}>
          <IconButton
            size="xs"
            variant="ghost"
            aria-label="New chat"
            color="fg.muted"
            onClick={onNewChat}
            flexShrink={0}
          >
            <SquarePen size={15} />
          </IconButton>
        </Tooltip>

        {/* The TITLE IS the history control — the same pattern every chat app
            uses, and it retires a whole icon from the rail. RecentChatsMenu is
            re-parented onto it (same list, same select, same delete); when
            there is nothing to list it renders the title bare, so an empty
            account never gets a dropdown that opens onto nothing. */}
        <RecentChatsMenu
          conversations={conversations}
          isLoading={isLoadingConversations}
          hasError={hasListError}
          onSelect={onSelectConversation}
          onDelete={onDeleteConversation}
          placement="bottom-start"
          trigger={
            <HeaderTitleTrigger
              conversationTitle={conversationTitle}
              subtitle={subtitle}
            />
          }
        />

        <HStack gap={0} flexShrink={0} marginLeft="auto">
          <LangyFoundryMenu />
          <LangyOverflowMenu />
          <IconButton
            size="xs"
            variant="ghost"
            aria-label="Close Langy"
            color="fg.muted"
            onClick={onClose}
          >
            <X size={15} />
          </IconButton>
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
  const [devMode, setDevMode] = useLangyDevMode();
  const cardGalleryOpen = useLangyStore((s) => s.cardGalleryOpen);
  const toggleCardGallery = useLangyStore((s) => s.toggleCardGallery);
  const layouts: { mode: LangyPanelMode; label: string; icon: LucideIcon }[] = [
    { mode: "floating", label: "Floating", icon: AppWindow },
    { mode: "sidebar", label: "Sidebar", icon: PanelRight },
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

