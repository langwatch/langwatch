import { useChat } from "@ai-sdk/react";
import {
  Box,
  Button,
  Circle,
  Flex,
  HStack,
  IconButton,
  Separator,
  Spinner,
  Text,
  Textarea,
  VStack,
  chakra,
} from "@chakra-ui/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { MeshGradient } from "@paper-design/shaders-react";
import { keyframes } from "@emotion/react";
import {
  ArrowRight,
  Check,
  Plus,
  Send,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Kbd } from "~/components/ops/shared/Kbd";
import { Markdown } from "~/components/Markdown";
import { toaster } from "~/components/ui/toaster";
import { Tooltip } from "~/components/ui/tooltip";
import { aiBrandPalette } from "~/features/traces-v2/components/ai/aiBrandPalette";
import {
  DEFAULT_THINKING_VERBS,
  useCyclingVerb,
} from "~/features/traces-v2/components/ai/useCyclingVerb";
import { useTypewriterPlaceholder } from "~/features/traces-v2/components/ai/useTypewriterPlaceholder";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import { isHandledByGlobalHandler } from "~/utils/trpcError";
import { api } from "~/utils/api";
import { ModelSelector, allModelOptions } from "~/components/ModelSelector";
import { modelProviderIcons } from "~/server/modelProviders/iconsMap";
import { isLangyManagedVk } from "~/components/gateway/langyVk";

// The same feature key Langy's chat route resolves against. Used to seed the
// composer's model picker with whatever's actually resolving today — opening
// Langy on a project that already has a configured default model lands on
// THAT model, not on an unrelated branch-primary pick.
const LANGY_GATE_FEATURE_KEY = "prompt.create_default";
import {
  useLangyConversations,
  type LangyConversationSummary,
  type LangyMessageRecord,
} from "./useLangyConversations";

const PANEL_WIDTH = 380;
// The panel docks flush against the right edge of the viewport. Page
// layouts coordinate via LANGY_DOCKED_OFFSET; we keep a small reserve so
// content underneath still has breathing room when the panel is open.
const PANEL_RESERVE = 0;
const PILL_WIDTH = 30;

export const LANGY_DOCKED_OFFSET = PANEL_WIDTH + PANEL_RESERVE;
export const LANGY_TRANSITION = "240ms cubic-bezier(0.32, 0.72, 0, 1)";

// Single source of truth for the gradient id used by every gradient-stroke
// Sparkle in this component. Defined once in <SparkleGradientDefs /> and
// referenced via `stroke="url(#langy-sparkle-grad)"`. Mirrors AiPromptInput.
const SPARKLE_GRADIENT_ID = "langy-sparkle-grad";

// AI accent shadows — purple-leaning so they feel cool, not warm.
const AI_SHADOW = "0 6px 18px -4px rgba(168, 85, 247, 0.35)";
const AI_SHADOW_SOFT = "0 4px 12px -4px rgba(168, 85, 247, 0.22)";

// AI brand surface tones. Kept literal because we want the same exact tones
// across light/dark; semantic purple.subtle from Chakra is too pale.
const AI_BG_SUBTLE = "rgba(168, 85, 247, 0.06)";
const AI_BG_HOVER = "rgba(168, 85, 247, 0.10)";
const AI_BORDER = "rgba(168, 85, 247, 0.24)";

const SUGGESTION_CHIPS = [
  "Summarize my experiment",
  "Find failing traces",
  "Suggest an evaluator",
  "Compare two runs",
  "Explain a low score",
];

const COMPOSER_PLACEHOLDER_EXAMPLES = [
  "Ask Langy or describe what you want…",
  "Try: which evaluators are failing most?",
  "Maybe: summarize today's runs",
  "How about: suggest an evaluator for hallucinations",
  "Like: compare last two experiment runs",
];

// Sweep the AI palette through the muted body colour for the "thinking"
// shimmer. Lifted from AiPromptInput.tsx; the keyframes helper is the only
// way to actually emit @keyframes from a CSS-in-JS object.
const langyThinkingShimmer = keyframes`
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
`;
const thinkingShimmerStyles = {
  background: `linear-gradient(
    90deg,
    var(--chakra-colors-fg-muted) 0%,
    var(--chakra-colors-fg-muted) 25%,
    ${aiBrandPalette[0]} 42%,
    ${aiBrandPalette[1]} 50%,
    ${aiBrandPalette[2]} 58%,
    var(--chakra-colors-fg-muted) 75%,
    var(--chakra-colors-fg-muted) 100%
  )`,
  backgroundSize: "250% 100%",
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  WebkitTextFillColor: "transparent",
  animation: `${langyThinkingShimmer} 4.5s linear infinite`,
} as const;


