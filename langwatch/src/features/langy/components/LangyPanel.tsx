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
import { ChevronsRight, Plus, Sparkles, X } from "lucide-react";
import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { isLangyManagedVk } from "~/components/gateway/langyVk";
import { allModelOptions } from "~/components/ModelSelector";
import { Kbd } from "~/components/ops/shared/Kbd";
import { toaster } from "~/components/ui/toaster";
import { Tooltip } from "~/components/ui/tooltip";
import { ModelProviderScreen } from "~/features/onboarding/components/sections/ModelProviderScreen";
import {
  AI_SHADOW,
  AI_SHADOW_SOFT,
  MeshGradientLayer,
  SparkleGradientDefs,
  SparkleTile,
  thinkingShimmerStyles,
} from "~/features/traces-v2/components/ai/aiBrandVisuals";
import { useCyclingVerb } from "~/features/traces-v2/components/ai/useCyclingVerb";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import { api } from "~/utils/api";
import { isHandledByGlobalHandler } from "~/utils/trpcError";
import { Composer } from "./Composer";
import { EmptyState } from "./EmptyState";
import { LANGY_THINKING_VERBS } from "./langyThinkingVerbs";
import { LangyDevModeToggle } from "./LangyDevModeToggle";
import { LangyGitHubMenu } from "./github/LangyGitHubMenu";
import {
  type LangyProposal,
  MessageContent,
  type ProposalHandlers,
} from "./MessageContent";
import { RecentChatsMenu } from "./RecentChatsMenu";
import { useGlobalLangyShortcut } from "../hooks/useGlobalLangyShortcut";
import {
  type LangyConversationSummary,
  type LangyMessageRecord,
  useLangyConversations,
} from "../data/useLangyConversations";
import { useLangyFreshness } from "../hooks/useLangyFreshness";
import { useLangyFastStream } from "../hooks/useLangyFastStream";
import { useLangyTurnSignals } from "../hooks/useLangyTurnSignals";
import { useLangyComposerStore } from "../stores/langyComposerStore";
import { useLangyPageContext } from "../hooks/useLangyPageContext";
import { LangyError } from "./LangyError";
import { StreamingStatusLine } from "./StreamingStatusLine";
import {
  explainLangyError,
  readLangyStreamError,
} from "../logic/langyErrorExplainer";
import { shouldAskFeedback } from "../logic/langyFeedbackDirective";

// The same feature key Langy's chat route resolves against. Used to seed the
// composer's model picker with whatever's actually resolving today — opening
// Langy on a project that already has a configured default model lands on
// THAT model, not on an unrelated branch-primary pick.
const LANGY_GATE_FEATURE_KEY = "prompt.create_default";

const PANEL_WIDTH = 380;
const PILL_WIDTH = 30;

// The panel docks flush against the right edge of the viewport. Page
// layouts coordinate via LANGY_DOCKED_OFFSET to keep content visible
// when the panel is open.
export const LANGY_DOCKED_OFFSET = PANEL_WIDTH;
export const LANGY_TRANSITION = "240ms cubic-bezier(0.32, 0.72, 0, 1)";

interface LangyDrawerProps {
  proposalHandlersRef?: RefObject<ProposalHandlers>;
  experimentSlug?: string;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function LangyDrawer({
  proposalHandlersRef,
  experimentSlug,
  isOpen: isOpenProp,
  onOpenChange,
}: LangyDrawerProps) {
  const isControlled = isOpenProp !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = isControlled ? isOpenProp : internalOpen;
  const setIsOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );
  const toggle = useCallback(() => setIsOpen(!isOpen), [isOpen, setIsOpen]);
  useGlobalLangyShortcut(toggle);

  return (
    <>
      <SparkleGradientDefs />
      <LangyHandle isOpen={isOpen} onToggle={toggle} />
      <LangyPanel
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        proposalHandlersRef={proposalHandlersRef}
        experimentSlug={experimentSlug}
      />
    </>
  );
}

