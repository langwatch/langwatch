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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { LangyFoundryMenu } from "./LangyFoundryMenu";
import { LangyGitHubMenu } from "./github/LangyGitHubMenu";
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
import { useLangyTurnSignals } from "../hooks/useLangyTurnSignals";
import { useLangyStore } from "../stores/langyStore";
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
// Reserve room for the panel AND the collapse handle, so the handle sits in a
// gutter between the page content and the panel — overlapping neither (it used
// to stick through the panel's left edge over the content).
export const LANGY_DOCKED_OFFSET = PANEL_WIDTH + PILL_WIDTH;
export const LANGY_TRANSITION = "240ms cubic-bezier(0.32, 0.72, 0, 1)";

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
      <SparkleGradientDefs />
      <LangyHandle isOpen={isOpen} onToggle={toggle} />
      <LangyPanel
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
      transform={hover && !isOpen ? "translate(-2px, -50%)" : "translateY(-50%)"}
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

  // Conversation-scoped client state belongs to the active project only; the
  // store is a module singleton that survives the per-project panel remount, so
  // wipe it on mount (a panel mount happens on first project entry / a project
  // switch — never on same-project navigation, which keeps the layout mounted).
  useEffect(() => {
    useLangyStore.getState().resetForProject();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scrollRef = useRef<HTMLDivElement>(null);

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

  const { messages, sendMessage, stop, status, setMessages, error } = useChat({
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
  const { messages: historyMessages, isFetching: isFetchingHistory } =
    useLangyMessages(activeConversationId);

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

  const applyHistoryToEngine = useCallback(
    (history: LangyMessageDto[]) => {
      const uiMessages = history
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ id: m.id, role: m.role, parts: m.parts }));
      // Cast to setMessages's own parameter type rather than `ai`'s UIMessage:
      // useChat is typed via @ai-sdk/react's nested `ai`, a different version
      // than the app's direct `ai`, so an `ai` UIMessage[] isn't assignable.
      setMessagesRef.current(
        uiMessages as unknown as Parameters<typeof setMessages>[0],
      );
    },
    [],
  );

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

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, status]);

  const isBusy = status === "submitted" || status === "streaming";
  const isEmpty = messages.length === 0;

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
      // Clear AFTER success so a failed send leaves the typed text in place.
      setDraft("");
    } catch {
      // sendMessage surfaces the error via the useChat() error channel; keep
      // the draft populated so the user can retry without retyping.
    }
  };

  const handleNewChat = () => {
    void stop();
    startNewConversation();
  };

  const handleSelectConversation = (id: string) => {
    void stop();
    selectConversation(id);
  };

  const handleDeleteConversation = async (id: string) => {
    const wasActive = id === activeConversationId;
    try {
      await removeConversation(id);
      if (wasActive) {
        void stop();
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
    if (!error) return null;
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
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      const textPart = lastUser?.parts.find(
        (p): p is { type: "text"; text: string } => p.type === "text",
      );
      if (textPart?.text) void send(textPart.text);
    },
    // `send` is defined in render scope; it closes over stable refs.
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
          onClose={closePanel}
          organizationId={organizationId}
          conversations={conversations}
          isLoadingConversations={isLoadingConversations}
          hasListError={hasListError}
          onSelectConversation={handleSelectConversation}
          onDeleteConversation={(id) => void handleDeleteConversation(id)}
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
                  <StreamingStatusLine
                    status={turnSignals.status}
                    progress={turnSignals.progress}
                    metrics={turnSignals.metrics}
                    segment={turnSignals.segment}
                  />
                ) : (
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
  conversations: React.ComponentProps<typeof RecentChatsMenu>["conversations"];
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
        <LangyFoundryMenu />
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
  // like dev console output. Unknown tools fall through to a stripped/spaced
  // shape so we always say SOMETHING rather than blanking out.
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

  // While a tool is active, surface what it is — that's higher-signal than a
  // generic verb. Otherwise cycle through the AI thinking verbs so the panel
  // doesn't feel frozen during long generations.
  const cyclingVerb = useCyclingVerb(!toolLabel, LANGY_THINKING_VERBS);
  const text = toolLabel ? `Langy is ${toolLabel}…` : `${cyclingVerb}…`;

  // Reduced-motion: drop the keyframes animation but keep the static gradient.
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