/**
 * `⌘I` / `Ctrl+I` toggles the Langy panel globally. Mirrors
 * useGlobalAiShortcut from traces-v2. preventDefault claims it for the page
 * when keyboard focus is inside the document. If a text input is active
 * with a non-empty selection we bail to avoid hijacking OS shortcuts
 * users might be relying on (e.g. select-line).
 */
function useGlobalLangyShortcut(onTrigger: () => void): void {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const isAccel = event.metaKey || event.ctrlKey;
      if (!isAccel) return;
      if (event.key !== "i" && event.key !== "I") return;
      if (event.altKey || event.shiftKey) return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        const isTextInput =
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable;
        if (isTextInput) {
          const sel = window.getSelection?.();
          if (sel && sel.toString().length > 0) return;
        }
      }
      event.preventDefault();
      onTrigger();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onTrigger]);
}

export interface LangyProposal {
  langyProposal: true;
  kind: string;
  summary: string;
  rationale?: string;
  destructive?: boolean;
  payload: Record<string, unknown>;
}

export type AppliedOutcome = {
  label?: string;
  onOpen?: () => void;
  href?: string;
} | void;

export type ProposalHandlers = Record<
  string,
  (payload: Record<string, unknown>) => Promise<AppliedOutcome>
>;

interface LangyDrawerProps {
  proposalHandlers?: ProposalHandlers;
  experimentSlug?: string;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function LangyDrawer({
  proposalHandlers,
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
        proposalHandlers={proposalHandlers}
        experimentSlug={experimentSlug}
      />
    </>
  );
}

/**
 * Hidden SVG that defines the AI brand linear gradient. Every `<Sparkles>`
 * (or other lucide icon) that wants the rainbow brand stroke references it
 * via `stroke="url(#langy-sparkle-grad)"`. Defined once at the root so the
 * gradient is available globally and the icons reuse the same paint server.
 */
function SparkleGradientDefs() {
  return (
    <svg
      width="0"
      height="0"
      aria-hidden
      style={{ position: "absolute", pointerEvents: "none" }}
    >
      <defs>
        <linearGradient id={SPARKLE_GRADIENT_ID} x1="0%" y1="0%" x2="100%" y2="100%">
          {aiBrandPalette.map((color, i) => (
            <stop
              key={color}
              offset={`${(i / (aiBrandPalette.length - 1)) * 100}%`}
              stopColor={color}
            />
          ))}
        </linearGradient>
      </defs>
    </svg>
  );
}

/** AI-brand sparkle: outline-only icon with the rainbow gradient stroke. */
function GradientSparkle({ size = 16 }: { size?: number }) {
  return (
    <Sparkles
      size={size}
      stroke={`url(#${SPARKLE_GRADIENT_ID})`}
      strokeWidth={2}
    />
  );
}

/**
 * Animated WebGL mesh of the AI brand colours, positioned absolute and
 * sized to fill its parent. Drop into any AI affordance with
 * `position: relative` and ensure the foreground content sits at
 * `position: relative; zIndex: 1` so it stacks above the mesh. Mirrors
 * the AskAiButton + AiShaderBackdrop usage from traces-v2.
 *
 * `active` lifts the swirl speed for the "thinking" state. Returns a
 * static gradient when `prefers-reduced-motion: reduce` is set.
 */
function MeshGradientLayer({
  active = false,
  borderRadius,
}: {
  active?: boolean;
  borderRadius?: string;
}) {
  const reduceMotion = useReducedMotion();
  const speed = reduceMotion ? 0 : active ? 0.6 : 0.3;
  return (
    <Box
      position="absolute"
      inset={0}
      pointerEvents="none"
      overflow="hidden"
      borderRadius={borderRadius}
      _dark={{ opacity: 0.75 }}
    >
      <MeshGradient
        colors={[...aiBrandPalette]}
        distortion={0.5}
        swirl={0.5}
        grainMixer={0}
        grainOverlay={0}
        speed={speed}
        scale={1.5}
        style={{ width: "100%", height: "100%" }}
      />
    </Box>
  );
}

function SparkleTile({
  size,
  sparkleSize,
}: {
  size: number;
  sparkleSize: number;
}) {
  return (
    <Box
      width={`${size}px`}
      height={`${size}px`}
      borderRadius="8px"
      background={AI_BG_SUBTLE}
      borderWidth="1px"
      borderStyle="solid"
      borderColor={AI_BORDER}
      display="grid"
      placeItems="center"
      flexShrink={0}
    >
      <GradientSparkle size={sparkleSize} />
    </Box>
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
      aria-label={isOpen ? "Close Langy" : "Open Langy assistant"}
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
      background="transparent"
      borderWidth="1px"
      borderStyle="solid"
      borderColor="rgba(255,255,255,0.18)"
      borderRightWidth={0}
      color="white"
      boxShadow={hover ? AI_SHADOW : AI_SHADOW_SOFT}
      transform={hover ? "translate(-2px, -50%)" : "translateY(-50%)"}
      transition={`right ${LANGY_TRANSITION}, transform 180ms ease, box-shadow 180ms ease`}
      overflow="hidden"
    >
      <MeshGradientLayer active={hover} />
      <VStack
        gap={2}
        align="center"
        justify="center"
        position="relative"
        zIndex={1}
      >
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
      </VStack>
    </chakra.button>
  );

  return (
    <Tooltip
      content={
        <HStack gap={2}>
          <Text>{isOpen ? "Close Langy" : "Open Langy"}</Text>
          <HStack gap={1}>
            <Kbd>⌘</Kbd>
            <Kbd>L</Kbd>
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
  proposalHandlers,
  experimentSlug,
}: {
  isOpen: boolean;
  onClose: () => void;
  proposalHandlers?: ProposalHandlers;
  experimentSlug?: string;
}) {
  const { organization, project } = useOrganizationTeamProject();
  const projectId = project?.id;
  const organizationId = organization?.id;

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

  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/langy/chat" }),
    [],
  );

  // Seed the picker with the model the gate currently resolves to. Once the
  // user picks something different, we don't overwrite — they're explicitly
  // choosing per-session. Only seed on first valid response.
  const resolvedDefaultQuery = api.modelProvider.getResolvedDefault.useQuery(
    { projectId: projectId ?? "", featureKey: LANGY_GATE_FEATURE_KEY },
    { enabled: !!projectId },
  );

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

  // Options the picker offers: the VK allowlist when present, else every
  // registry model (ModelSelector further narrows that to the project's
  // enabled providers). "Narrow to VK, fall back to all."
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
    if (resolved && (!langyModelsAllowed || langyModelsAllowed.includes(resolved))) {
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
  const { messages, sendMessage, stop, status, setMessages } = useChat({
    transport,
    onError: (error) => {
      if (isHandledByGlobalHandler(error)) return;
      toaster.create({
        title: "Langy error",
        description: error.message,
        type: "error",
        duration: 5000,
        meta: { closable: true },
      });
    },
  });

  const surfaceConversationError = useMemo(
    () => (message: string) => {
      toaster.create({
        title: "Langy",
        description: message,
        type: "error",
        duration: 5000,
        meta: { closable: true },
      });
    },
    [],
  );

  const applyMessagesFromHistory = useMemo(
    () => (history: LangyMessageRecord[]) => {
      const uiMessages = history.map((m) => ({
        id: m.id,
        role: m.role,
        parts: [{ type: "text" as const, text: m.content }],
      })) as unknown as UIMessage[];
      setMessages(uiMessages);
    },
    [setMessages],
  );

  const {
    conversations,
    isLoading: isLoadingConversations,
    hasListError,
    select: selectConversation,
    startNew: startNewConversation,
    remove: removeConversation,
  } = useLangyConversations({
    projectId,
    setMessages: applyMessagesFromHistory,
    onError: surfaceConversationError,
  });

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, status]);