function LangyHandle({
  isOpen,
  onToggle,
}: {
  isOpen: boolean;
  onToggle: () => void;
}) {
  const [hover, setHover] = useState(false);
  const button = (
    <chakra.button
      type="button"
      onClick={onToggle}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-label={isOpen ? "Hide Langy" : "Open Langy assistant"}
      aria-keyshortcuts="Meta+I Control+I"
      position="fixed"
      right={isOpen ? `${PANEL_WIDTH}px` : 0}
      top="50%"
      width={`${PILL_WIDTH}px`}
      paddingY="14px"
      zIndex={1600}
      cursor="pointer"
      borderTopLeftRadius="999px"
      borderBottomLeftRadius="999px"
      // Two personalities. Closed: the loud branded opener (mesh gradient,
      // LANGY wordmark). Open: a quiet collapse tab that reads as a notch of
      // the panel itself — same surface, same hairline, only a whisper of a
      // shadow — so it stops looking like a button floating over the page.
      background={isOpen ? "bg.surface" : "transparent"}
      borderWidth="1px"
      borderStyle="solid"
      borderColor={isOpen ? "border.muted" : "rgba(255,255,255,0.18)"}
      borderRightWidth={0}
      color={isOpen ? "fg.muted" : "white"}
      boxShadow={
        isOpen
          ? hover
            ? "-3px 0 8px rgba(12,18,30,0.08)"
            : "-2px 0 5px rgba(12,18,30,0.05)"
          : hover
            ? AI_SHADOW
            : AI_SHADOW_SOFT
      }
      _hover={isOpen ? { background: "bg.muted", color: "fg" } : undefined}
      transform={hover ? "translate(-2px, -50%)" : "translateY(-50%)"}
      transition={`right ${LANGY_TRANSITION}, background 180ms ease, color 180ms ease, transform 180ms ease, box-shadow 180ms ease`}
      overflow="hidden"
    >
      {!isOpen && <MeshGradientLayer active={hover} />}
      <VStack
        gap={2}
        align="center"
        justify="center"
        position="relative"
        zIndex={1}
      >
        {isOpen ? (
          <ChevronsRight size={16} />
        ) : (
          <>
            <Sparkles size={14} color="white" />
            <Text
              textStyle="2xs"
              fontWeight="700"
              letterSpacing="0.12em"
              color="white"
              style={{
                writingMode: "vertical-rl",
                textOrientation: "mixed",
              }}
            >
              LANGY
            </Text>
          </>
        )}
      </VStack>
    </chakra.button>
  );

  return (
    <Tooltip
      content={
        <HStack gap={2}>
          <Text>{isOpen ? "Hide Langy" : "Open Langy"}</Text>
          <HStack gap={1}>
            <Kbd>⌘</Kbd>
            <Kbd>I</Kbd>
          </HStack>
        </HStack>
      }
      positioning={{ placement: "left" }}
      openDelay={200}
    >
      {button}
    </Tooltip>
  );
}

