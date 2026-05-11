import { useChat } from "@ai-sdk/react";
import {
  Box,
  Button,
  HStack,
  IconButton,
  Spinner,
  Text,
  Textarea,
  VStack,
  chakra,
} from "@chakra-ui/react";
import { DefaultChatTransport, type UIMessage } from "ai";
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
import { useEffect, useMemo, useRef, useState } from "react";
import { Markdown } from "~/components/Markdown";
import { toaster } from "~/components/ui/toaster";
import { aiBrandPalette } from "~/features/traces-v2/components/ai/aiBrandPalette";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { isHandledByGlobalHandler } from "~/utils/trpcError";
import {
  useLangyConversations,
  type LangyConversationSummary,
  type LangyMessageRecord,
} from "./useLangyConversations";

const PANEL_WIDTH = 380;
const PANEL_GUTTER = 16;
const PILL_WIDTH = 30;

export const LANGY_DOCKED_OFFSET = PANEL_WIDTH + PANEL_GUTTER;
export const LANGY_TRANSITION = "240ms cubic-bezier(0.32, 0.72, 0, 1)";

// Single source of truth for the gradient id used by every gradient-stroke
// Sparkle in this component. Defined once in <SparkleGradientDefs /> and
// referenced via `stroke="url(#langy-sparkle-grad)"`. Mirrors AiPromptInput.
const SPARKLE_GRADIENT_ID = "langy-sparkle-grad";