  const isBusy = status === "submitted" || status === "streaming";
  const isEmpty = messages.length === 0;

  const send = async (text: string) => {
    if (!text.trim() || !projectId || isBusy) return;
    setInput("");
    // modelOverride is empty until the resolved-default query lands OR until
    // the user picks; in either case the chat route falls back to the project
    // DEFAULT-role resolution when this field is absent.
    await sendMessage(
      { role: "user", parts: [{ type: "text", text }] },
      {
        body: {
          projectId,
          experimentSlug,
          ...(modelOverride ? { modelOverride } : {}),
        },
      },
    );
  };

  const handleNewChat = () => {
    startNewConversation();
  };

  const handleSelectConversation = (id: string) => {
    void selectConversation(id);
  };

  const applyProposal = async (
    proposalId: string,
    proposal: LangyProposal,
  ) => {
    if (applyingProposals.has(proposalId)) return;
    if (proposalId in appliedOutcomes) return;
    if (discardedProposals.has(proposalId)) return;
    const handler = proposalHandlers?.[proposal.kind];
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
      transform={
        isOpen ? "translateX(0)" : `translateX(${PANEL_WIDTH}px)`
      }
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
        />
        <RecentList
          conversations={conversations}
          isLoading={isLoadingConversations}
          hasError={hasListError}
          onSelect={handleSelectConversation}
          onDelete={(id) => void removeConversation(id)}
        />
        <Box ref={scrollRef} flex={1} overflowY="auto" aria-live="polite">
          {isEmpty ? (
            <EmptyState onPick={(prompt) => void send(prompt)} />
          ) : (
            <VStack
              gap="14px"
              align="stretch"
              paddingX="18px"
              paddingTop="18px"
              paddingBottom="12px"
            >
              {messages.map((message) => (
                <MessageContent
                  key={message.id}
                  message={message}
                  appliedOutcomes={appliedOutcomes}
                  discardedProposals={discardedProposals}
                  applyingProposals={applyingProposals}
                  onApply={applyProposal}
                  onDiscard={discardProposal}
                />
              ))}
              {isBusy && <ThinkingIndicator messages={messages} />}
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
        />
      </VStack>
    </Box>
  );
}

function PanelHeader({
  subtitle,
  onNewChat,
  onClose,
}: {
  subtitle: string;
  onNewChat: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <HStack
        paddingY={3}
        paddingLeft={4}
        paddingRight={3}
        gap={2.5}
        flexShrink={0}
      >
        <SparkleTile size={28} sparkleSize={15} />
        <VStack align="start" gap={0} flex={1} minWidth={0}>
          <Text textStyle="sm" fontWeight="600" lineHeight="1.2" color="fg">
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

function RecentList({
  conversations,
  isLoading,
  hasError,
  onSelect,
  onDelete,
}: {
  conversations: LangyConversationSummary[];
  isLoading: boolean;
  hasError: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  if (hasError) return null;
  if (!isLoading && conversations.length === 0) return null;

  return (
    <>
      <VStack
        align="stretch"
        gap={1}
        paddingX={3}
        paddingY={2}
        background="bg.subtle"
        flexShrink={0}
        maxHeight="220px"
        overflowY="auto"
      >
        <Text
          textStyle="2xs"
          fontWeight="600"
          letterSpacing="0.08em"
          color="fg.subtle"
          textTransform="uppercase"
          paddingX={1}
          paddingBottom={1}
        >
          Recent chats
        </Text>
        {isLoading ? (
          <HStack
            gap={2}
            paddingX={1}
            paddingY={1.5}
            aria-label="Loading recent conversations"
          >
            <Spinner size="xs" />
            <Text textStyle="xs" color="fg.muted">
              Loading…
            </Text>
          </HStack>
        ) : (
          <Box
            as="ul"
            aria-label="Recent conversations"
            listStyleType="none"
            margin={0}
            padding={0}
          >
            {conversations.map((conv) => (
              <HStack key={conv.id} as="li" gap={1}>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => onSelect(conv.id)}
                  flex={1}
                  justifyContent="flex-start"
                  fontWeight="normal"
                  color="fg"
                  paddingX={2}
                  truncate
                >
                  {conv.title ?? "Untitled"}
                </Button>
                <IconButton
                  size="2xs"
                  variant="ghost"
                  color="fg.subtle"
                  aria-label="Delete conversation"
                  onClick={() => onDelete(conv.id)}
                >
                  <Trash2 size={12} />
                </IconButton>
              </HStack>
            ))}
          </Box>
        )}
      </VStack>
      <Separator />
    </>
  );
}

function EmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <VStack
      gap={0}
      align="center"
      justify="center"
      flex={1}
      paddingX={6}
      paddingY={8}
      height="full"
    >
      <Circle
        size="64px"
        bg={AI_BG_SUBTLE}
        borderWidth="1px"
        borderStyle="solid"
        borderColor={AI_BORDER}
        boxShadow={AI_SHADOW_SOFT}
      >
        <GradientSparkle size={28} />
      </Circle>
      <Text
        textStyle="lg"
        fontWeight="600"
        letterSpacing="-0.3px"
        color="fg"
        textAlign="center"
        marginTop={4}
      >
        How can I help?
      </Text>
      <Text
        textStyle="sm"
        color="fg.muted"
        lineHeight="1.5"
        textAlign="center"
        maxWidth="280px"
        marginTop={2}
        marginBottom={5}
      >
        Ask in plain language. I&apos;ll read your traces and evals, then
        propose changes you can apply.
      </Text>
      <HStack gap={1.5} flexWrap="wrap" justify="center" maxWidth="320px">
        {SUGGESTION_CHIPS.map((chip) => (
          <Chip key={chip} onClick={() => onPick(chip)}>
            {chip}
          </Chip>
        ))}
      </HStack>
    </VStack>
  );
}

function Chip({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <Button
      size="xs"
      variant="outline"
      onClick={onClick}
      borderRadius="full"
      fontWeight="500"
      color="fg"
      borderColor="border.emphasized"
      bg="bg.subtle"
      _hover={{
        bg: AI_BG_HOVER,
        borderColor: AI_BORDER,
        boxShadow: "0 1px 2px rgba(168, 85, 247, 0.12)",
      }}
      whiteSpace="nowrap"
    >
      {children}
    </Button>
  );
}

function ThinkingIndicator({ messages }: { messages: UIMessage[] }) {
  const reduceMotion = useReducedMotion();
  const last = messages.at(-1);
  const activeTool =
    last?.role === "assistant"
      ? last.parts.findLast((part) => part.type?.startsWith("tool-"))
      : undefined;
  const toolLabel = activeTool?.type
    ? activeTool.type.replace(/^tool-/, "").replace(/_/g, " ")
    : null;

  // While a tool is active, surface what it is — that's higher-signal
  // than a generic verb. Otherwise cycle through the AI thinking verbs
  // so the panel doesn't feel frozen during long generations.
  const cyclingVerb = useCyclingVerb(!toolLabel, DEFAULT_THINKING_VERBS);
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

function Composer({
  input,
  onInputChange,
  model,
  modelOptions,
  onModelChange,
  onSend,
  onStop,
  isBusy,
  disabled,
  canSend,
}: {
  input: string;
  onInputChange: (v: string) => void;
  /** The model Langy will use for the next send. "" = let the server pick. */
  model: string;
  /** Models the picker may offer (the VK allowlist, or all registry models). */
  modelOptions: string[];
  onModelChange: (model: string) => void;
  onSend: () => void;
  onStop: () => void;
  isBusy: boolean;
  disabled: boolean;
  canSend: boolean;
}) {
  const filled = input.trim().length > 0;
  const [pickerExpanded, setPickerExpanded] = useState(false);
  const [pickerDropdownOpen, setPickerDropdownOpen] = useState(false);
  const typewriterPlaceholder = useTypewriterPlaceholder(
    !filled && !isBusy && !disabled,
    COMPOSER_PLACEHOLDER_EXAMPLES,
  );
  // Provider icon for the currently-selected model. Used by the collapsed
  // pill so we render a clean centered logo instead of clipping the full
  // ModelSelector trigger to 30px (which leaves the model name cut in half).
  const collapsedProviderIcon = useMemo(() => {
    const providerKey = (model ?? "").split("/")[0] ?? "";
    return (
      modelProviderIcons[providerKey as keyof typeof modelProviderIcons] ?? null
    );
  }, [model]);
  const collapsePicker = () => {
    setPickerExpanded(false);
    setPickerDropdownOpen(false);
  };
  return (
    <>
      <Separator />
      <Box
        paddingX={3}
        paddingTop={3}
        paddingBottom={3}
        background="bg.surface"
        flexShrink={0}
      >
        {/* Per-send model picker. Collapsed to a small bubble showing just
            the provider logo; on hover/focus the bubble fluidly expands into
            the full picker. ModelSelector stays mounted — width animation
            reveals the model label + caret without a remount. */}
        <Flex
          justifyContent="flex-end"
          marginBottom={1.5}
          data-testid="langy-model-picker"
          data-model={model}
          onMouseEnter={() => setPickerExpanded(true)}
          onMouseLeave={collapsePicker}
          onFocus={() => setPickerExpanded(true)}
        >
          <Box
            position="relative"
            width={pickerExpanded ? "180px" : "30px"}
            height="28px"
            borderRadius="full"
            transition="width 220ms ease-out"
            transformOrigin="right center"
            _dark={{ "& svg path": { fill: "white" } }}
            cursor="pointer"
          >
            {/* Collapsed view: just the provider logo, centered, sized to
                match the icon the expanded ModelSelector renders so the
                logo doesn't visibly grow/shrink across the transition.
                Crossfade is short so the swap reads as a reveal, not a
                morph. */}
            <Flex
              position="absolute"
              inset={0}
              align="center"
              justify="center"
              opacity={pickerExpanded ? 0 : 1}
              transition="opacity 120ms ease-out"
              pointerEvents={pickerExpanded ? "none" : "auto"}
              aria-hidden={pickerExpanded}
            >
              <Box width="14px" height="14px" lineHeight={0}>
                {collapsedProviderIcon}
              </Box>
            </Flex>
            {/* Expanded view: full ModelSelector. Controlled open state so
                mouse-leave can close the dropdown alongside collapsing the
                pill — otherwise the popover floats orphaned. */}
            <Box
              position="absolute"
              inset={0}
              overflow="hidden"
              borderRadius="full"
              opacity={pickerExpanded ? 1 : 0}
              transition="opacity 200ms ease-out"
              pointerEvents={pickerExpanded ? "auto" : "none"}
              aria-hidden={!pickerExpanded}
            >
              <ModelSelector
                model={model}
                options={modelOptions}
                onChange={onModelChange}
                mode="chat"
                size="sm"
                open={pickerDropdownOpen}
                onOpenChange={setPickerDropdownOpen}
              />
            </Box>
          </Box>
        </Flex>
        <HStack
          gap={2}
          paddingY={1.5}
          paddingLeft={3}
          paddingRight={1.5}
          borderRadius="full"
          borderWidth="1px"
          borderStyle="solid"
          borderColor={filled ? AI_BORDER : "border.emphasized"}
          background="bg.surface"
          boxShadow={filled ? `0 0 0 3px ${AI_BG_SUBTLE}` : undefined}
          transition="border-color 150ms ease, box-shadow 150ms ease"
          align="center"
        >
          <Textarea
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (!isBusy && canSend) onSend();
              }
            }}
            placeholder={
              isBusy ? "Langy is working…" : typewriterPlaceholder
            }
            disabled={disabled || isBusy}
            rows={1}
            autoresize
            maxHeight="120px"
            minHeight="22px"
            padding={0}
            border="none"
            background="transparent"
            textStyle="sm"
            lineHeight="1.45"
            color="fg"
            resize="none"
            _focus={{ outline: "none", boxShadow: "none" }}
            _focusVisible={{ outline: "none", boxShadow: "none" }}
          />
          {isBusy ? (
            <SendButton
              aria-label="Stop"
              onClick={onStop}
              background="var(--chakra-colors-red-solid)"
              color="white"
              shadow={false}
              cursor="pointer"
            >
              <Square size={12} />
            </SendButton>
          ) : (
            <SendButton
              aria-label="Send"
              onClick={onSend}
              disabled={!canSend}
              background={canSend ? "transparent" : "bg.muted"}
              color={canSend ? "white" : "fg.muted"}
              shadow={canSend}
              cursor={canSend ? "pointer" : "default"}
              meshOverlay={canSend}
            >
              <Send size={14} />
            </SendButton>
          )}
        </HStack>
        <Text
          marginTop={2}
          textStyle="2xs"
          color="fg.subtle"
          textAlign="center"
          letterSpacing="0.01em"
        >
          Langy proposes — you review and apply.
        </Text>
      </Box>
    </>
  );
}