function LangyPanel({
  isOpen,
  onClose,
  proposalHandlersRef,
  experimentSlug,
}: {
  isOpen: boolean;
  onClose: () => void;
  proposalHandlersRef?: RefObject<ProposalHandlers>;
  experimentSlug?: string;
}) {
  const { organization, project } = useOrganizationTeamProject();
  const projectId = project?.id;
  const organizationId = organization?.id;
  const utils = api.useUtils();

  const [input, setInput] = useState("");
  // Per-session model override for the next send. Empty string = "use whatever
  // the project DEFAULT resolves to" — i.e. don't pass modelOverride. The
  // composer's picker writes here, and `send()` reads + forwards it as the
  // body's `modelOverride` field for the chat route to honor.
  const [modelOverride, setModelOverride] = useState<string>("");
  const [appliedOutcomes, setAppliedOutcomes] = useState<
    Record<string, { href?: string; label?: string; onOpen?: () => void }>
  >({});
  const [discardedProposals, setDiscardedProposals] = useState<Set<string>>(
    new Set(),
  );
  const [applyingProposals, setApplyingProposals] = useState<Set<string>>(
    new Set(),
  );
  const scrollRef = useRef<HTMLDivElement>(null);

  // Stream B (ADR-048): the chat route returns the turn id in `x-langy-turn-id`.
  // We capture it to open the raw-token fast-path SSE. `setActiveTurnId` is a
  // stable useState setter, so the transport (memoised once) can close over it.
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);

  // Filled in below once useLangyConversations runs; the transport's fetch
  // closes over the ref so the transport itself never needs recreating.
  const adoptConversationRef = useRef<(id: string) => void>(() => undefined);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/langy/chat",
        // The chat route returns the conversation it created (or reused) in
        // this header. Adopt it so the NEXT send carries `conversationId` —
        // without this every message forks a fresh conversation (and a fresh
        // OpenCode worker, which is keyed by conversation id).
        fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
          const response = await fetch(input, init);
          const conversationId = response.headers.get(
            "x-langy-conversation-id",
          );
          if (conversationId) adoptConversationRef.current(conversationId);
          // Capture the turn id for the Stream B fast-path (ADR-048). Available
          // as soon as the response headers arrive — before body streaming —
          // so we subscribe during spawn latency and miss no visible tokens.
          const turnId = response.headers.get("x-langy-turn-id");
          if (turnId) setActiveTurnId(turnId);
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
  // type into a dead composer. The onboarding model-provider screen writes
  // BOTH the key and the project default for LANGY_GATE_FEATURE_KEY — exactly
  // what the gate resolves against — so saving unblocks Langy with no reload.
  const langyNeedsModel =
    !!projectId &&
    !resolvedDefaultQuery.isLoading &&
    !resolvedDefaultQuery.data?.model;

  // The project's Langy VK carries an optional `modelsAllowed` allowlist
  // (configured in the VK editor). When set, the composer's picker is
  // narrowed to exactly those models; when null/empty it falls back to all
  // of the project's provider models. VKs are org-scoped, so we list the
  // org's keys and pick the auto-managed Langy VK scoped to THIS project.
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

  // Options the picker offers. Two-stage filter:
  //   1. langyModelsAllowed (VK allowlist) narrows the universe to admin-
  //      approved models when set; null = "no explicit allowlist".
  //   2. ModelSelector internally further narrows by the project's actually-
  //      enabled providers (getCustomModels → enabled+mode filter), so even
  //      when the VK is unconstrained the dropdown shows ONLY models the
  //      project can run today.
  // The /langy/chat route mirrors the VK-allowlist check server-side so
  // tampered clients can't pick something that's been disallowed.
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
  }, [resolvedDefaultQuery.data?.model, modelOverride, langyModelsAllowed]);

  // Race fix: if the allowlist lands AFTER we seeded an out-of-list model,
  // snap to the first allowed model. Safe because under an allowlist the
  // picker only offers allowed models, so an out-of-list value can only be a
  // stale seed, never a user choice.
  useEffect(() => {
    if (!langyModelsAllowed) return;
    if (modelOverride && !langyModelsAllowed.includes(modelOverride)) {
      setModelOverride(langyModelsAllowed[0]!);
    }
  }, [langyModelsAllowed, modelOverride]);
  const { messages, sendMessage, stop, status, setMessages, error } = useChat({
    transport,
    onError: (error) => {
      if (isHandledByGlobalHandler(error)) return;
      // A structured domain error renders as an inline <LangyError> card
      // (see turnError below); don't also toast it — one calm surface only.
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

  const surfaceConversationError = useCallback((message: string) => {
    toaster.create({
      title: "Langy",
      description: message,
      type: "error",
      duration: 5000,
      meta: { closable: true },
    });
  }, []);

  const applyMessagesFromHistory = useCallback(
    (history: LangyMessageRecord[]) => {
      const uiMessages = history.map((m) => ({
        id: m.id,
        role: m.role,
        parts: [{ type: "text" as const, text: m.content }],
      }));
      // Cast to setMessages's own parameter type rather than `ai`'s UIMessage:
      // useChat is typed via @ai-sdk/react's nested `ai`, a different version
      // than the app's direct `ai`, so an `ai` UIMessage[] isn't assignable here.
      setMessages(uiMessages as unknown as Parameters<typeof setMessages>[0]);
    },
    [setMessages],
  );

  // Wipe everything tied to the previous conversation when the active one
  // goes away (delete-active or "New chat"). Without this, proposal caches
  // keyed by message id from the deleted chat survive into the fresh one,
  // and an in-flight stream keeps writing into the empty messages array.
  const resetActivePanelState = useCallback(() => {
    setAppliedOutcomes({});
    setDiscardedProposals(new Set());
    setApplyingProposals(new Set());
    // Drop the fast-path subscription for the abandoned turn (ADR-048).
    setActiveTurnId(null);
    void stop();
  }, [stop]);

  const {
    conversations,
    currentConversationId,
    isLoading: isLoadingConversations,
    hasListError,
    select: selectConversation,
    startNew: startNewConversation,
    remove: removeConversation,
    adopt: adoptConversation,
  } = useLangyConversations({
    projectId,
    setMessages: applyMessagesFromHistory,
    onError: surfaceConversationError,
    onActiveCleared: resetActivePanelState,
  });
  adoptConversationRef.current = adoptConversation;

  // Real-time coordinator: one SSE subscription for the whole panel. Applies
  // the pushed operational spine in place (or invalidates) so the recents list
  // and the open conversation's status stay fresh without heavy polling.
  useLangyFreshness(currentConversationId);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, status]);

  const isBusy = status === "submitted" || status === "streaming";
  const isEmpty = messages.length === 0;

  // Stream B optimistic tokens for the in-flight turn (ADR-048). Enabled only
  // while a turn is streaming; the hook resets per (conversation, turn). The
  // text is reconciled against the durable useChat text inside MessageContent,
  // so a dropped/late token never renders corrupted prose.
  const { text: optimisticStreamText } = useLangyFastStream({
    projectId,
    conversationId: currentConversationId,
    turnId: activeTurnId,
    enabled: isBusy,
  });
  // Page context (task #14): the experiment / trace / dataset / project the
  // user is viewing, surfaced as removable composer chips and forwarded with
  // the turn. `dismissChip` hides one; `restoreChip` (the "+ context" control)
  // adds it back.
  const dismissChip = useLangyComposerStore((s) => s.dismissChip);
  const restoreChip = useLangyComposerStore((s) => s.restoreChip);
  const { chips: contextChips, addableChips } = useLangyPageContext();

  const send = async (text: string) => {
    if (!text.trim() || !projectId || isBusy) return;
    // modelOverride is empty until the resolved-default query lands OR until
    // the user picks; in either case the chat route falls back to the project
    // DEFAULT-role resolution when this field is absent.
    try {
      await sendMessage(
        { role: "user", parts: [{ type: "text", text }] },
        {
          body: {
            projectId,
            // Stay in the active conversation; null/absent means "start a new
            // one" and the transport adopts the id the server returns.
            ...(currentConversationId
              ? { conversationId: currentConversationId }
              : {}),
            ...(modelOverride ? { modelOverride } : {}),
            // What the user is looking at, so the agent can resolve "this
            // experiment / trace" without an explicit id. The chat route
            // ignores unknown body fields today; this is the transport seam
            // that lights up when the route reads it (cf. useLangyTurnSignals).
            ...(contextChips.length > 0
              ? {
                  pageContext: contextChips.map((chip) => ({
                    kind: chip.kind,
                    ref: chip.ref,
                    label: chip.label,
                  })),
                }
              : {}),
          },
        },
      );
      // Clear AFTER success so a failed send (network drop, 5xx) leaves
      // the user's typed text in the composer where they can retry it.
      // Clearing eagerly was losing input on every transient failure.
      setInput("");
    } catch {
      // sendMessage surfaces the error via the useChat() error channel; we
      // keep the input populated so the user can retry without retyping.
    }
  };

  const handleNewChat = () => {
    startNewConversation();
  };

  const handleSelectConversation = (id: string) => {
    void selectConversation(id);
  };

  const applyProposal = async (proposalId: string, proposal: LangyProposal) => {
    if (applyingProposals.has(proposalId)) return;
    if (proposalId in appliedOutcomes) return;
    if (discardedProposals.has(proposalId)) return;
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
    setApplyingProposals((prev) => new Set(prev).add(proposalId));
    try {
      const outcome = await handler(proposal.payload);
      setAppliedOutcomes((prev) => ({
        ...prev,
        [proposalId]: outcome ?? {},
      }));
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
      setApplyingProposals((prev) => {
        const next = new Set(prev);
        next.delete(proposalId);
        return next;
      });
    }
  };

  const discardProposal = (proposalId: string) => {
    setDiscardedProposals((prev) => new Set(prev).add(proposalId));
  };

  // Default (non-directive) feedback is throttled so we don't nag; a
  // [langy:feedback] directive from Langy bypasses this in MessageContent.
  const canAskFeedback = useMemo(() => shouldAskFeedback(), [messages.length]);

  // Granular streaming state (PR3 transport seam) + domain-error rendering.
  const turnSignals = useLangyTurnSignals(currentConversationId);
  // Once the turn reports live status / progress / metrics we show the detailed
  // streaming block (brand-dot status, statcard, mesh progress) and retire the
  // generic shimmer thinking indicator — they're the two halves of one moment,
  // never both at once. Until the PR3 transport lands, no signal arrives and the
  // shimmer covers the whole "working" gap.
  const hasTurnDetail =
    !!turnSignals.status ||
    turnSignals.progress !== null ||
    (turnSignals.metrics?.length ?? 0) > 0;
  const turnError = useMemo(() => {
    if (!error) return null;
    // The stream now carries a serialized domain error; fall back to a calm
    // generic "unknown" for a plain-string legacy error.
    const domain = readLangyStreamError(error.message) ?? {
      kind: "unknown",
      meta: {},
      httpStatus: 500,
    };
    return explainLangyError(domain);
  }, [error]);

  const onErrorAction = useCallback(
    (kind: "connect-github" | "configure-model" | "retry") => {
      if (kind !== "retry") return;
      const lastUser = [...messages]
        .reverse()
        .find((m) => m.role === "user");
      const textPart = lastUser?.parts.find(
        (p): p is { type: "text"; text: string } => p.type === "text",
      );
      if (textPart?.text) void send(textPart.text);
    },
    // `send` is defined below in render scope; it closes over stable refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [messages],
  );

  const subtitle = experimentSlug
    ? `On: ${experimentSlug}`
    : isEmpty
      ? "Your AI copilot"
      : "Working in this project";

  return (
    <Box
      position="fixed"
      top={0}
      right={0}
      bottom={0}
      width={`${PANEL_WIDTH}px`}
      zIndex={1500}
      background="bg.surface"
      borderLeftWidth="1px"
      borderLeftStyle="solid"
      borderLeftColor="border.muted"
      // No corner radius and no drop shadow — the panel reads as part of
      // the page chrome (a docked drawer), not a floating popover.
      overflow="hidden"
      transition={`transform ${LANGY_TRANSITION}, opacity 220ms ease`}
      transform={isOpen ? "translateX(0)" : `translateX(${PANEL_WIDTH}px)`}
      opacity={isOpen ? 1 : 0}
      pointerEvents={isOpen ? "auto" : "none"}
      aria-hidden={!isOpen}
      role="complementary"
      aria-label="Langy assistant"
    >
      <VStack gap={0} align="stretch" height="full">
        <PanelHeader
          subtitle={subtitle}
          onNewChat={handleNewChat}
          onClose={onClose}
          organizationId={organizationId}
          conversations={conversations}
          isLoadingConversations={isLoadingConversations}
          hasListError={hasListError}
          onSelectConversation={handleSelectConversation}
          onDeleteConversation={(id) => void removeConversation(id)}
        />
        <Box ref={scrollRef} flex={1} overflowY="auto" aria-live="polite">
          {langyNeedsModel ? (
            <VStack align="stretch" gap={2} paddingX="18px" paddingTop="18px">
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
                  discardedProposals={discardedProposals}
                  applyingProposals={applyingProposals}
                  onApply={applyProposal}
                  onDiscard={discardProposal}
                  conversationId={currentConversationId}
                  // The in-flight assistant turn streams tokens with the
                  // blur-reveal; feedback only shows under a settled reply.
                  isStreaming={
                    isBusy &&
                    index === messages.length - 1 &&
                    message.role === "assistant"
                  }
                  // Stream B optimistic lead — only for the in-flight assistant
                  // turn; reconciled against the durable text (ADR-048).
                  optimisticText={
                    isBusy &&
                    index === messages.length - 1 &&
                    message.role === "assistant"
                      ? optimisticStreamText
                      : undefined
                  }
                  showFeedback={
                    !isBusy &&
                    message.role === "assistant" &&
                    index === messages.length - 1 &&
                    canAskFeedback
                  }
                  onConnectedGithub={() =>
                    void utils.langyGithub.getConnection.invalidate({
                      organizationId: organizationId ?? "",
                    })
                  }
                />
              ))}
              {isBusy ? (
                hasTurnDetail ? (
                  // Detailed streaming block: brand-dot status, rolling-number
                  // statcard, and the mesh progress bar — driven by the live
                  // turn signals (PR3 transport).
                  <StreamingStatusLine
                    status={turnSignals.status}
                    progress={turnSignals.progress}
                    metrics={turnSignals.metrics}
                    segment={turnSignals.segment}
                  />
                ) : (
                  // No live detail yet — the shimmer thinking indicator covers
                  // the gap between send and the first token / signal.
                  <ThinkingIndicator messages={messages} />
                )
              ) : null}
              {turnError ? (
                <LangyError presentation={turnError} onAction={onErrorAction} />
              ) : null}
            </VStack>
          )}
        </Box>
        <Composer
          input={input}
          onInputChange={setInput}
          model={modelOverride}
          modelOptions={modelOptions}
          onModelChange={setModelOverride}
          onSend={() => void send(input)}
          onStop={() => void stop()}
          isBusy={isBusy}
          disabled={!projectId}
          canSend={!!input.trim() && !isBusy && !!projectId}
          contextChips={contextChips}
          onRemoveChip={dismissChip}
          addableChips={addableChips}
          onAddChip={restoreChip}
        />
      </VStack>
    </Box>
  );
}

