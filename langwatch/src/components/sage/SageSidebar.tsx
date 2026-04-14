import { useChat } from "@ai-sdk/react";
import {
  Box,
  Button,
  HStack,
  IconButton,
  Input,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { forwardRef, useEffect, useRef, useState } from "react";
import {
  LuArrowRight,
  LuCheck,
  LuSend,
  LuSparkles,
  LuX,
} from "react-icons/lu";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { Markdown } from "~/components/Markdown";
import { toaster } from "~/components/ui/toaster";
import { isHandledByGlobalHandler } from "~/utils/trpcError";

const DRAWER_WIDTH = 420;
const HANDLE_WIDTH = 26;

const SAMPLE_PROMPTS = [
  "Summarize my current experiment",
  "Which rows are failing and why?",
  "Suggest an evaluator for measuring RAG hallucinations",
];

export interface SageProposal {
  sageProposal: true;
  kind: string;
  summary: string;
  rationale?: string;
  payload: Record<string, unknown>;
}

export type ProposalHandlers = Record<
  string,
  (payload: Record<string, unknown>) => Promise<void>
>;

interface SageDrawerProps {
  proposalHandlers?: ProposalHandlers;
  experimentSlug?: string;
}

export function SageDrawer({
  proposalHandlers,
  experimentSlug,
}: SageDrawerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (handleRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [isOpen]);

  return (
    <>
      <SageHandle
        ref={handleRef}
        isOpen={isOpen}
        onToggle={() => setIsOpen((v) => !v)}
      />
      <SagePanel
        ref={panelRef}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        proposalHandlers={proposalHandlers}
        experimentSlug={experimentSlug}
      />
    </>
  );
}

const SageHandle = forwardRef<
  HTMLButtonElement,
  { isOpen: boolean; onToggle: () => void }
>(function SageHandle({ isOpen, onToggle }, ref) {
  return (
    <Box
      ref={ref}
      as="button"
      onClick={onToggle}
      aria-label={isOpen ? "Close Sage" : "Open Sage"}
      position="fixed"
      right={isOpen ? `${DRAWER_WIDTH}px` : 0}
      top="50%"
      transform="translateY(-50%)"
      width={`${HANDLE_WIDTH}px`}
      height="84px"
      zIndex={1600}
      cursor="pointer"
      borderTopLeftRadius="lg"
      borderBottomLeftRadius="lg"
      background="bg.surface/80"
      backdropFilter="blur(25px)"
      borderWidth="1px"
      borderColor="border.emphasized"
      borderRightWidth={0}
      boxShadow="sm"
      color="fg.muted"
      transition="right 360ms cubic-bezier(0.32, 0.72, 0, 1), transform 180ms ease, color 180ms ease, background 180ms ease"
      _hover={{
        transform: "translate(-2px, -50%)",
        color: "blue.fg",
        background: "bg.panel/90",
      }}
    >
      <VStack gap={1.5} height="full" justify="center">
        <LuSparkles size={14} />
        <Text
          fontSize="10px"
          fontWeight="600"
          letterSpacing="0.12em"
          style={{
            writingMode: "vertical-rl",
            textOrientation: "mixed",
            transform: "rotate(180deg)",
          }}
        >
          SAGE
        </Text>
      </VStack>
    </Box>
  );
});

const SagePanel = forwardRef<
  HTMLDivElement,
  {
    isOpen: boolean;
    onClose: () => void;
    proposalHandlers?: ProposalHandlers;
    experimentSlug?: string;
  }
>(function SagePanel(
  { isOpen, onClose, proposalHandlers, experimentSlug },
  ref,
) {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id;

  const [input, setInput] = useState("");
  const [appliedProposals, setAppliedProposals] = useState<Set<string>>(
    new Set(),
  );
  const [discardedProposals, setDiscardedProposals] = useState<Set<string>>(
    new Set(),
  );
  const scrollRef = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: "/api/sage/chat" }),
    onError: (error) => {
      if (isHandledByGlobalHandler(error)) return;
      toaster.create({
        title: "Sage error",
        description: error.message,
        type: "error",
        duration: 5000,
        meta: { closable: true },
      });
    },
  });

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, status]);

  const isBusy = status === "submitted" || status === "streaming";

  const send = async (text: string) => {
    if (!text.trim() || !projectId || isBusy) return;
    setInput("");
    await sendMessage(
      { role: "user", parts: [{ type: "text", text }] },
      { body: { projectId, experimentSlug } },
    );
  };

  const applyProposal = async (
    proposalId: string,
    proposal: SageProposal,
  ) => {
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
    try {
      await handler(proposal.payload);
      setAppliedProposals((prev) => new Set(prev).add(proposalId));
      toaster.create({
        title: "Applied",
        description: proposal.summary,
        type: "success",
        duration: 3000,
        meta: { closable: true },
      });
    } catch (error) {
      if (isHandledByGlobalHandler(error)) return;
      toaster.create({
        title: "Failed to apply",
        description: error instanceof Error ? error.message : "Unknown error",
        type: "error",
        duration: 5000,
        meta: { closable: true },
      });
    }
  };

  const discardProposal = (proposalId: string) => {
    setDiscardedProposals((prev) => new Set(prev).add(proposalId));
  };

  return (
    <Box
      ref={ref}
      position="fixed"
      top={2}
      right={2}
      bottom={2}
      width={`${DRAWER_WIDTH}px`}
      zIndex={1500}
      borderRadius="lg"
      background="bg.surface/80"
      backdropFilter="blur(25px)"
      borderWidth="1px"
      borderColor="border.emphasized"
      boxShadow="lg"
      transition="transform 360ms cubic-bezier(0.32, 0.72, 0, 1), opacity 200ms ease"
      transform={
        isOpen ? "translateX(0)" : `translateX(calc(${DRAWER_WIDTH}px + 16px))`
      }
      opacity={isOpen ? 1 : 0}
      pointerEvents={isOpen ? "auto" : "none"}
    >
      <VStack gap={0} align="stretch" height="full">
        <PanelHeader onClose={onClose} />
        <Box ref={scrollRef} flex={1} overflowY="auto" paddingX={4} paddingY={4}>
          {messages.length === 0 ? (
            <EmptyState onPick={(prompt) => void send(prompt)} />
          ) : (
            <VStack gap={3} align="stretch">
              {messages.map((message) => (
                <MessageContent
                  key={message.id}
                  message={message}
                  appliedProposals={appliedProposals}
                  discardedProposals={discardedProposals}
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
          disabled={isBusy || !projectId}
          canSend={!!input.trim() && !isBusy && !!projectId}
        />
      </VStack>
    </Box>
  );
});

function PanelHeader({ onClose }: { onClose: () => void }) {
  return (
    <HStack
      paddingX={4}
      paddingY={3}
      borderBottomWidth="1px"
      borderColor="border.muted"
      gap={3}
    >
      <Box
        width="28px"
        height="28px"
        borderRadius="md"
        display="flex"
        alignItems="center"
        justifyContent="center"
        background="blue.subtle"
        color="blue.fg"
      >
        <LuSparkles size={14} />
      </Box>
      <VStack align="start" gap={0}>
        <Text fontSize="sm" fontWeight="600" color="fg">
          Sage
        </Text>
        <Text fontSize="xs" color="fg.muted">
          Propose &amp; apply
        </Text>
      </VStack>
      <Box flex={1} />
      <IconButton
        size="xs"
        variant="ghost"
        aria-label="Close Sage"
        onClick={onClose}
      >
        <LuX size={14} />
      </IconButton>
    </HStack>
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
    <HStack
      color="fg.muted"
      fontSize="xs"
      paddingX={3}
      paddingY={2}
      borderRadius="md"
      background="bg.subtle"
      borderWidth="1px"
      borderColor="border.muted"
      alignSelf="flex-start"
    >
      <Spinner size="xs" colorPalette="blue" />
      <Text>Sage is {label}…</Text>
    </HStack>
  );
}

function Composer({
  input,
  onInputChange,
  onSend,
  disabled,
  canSend,
}: {
  input: string;
  onInputChange: (v: string) => void;
  onSend: () => void;
  disabled: boolean;
  canSend: boolean;
}) {
  return (
    <Box
      paddingX={3}
      paddingY={3}
      borderTopWidth="1px"
      borderColor="border.muted"
    >
      <HStack gap={2}>
        <Input
          placeholder="Ask Sage or describe what you want…"
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          disabled={disabled}
          size="sm"
          variant="outline"
          borderColor="border.emphasized"
          background="bg.panel"
        />
        <IconButton
          size="sm"
          colorPalette="blue"
          aria-label="Send"
          onClick={onSend}
          disabled={!canSend}
        >
          <LuSend size={14} />
        </IconButton>
      </HStack>
    </Box>
  );
}

function EmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <VStack align="stretch" gap={3} paddingTop={2}>
      <VStack align="start" gap={1}>
        <Text fontSize="sm" fontWeight="600" color="fg">
          Hey, I&apos;m Sage.
        </Text>
        <Text fontSize="xs" color="fg.muted" lineHeight="1.55">
          I can propose evaluators, help you pick the right one for your
          experiment, and (soon) touch prompts and datasets. Try:
        </Text>
      </VStack>
      <VStack align="stretch" gap={2}>
        {SAMPLE_PROMPTS.map((prompt) => (
          <Box
            key={prompt}
            as="button"
            textAlign="left"
            paddingX={3}
            paddingY="10px"
            borderRadius="md"
            cursor="pointer"
            background="bg.panel"
            borderWidth="1px"
            borderColor="border.muted"
            boxShadow="2xs"
            transition="background 150ms ease, border-color 150ms ease"
            _hover={{
              background: "bg.subtle",
              borderColor: "border.emphasized",
            }}
            onClick={() => onPick(prompt)}
          >
            <HStack gap={2} align="flex-start">
              <Box color="blue.fg" paddingTop="2px">
                <LuArrowRight size={12} />
              </Box>
              <Text fontSize="xs" color="fg" lineHeight="1.5">
                {prompt}
              </Text>
            </HStack>
          </Box>
        ))}
      </VStack>
    </VStack>
  );
}

function MessageContent({
  message,
  appliedProposals,
  discardedProposals,
  onApply,
  onDiscard,
}: {
  message: UIMessage;
  appliedProposals: Set<string>;
  discardedProposals: Set<string>;
  onApply: (proposalId: string, proposal: SageProposal) => Promise<void>;
  onDiscard: (proposalId: string) => void;
}) {
  const isUser = message.role === "user";
  const textParts = message.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("");

  const proposals = extractProposals(message);

  if (!textParts && proposals.length === 0) return null;

  return (
    <VStack align="stretch" gap={2} width="full">
      {textParts && (
        <Box
          width="full"
          display="flex"
          justifyContent={isUser ? "flex-end" : "flex-start"}
        >
          <Box
            maxWidth="88%"
            paddingX={3}
            paddingY={2}
            borderRadius="md"
            borderTopRightRadius={isUser ? "sm" : "md"}
            borderTopLeftRadius={isUser ? "md" : "sm"}
            background={isUser ? "blue.solid" : "bg.panel"}
            color={isUser ? "white" : "fg"}
            borderWidth={isUser ? 0 : "1px"}
            borderColor="border.muted"
            boxShadow="2xs"
          >
            {isUser ? (
              <Text fontSize="sm" whiteSpace="pre-wrap" lineHeight="1.5">
                {textParts}
              </Text>
            ) : (
              <Box
                fontSize="sm"
                lineHeight="1.55"
                css={{
                  "& p": { margin: 0 },
                  "& p + p": { marginTop: "6px" },
                  "& ul, & ol": { paddingLeft: "18px", margin: "4px 0" },
                  "& code": {
                    fontSize: "12px",
                    padding: "1px 5px",
                    borderRadius: "4px",
                    background: "bg.subtle",
                  },
                }}
              >
                <Markdown>{textParts}</Markdown>
              </Box>
            )}
          </Box>
        </Box>
      )}
      {proposals.map(({ id, proposal }) => (
        <ProposalCard
          key={id}
          proposal={proposal}
          isApplied={appliedProposals.has(id)}
          isDiscarded={discardedProposals.has(id)}
          onApply={() => void onApply(id, proposal)}
          onDiscard={() => onDiscard(id)}
        />
      ))}
    </VStack>
  );
}

function ProposalCard({
  proposal,
  isApplied,
  isDiscarded,
  onApply,
  onDiscard,
}: {
  proposal: SageProposal;
  isApplied: boolean;
  isDiscarded: boolean;
  onApply: () => void;
  onDiscard: () => void;
}) {
  const faded = isApplied || isDiscarded;
  const statusLabel = isApplied
    ? "Applied"
    : isDiscarded
      ? "Discarded"
      : "Sage proposes";
  const accentPalette = isApplied ? "green" : "blue";

  return (
    <Box
      padding={3}
      borderRadius="lg"
      background="bg.panel"
      borderWidth="1px"
      borderColor={isApplied ? "green.emphasized" : "blue.emphasized"}
      boxShadow="sm"
      opacity={faded ? 0.75 : 1}
    >
      <VStack align="stretch" gap={2}>
        <HStack gap={2}>
          <Box
            width="20px"
            height="20px"
            borderRadius="sm"
            display="flex"
            alignItems="center"
            justifyContent="center"
            background={`${accentPalette}.subtle`}
            color={`${accentPalette}.fg`}
          >
            {isApplied ? <LuCheck size={12} /> : <LuSparkles size={12} />}
          </Box>
          <Text
            fontSize="10px"
            fontWeight="600"
            letterSpacing="0.08em"
            textTransform="uppercase"
            color={`${accentPalette}.fg`}
          >
            {statusLabel}
          </Text>
        </HStack>
        <Text fontSize="sm" fontWeight="600" color="fg">
          {proposal.summary}
        </Text>
        {proposal.rationale && (
          <Text fontSize="xs" color="fg.muted" lineHeight="1.5">
            {proposal.rationale}
          </Text>
        )}
        {!isApplied && !isDiscarded && (
          <HStack gap={2} paddingTop={1}>
            <Button size="xs" colorPalette="blue" onClick={onApply}>
              <LuCheck size={12} />
              Apply
            </Button>
            <Button size="xs" variant="ghost" onClick={onDiscard}>
              Discard
            </Button>
          </HStack>
        )}
      </VStack>
    </Box>
  );
}

function extractProposals(
  message: UIMessage,
): Array<{ id: string; proposal: SageProposal }> {
  const result: Array<{ id: string; proposal: SageProposal }> = [];
  for (const part of message.parts) {
    if (!part.type?.startsWith("tool-")) continue;
    const output = (part as { output?: unknown }).output;
    if (!isSageProposal(output)) continue;
    const id =
      (part as { toolCallId?: string }).toolCallId ??
      `${message.id}:${result.length}`;
    result.push({ id, proposal: output });
  }
  return result;
}

function isSageProposal(value: unknown): value is SageProposal {
  return (
    !!value &&
    typeof value === "object" &&
    (value as Record<string, unknown>).sageProposal === true &&
    typeof (value as Record<string, unknown>).kind === "string" &&
    typeof (value as Record<string, unknown>).summary === "string"
  );
}