function SendButton({
  children,
  background,
  color,
  shadow,
  cursor,
  meshOverlay = false,
  ...rest
}: {
  children: React.ReactNode;
  background: string;
  color: string;
  shadow: boolean;
  cursor: string;
  meshOverlay?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <chakra.button
      type="button"
      width="32px"
      height="32px"
      borderRadius="full"
      borderWidth={0}
      background={background}
      color={color}
      cursor={cursor}
      display="grid"
      placeItems="center"
      flexShrink={0}
      boxShadow={shadow ? AI_SHADOW : undefined}
      transition="background 150ms ease, box-shadow 150ms ease"
      position="relative"
      overflow="hidden"
      {...rest}
    >
      {meshOverlay && <MeshGradientLayer borderRadius="full" />}
      <Box position="relative" zIndex={1} display="grid" placeItems="center">
        {children}
      </Box>
    </chakra.button>
  );
}

function MessageContent({
  message,
  appliedOutcomes,
  discardedProposals,
  applyingProposals,
  onApply,
  onDiscard,
}: {
  message: UIMessage;
  appliedOutcomes: Record<
    string,
    { href?: string; label?: string; onOpen?: () => void }
  >;
  discardedProposals: Set<string>;
  applyingProposals: Set<string>;
  onApply: (proposalId: string, proposal: LangyProposal) => Promise<void>;
  onDiscard: (proposalId: string) => void;
}) {
  const isUser = message.role === "user";
  const text = message.parts
    .filter(
      (part): part is { type: "text"; text: string } => part.type === "text",
    )
    .map((part) => part.text)
    .join("");

  const proposals = extractProposals(message);
  if (!text && proposals.length === 0) return null;

  if (isUser) {
    return (
      <Box alignSelf="flex-end" maxWidth="85%">
        <Box
          paddingX={3}
          paddingY={2}
          background="#1c1917"
          color="white"
          borderRadius="lg"
          borderBottomRightRadius="sm"
          textStyle="sm"
          lineHeight="1.45"
          whiteSpace="pre-wrap"
        >
          {text}
        </Box>
      </Box>
    );
  }

  return (
    <HStack gap={2} align="flex-start" width="full">
      <SparkleTile size={24} sparkleSize={12} />
      <VStack align="stretch" gap={2.5} flex={1} minWidth={0}>
        {text && (
          <Box
            textStyle="sm"
            color="fg"
            lineHeight="1.55"
            css={{
              "& p": { margin: 0 },
              "& p + p": { marginTop: "6px" },
              "& ul, & ol": { paddingLeft: "18px", margin: "4px 0" },
              "& code": {
                fontSize: "12px",
                padding: "1px 5px",
                borderRadius: "4px",
                background: "var(--chakra-colors-bg-subtle)",
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, monospace",
              },
            }}
          >
            <Markdown>{text}</Markdown>
          </Box>
        )}
        {proposals.map(({ id, proposal }) => (
          <ProposalCard
            key={id}
            proposal={proposal}
            appliedOutcome={appliedOutcomes[id]}
            isDiscarded={discardedProposals.has(id)}
            isApplying={applyingProposals.has(id)}
            onApply={() => void onApply(id, proposal)}
            onDiscard={() => onDiscard(id)}
          />
        ))}
      </VStack>
    </HStack>
  );
}