function PanelHeader({
  subtitle,
  onNewChat,
  onClose,
  organizationId,
  conversations,
  isLoadingConversations,
  hasListError,
  onSelectConversation,
  onDeleteConversation,
}: {
  subtitle: string;
  onNewChat: () => void;
  onClose: () => void;
  organizationId?: string;
  conversations: LangyConversationSummary[];
  isLoadingConversations: boolean;
  hasListError: boolean;
  onSelectConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
}) {
  return (
    <>
      <HStack
        paddingTop="15px"
        paddingBottom="14px"
        paddingLeft="17px"
        paddingRight="13px"
        gap={2.5}
        flexShrink={0}
      >
        <SparkleTile size={30} sparkleSize={15} />
        <VStack align="start" gap={0} flex={1} minWidth={0}>
          <Text textStyle="sm" fontWeight="650" lineHeight="1.2" color="fg">
            Langy
          </Text>
          <Text
            textStyle="2xs"
            color="fg.muted"
            lineHeight="1.3"
            marginTop="1px"
            truncate
          >
            {subtitle}
          </Text>
        </VStack>
        <RecentChatsMenu
          conversations={conversations}
          isLoading={isLoadingConversations}
          hasError={hasListError}
          onSelect={onSelectConversation}
          onDelete={onDeleteConversation}
        />
        {organizationId ? (
          <LangyGitHubMenu organizationId={organizationId} />
        ) : null}
        <LangyDevModeToggle />
        <IconButton
          size="xs"
          variant="ghost"
          aria-label="New chat"
          color="fg.muted"
          onClick={onNewChat}
        >
          <Plus size={15} />
        </IconButton>
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
      <Separator />
    </>
  );
}