// Static three-stop AI brand gradient. Used for the LANGY pill, Send and
// Apply buttons. Mirrors the colours of MeshGradient + AskAiButton so Langy
// reads as the same AI surface as the rest of the product.
const AI_GRADIENT = `linear-gradient(135deg, ${aiBrandPalette[0]} 0%, ${aiBrandPalette[1]} 50%, ${aiBrandPalette[2]} 100%)`;

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
  const setIsOpen = (next: boolean) => {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  };

  return (
    <>
      <SparkleGradientDefs />
      <LangyHandle isOpen={isOpen} onToggle={() => setIsOpen(!isOpen)} />
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

function SparkleTile({
  size,
  sparkleSize,
  hero = false,
}: {
  size: number;
  sparkleSize: number;
  hero?: boolean;
}) {
  return (
    <Box
      width={`${size}px`}
      height={`${size}px`}
      borderRadius={hero ? "full" : "8px"}
      background={hero ? AI_BG_SUBTLE : AI_BG_SUBTLE}
      borderWidth="1px"
      borderStyle="solid"
      borderColor={AI_BORDER}
      display="grid"
      placeItems="center"
      flexShrink={0}
      boxShadow={hero ? AI_SHADOW_SOFT : undefined}
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
  return (
    <chakra.button
      type="button"
      onClick={onToggle}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-label={isOpen ? "Close Langy" : "Open Langy assistant"}
      position="fixed"
      right={isOpen ? `${PANEL_WIDTH + PANEL_GUTTER + 4}px` : 0}
      top="50%"
      width={`${PILL_WIDTH}px`}
      paddingY="14px"
      zIndex={1600}
      cursor="pointer"
      borderTopLeftRadius="999px"
      borderBottomLeftRadius="999px"
      background={AI_GRADIENT}
      borderWidth="1px"
      borderStyle="solid"
      borderColor="rgba(255,255,255,0.18)"
      borderRightWidth={0}
      color="white"
      boxShadow={hover ? AI_SHADOW : AI_SHADOW_SOFT}
      transform={hover ? "translate(-2px, -50%)" : "translateY(-50%)"}
      transition={`right ${LANGY_TRANSITION}, transform 180ms ease, box-shadow 180ms ease`}
    >
      <VStack gap={2} align="center" justify="center">
        <Sparkles size={14} color="white" />
        <Text
          fontSize="11px"
          fontWeight="700"
          letterSpacing="1.4px"
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
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id;

  const [input, setInput] = useState("");
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
    await sendMessage(
      { role: "user", parts: [{ type: "text", text }] },
      { body: { projectId, experimentSlug } },
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
      top={2}
      right={2}
      bottom={2}
      width={`${PANEL_WIDTH}px`}
      zIndex={1500}
      borderRadius="14px"
      background="bg.surface"
      borderWidth="1px"
      borderStyle="solid"
      borderColor="border.muted"
      boxShadow="0 24px 48px -16px rgba(0, 0, 0, 0.18), 0 2px 6px rgba(0, 0, 0, 0.06)"
      overflow="hidden"
      transition={`transform ${LANGY_TRANSITION}, opacity 220ms ease`}
      transform={
        isOpen
          ? "translateX(0)"
          : `translateX(calc(${PANEL_WIDTH}px + ${PANEL_GUTTER}px))`
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
    <HStack
      paddingY="14px"
      paddingLeft="18px"
      paddingRight="14px"
      borderBottomWidth="1px"
      borderColor="border.muted"
      gap={2.5}
      flexShrink={0}
    >
      <SparkleTile size={28} sparkleSize={15} />
      <VStack align="start" gap={0} flex={1} minWidth={0}>
        <Text fontSize="14px" fontWeight="600" lineHeight="1.2" color="fg">
          Langy
        </Text>
        <Text
          fontSize="11.5px"
          color="fg.muted"
          lineHeight="1.3"
          marginTop="1px"
          truncate
        >
          {subtitle}
        </Text>
      </VStack>
      <HeaderIconButton aria-label="New chat" onClick={onNewChat}>
        <Plus size={17} />
      </HeaderIconButton>
      <HeaderIconButton aria-label="Close Langy" onClick={onClose}>
        <X size={17} />
      </HeaderIconButton>
    </HStack>
  );
}

function HeaderIconButton({
  children,
  ...rest
}: {
  children: React.ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <chakra.button
      type="button"
      width="30px"
      height="30px"
      borderRadius="8px"
      borderWidth={0}
      background="transparent"
      color="fg.muted"
      cursor="pointer"
      display="grid"
      placeItems="center"
      transition="background 120ms ease, color 120ms ease"
      _hover={{ background: "bg.subtle", color: "fg" }}
      {...rest}
    >
      {children}
    </chakra.button>
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
    <VStack
      align="stretch"
      gap={1}
      paddingX="14px"
      paddingY="10px"
      borderBottomWidth="1px"
      borderColor="border.muted"
      background="bg.subtle"
      flexShrink={0}
      maxHeight="220px"
      overflowY="auto"
    >
      <Text
        fontSize="10.5px"
        fontWeight="600"
        letterSpacing="0.5px"
        color="fg.muted"
        textTransform="uppercase"
        paddingX="4px"
        paddingBottom="4px"
      >
        Recent chats
      </Text>
      {isLoading ? (
        <HStack
          gap={2}
          paddingX="4px"
          paddingY="6px"
          aria-label="Loading recent conversations"
        >
          <Spinner size="xs" />
          <Text fontSize="xs" color="fg.muted">
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
              <chakra.button
                type="button"
                onClick={() => onSelect(conv.id)}
                flex={1}
                textAlign="left"
                paddingX="8px"
                paddingY="7px"
                borderRadius="6px"
                fontSize="12.5px"
                color="fg"
                cursor="pointer"
                truncate
                background="transparent"
                borderWidth={0}
                _hover={{ background: "bg.surface" }}
              >
                {conv.title ?? "Untitled"}
              </chakra.button>
              <IconButton
                size="2xs"
                variant="ghost"
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
  );
}

function EmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <VStack
      gap={0}
      align="center"
      justify="center"
      flex={1}
      paddingX="24px"
      paddingY="32px"
      height="full"
    >
      <SparkleTile size={64} sparkleSize={28} hero />
      <Text
        fontSize="20px"
        fontWeight="600"
        letterSpacing="-0.3px"
        color="fg"
        textAlign="center"
        marginTop="18px"
      >
        How can I help?
      </Text>
      <Text
        fontSize="13px"
        color="fg.muted"
        lineHeight="1.5"
        textAlign="center"
        maxWidth="280px"
        marginTop="8px"
        marginBottom="22px"
      >
        Ask in plain language. I&apos;ll read your traces and evals, then
        propose changes you can apply.
      </Text>
      <HStack gap="6px" flexWrap="wrap" justify="center" maxWidth="320px">
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
  const [hover, setHover] = useState(false);
  return (
    <chakra.button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      appearance="none"
      paddingX="12px"
      paddingY="7px"
      borderRadius="999px"
      borderWidth="1px"
      borderStyle="solid"
      borderColor={hover ? AI_BORDER : "border.emphasized"}
      background={hover ? AI_BG_HOVER : "bg.subtle"}
      color="fg"
      fontSize="12.5px"
      fontWeight={500}
      lineHeight="1.2"
      cursor="pointer"
      transition="all 120ms ease"
      whiteSpace="nowrap"
      boxShadow={hover ? "0 1px 2px rgba(168, 85, 247, 0.12)" : "none"}
    >
      {children}
    </chakra.button>
  );
}

function ThinkingIndicator({ messages }: { messages: UIMessage[] }) {
  const last = messages.at(-1);
  const activeTool =
    last?.role === "assistant"
      ? last.parts.findLast((part) => part.type?.startsWith("tool-"))
      : undefined;
  const label = activeTool?.type
    ? activeTool.type.replace(/^tool-/, "").replace(/_/g, " ")
    : "thinking";

  return (
    <HStack gap={2} alignSelf="flex-start" color="fg.muted">
      <SparkleTile size={24} sparkleSize={12} />
      <HStack
        gap={2}
        paddingX="10px"
        paddingY="6px"
        borderRadius="10px"
        background="bg.subtle"
        borderWidth="1px"
        borderColor="border.muted"
      >
        <Spinner size="xs" colorPalette="purple" />
        <Text fontSize="12px">Langy is {label}…</Text>
      </HStack>
    </HStack>
  );
}

function Composer({
  input,
  onInputChange,
  onSend,
  onStop,
  isBusy,
  disabled,
  canSend,
}: {
  input: string;
  onInputChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  isBusy: boolean;
  disabled: boolean;
  canSend: boolean;
}) {
  const filled = input.trim().length > 0;
  return (
    <Box
      paddingX="14px"
      paddingTop="12px"
      paddingBottom="14px"
      borderTopWidth="1px"
      borderColor="border.muted"
      background="bg.surface"
      flexShrink={0}
    >
      <HStack
        gap={2}
        paddingY="6px"
        paddingLeft="14px"
        paddingRight="6px"
        borderRadius="999px"
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
            isBusy ? "Langy is working…" : "Ask Langy or describe what you want…"
          }
          disabled={disabled || isBusy}
          rows={1}
          autoresize
          maxHeight="120px"
          minHeight="22px"
          padding={0}
          border="none"
          background="transparent"
          fontSize="13.5px"
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
            background={canSend ? AI_GRADIENT : "#f5f5f4"}
            color={canSend ? "white" : "var(--chakra-colors-fg-muted)"}
            shadow={canSend}
            cursor={canSend ? "pointer" : "default"}
          >
            <Send size={14} />
          </SendButton>
        )}
      </HStack>
      <Text
        marginTop="8px"
        fontSize="10.5px"
        color="fg.muted"
        textAlign="center"
        letterSpacing="0.1px"
      >
        Langy proposes — you review and apply.
      </Text>
    </Box>
  );
}

function SendButton({
  children,
  background,
  color,
  shadow,
  cursor,
  ...rest
}: {
  children: React.ReactNode;
  background: string;
  color: string;
  shadow: boolean;
  cursor: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <chakra.button
      type="button"
      width="32px"
      height="32px"
      borderRadius="999px"
      borderWidth={0}
      background={background}
      color={color}
      cursor={cursor}
      display="grid"
      placeItems="center"
      flexShrink={0}
      boxShadow={shadow ? AI_SHADOW : undefined}
      transition="background 150ms ease, box-shadow 150ms ease"
      {...rest}
    >
      {children}
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
          paddingX="13px"
          paddingY="9px"
          background="#1c1917"
          color="white"
          borderRadius="14px"
          borderBottomRightRadius="4px"
          fontSize="13px"
          lineHeight="1.45"
          whiteSpace="pre-wrap"
        >
          {text}
        </Box>
      </Box>
    );
  }

  return (
    <HStack gap="9px" align="flex-start" width="full">
      <SparkleTile size={24} sparkleSize={12} />
      <VStack align="stretch" gap="10px" flex={1} minWidth={0}>
        {text && (
          <Box
            fontSize="13px"
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
      borderRadius="12px"
      padding="12px"
      background="bg.subtle"
      opacity={isDiscarded ? 0.65 : 1}
      cursor={hasOpen ? "pointer" : "default"}
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
        gap="6px"
        marginBottom="8px"
        fontSize="10.5px"
        fontWeight="600"
        letterSpacing="0.5px"
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
      <Text fontSize="13px" fontWeight="600" color="fg" marginBottom="2px">
        {proposal.summary}
      </Text>
      {proposal.rationale && (
        <Text
          fontSize="12px"
          color="fg.muted"
          lineHeight="1.45"
          marginBottom="12px"
        >
          {proposal.rationale}
        </Text>
      )}
      {!isApplied && !isDiscarded && (
        <HStack gap="6px" paddingTop={proposal.rationale ? "0px" : "10px"}>
          <chakra.button
            type="button"
            flex={1}
            paddingX="12px"
            paddingY="8px"
            borderRadius="8px"
            borderWidth={0}
            background={
              destructive ? "var(--chakra-colors-red-solid)" : AI_GRADIENT
            }
            color="white"
            fontSize="12.5px"
            fontWeight={500}
            cursor={isApplying ? "default" : "pointer"}
            opacity={isApplying ? 0.7 : 1}
            display="flex"
            alignItems="center"
            justifyContent="center"
            gap="5px"
            boxShadow={destructive ? undefined : AI_SHADOW}
            onClick={onApply}
            disabled={isApplying}
          >
            <Check size={12} />
            {isApplying
              ? destructive
                ? "Deleting…"
                : "Applying…"
              : destructive
                ? "Delete"
                : "Apply"}
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
        <HStack paddingTop="10px">
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