function ProposalCard({
  proposal,
  appliedOutcome,
  isDiscarded,
  isApplying,
  onApply,
  onDiscard,
}: {
  proposal: LangyProposal;
  appliedOutcome?: { href?: string; label?: string; onOpen?: () => void };
  isDiscarded: boolean;
  isApplying: boolean;
  onApply: () => void;
  onDiscard: () => void;
}) {
  const isApplied = !!appliedOutcome;
  const destructive = !!proposal.destructive;
  const openHref = appliedOutcome?.href;
  const onOpen = appliedOutcome?.onOpen;
  const openLabel = appliedOutcome?.label ?? "Open";
  const hasOpen = !!onOpen || !!openHref;

  const overlineLabel = isApplied
    ? destructive
      ? "Done"
      : "Applied"
    : isDiscarded
      ? "Discarded"
      : isApplying
        ? destructive
          ? "Deleting…"
          : "Applying…"
        : destructive
          ? "Wants to delete"
          : "Proposal";

  const overlineColor =
    destructive && !isApplied
      ? "var(--chakra-colors-red-fg)"
      : isApplied && !destructive
        ? "var(--chakra-colors-green-fg)"
        : isDiscarded
          ? "var(--chakra-colors-fg-muted)"
          : "var(--chakra-colors-purple-fg)";

  const triggerOpen = () => {
    if (onOpen) {
      onOpen();
      return;
    }
    if (openHref) {
      window.location.href = openHref;
    }
  };

  return (
    <Box
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      padding={3}
      background="bg.subtle"
      opacity={isDiscarded ? 0.65 : 1}
      cursor={hasOpen ? "pointer" : "default"}
      // When the card behaves as a button (an applied proposal that opens
      // something on click) it needs button semantics so keyboard / screen-
      // reader users can activate it. Without this, only mouse users could
      // reach the affordance — the inner Open button is the keyboard
      // fallback but the whole-card click target is invisible to a11y.
      {...(hasOpen
        ? {
            role: "button",
            tabIndex: 0,
            "aria-label": `${openLabel}: ${proposal.summary}`,
            onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              const target = e.target as HTMLElement;
              if (target.closest("a, button")) return;
              e.preventDefault();
              triggerOpen();
            },
          }
        : {})}
      onClick={(e) => {
        if (!hasOpen) return;
        const target = e.target as HTMLElement;
        if (target.closest("a, button")) return;
        triggerOpen();
      }}
      transition="border-color 150ms ease, box-shadow 150ms ease"
      _hover={hasOpen ? { borderColor: "green.fg", boxShadow: "sm" } : undefined}
    >
      <HStack
        gap={1.5}
        marginBottom={2}
        textStyle="2xs"
        fontWeight="600"
        letterSpacing="0.08em"
        textTransform="uppercase"
        color={overlineColor}
      >
        {isApplied && !destructive ? (
          <Check size={11} />
        ) : (
          <GradientSparkle size={11} />
        )}
        <Text>{overlineLabel}</Text>
      </HStack>
      <Text textStyle="sm" fontWeight="600" color="fg" marginBottom={0.5}>
        {proposal.summary}
      </Text>
      {proposal.rationale && (
        <Text
          textStyle="xs"
          color="fg.muted"
          lineHeight="1.45"
          marginBottom={3}
        >
          {proposal.rationale}
        </Text>
      )}
      {!isApplied && !isDiscarded && (
        <HStack gap={1.5} paddingTop={proposal.rationale ? 0 : 2.5}>
          <chakra.button
            type="button"
            flex={1}
            paddingX={3}
            paddingY={2}
            borderRadius="md"
            borderWidth={0}
            background={
              destructive ? "var(--chakra-colors-red-solid)" : "transparent"
            }
            color="white"
            fontSize="12.5px"
            fontWeight={500}
            cursor={isApplying ? "default" : "pointer"}
            opacity={isApplying ? 0.7 : 1}
            display="flex"
            alignItems="center"
            justifyContent="center"
            gap={1.5}
            boxShadow={destructive ? undefined : AI_SHADOW}
            onClick={onApply}
            disabled={isApplying}
            position="relative"
            overflow="hidden"
          >
            {!destructive && (
              <MeshGradientLayer borderRadius="md" active={isApplying} />
            )}
            <Box
              position="relative"
              zIndex={1}
              display="flex"
              alignItems="center"
              gap={1.5}
            >
              <Check size={12} />
              {isApplying
                ? destructive
                  ? "Deleting…"
                  : "Applying…"
                : destructive
                  ? "Delete"
                  : "Apply"}
            </Box>
          </chakra.button>
          <Button
            size="xs"
            variant="outline"
            onClick={onDiscard}
            disabled={isApplying}
          >
            {destructive ? "Cancel" : "Discard"}
          </Button>
        </HStack>
      )}
      {isApplied && hasOpen && (
        <HStack paddingTop={2.5}>
          {onOpen ? (
            <Button
              size="xs"
              variant="outline"
              colorPalette="green"
              onClick={triggerOpen}
            >
              {openLabel}
              <ArrowRight size={12} />
            </Button>
          ) : openHref ? (
            <Button size="xs" variant="outline" colorPalette="green" asChild>
              <a href={openHref}>
                {openLabel}
                <ArrowRight size={12} />
              </a>
            </Button>
          ) : null}
        </HStack>
      )}
    </Box>
  );
}

function extractProposals(
  message: UIMessage,
): Array<{ id: string; proposal: LangyProposal }> {
  const result: Array<{ id: string; proposal: LangyProposal }> = [];
  for (const part of message.parts) {
    if (!part.type?.startsWith("tool-")) continue;
    const output = (part as { output?: unknown }).output;
    if (!isLangyProposal(output)) continue;
    const id =
      (part as { toolCallId?: string }).toolCallId ??
      `${message.id}:${result.length}`;
    result.push({ id, proposal: output });
  }
  return result;
}

function isLangyProposal(value: unknown): value is LangyProposal {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.langyProposal === true &&
    typeof v.kind === "string" &&
    typeof v.summary === "string"
  );
}