function ThinkingIndicator({ messages }: { messages: UIMessage[] }) {
  const reduceMotion = useReducedMotion();
  const last = messages.at(-1);
  const activeTool =
    last?.role === "assistant"
      ? last.parts.findLast((part) => part.type?.startsWith("tool-"))
      : undefined;
  // Map raw tool ids to human-readable verbs so the indicator doesn't read
  // like dev console output ("Langy is search traces…" → "Langy is reading
  // your traces…"). Unknown tools fall through to a stripped/spaced shape
  // so we always say SOMETHING rather than blanking out, but ids that ship
  // unbranded are an indication a new tool needs a copy entry here.
  const TOOL_VERBS: Record<string, string> = {
    search_traces: "reading your traces",
    get_trace: "loading a trace",
    search: "searching",
    read: "reading files",
    write: "drafting changes",
    edit: "editing files",
    bash: "running a command",
    list: "listing files",
    todowrite: "planning",
  };
  const rawId = activeTool?.type?.replace(/^tool-/, "") ?? null;
  const toolLabel = rawId
    ? (TOOL_VERBS[rawId] ?? `using ${rawId.replace(/_/g, " ")}`)
    : null;

  // While a tool is active, surface what it is — that's higher-signal
  // than a generic verb. Otherwise cycle through the AI thinking verbs
  // so the panel doesn't feel frozen during long generations.
  const cyclingVerb = useCyclingVerb(!toolLabel, LANGY_THINKING_VERBS);
  const text = toolLabel ? `Langy is ${toolLabel}…` : `${cyclingVerb}…`;

  // Reduced-motion: drop the keyframes animation but keep the static
  // gradient so the text still reads as "AI activity" without sweep.
  const shimmerCss = reduceMotion
    ? { ...thinkingShimmerStyles, animation: "none" }
    : thinkingShimmerStyles;

  return (
    <HStack gap={2} alignSelf="flex-start">
      <SparkleTile size={24} sparkleSize={12} />
      <Box
        textStyle="xs"
        fontWeight="500"
        letterSpacing="-0.005em"
        css={shimmerCss}
      >
        {text}
      </Box>
    </HStack>
  );
}
