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
import { useEffect, useRef, useState } from "react";
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
const HANDLE_WIDTH = 28;

const SYSTEM_FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Inter", "Segoe UI", Roboto, sans-serif';

const SAMPLE_PROMPTS = [
  "What evaluators do I have available?",
  "Suggest an evaluator for measuring RAG hallucinations and add it to my workbench",
  "List my prompts and datasets",
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
}

export function SageDrawer({ proposalHandlers }: SageDrawerProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <SageHandle isOpen={isOpen} onToggle={() => setIsOpen((v) => !v)} />
      <SagePanel
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        proposalHandlers={proposalHandlers}
      />
    </>
  );
}

function SageHandle({
  isOpen,
  onToggle,
}: {
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <Box
      as="button"
      onClick={onToggle}
      aria-label={isOpen ? "Close Sage" : "Open Sage"}
      position="fixed"
      right={isOpen ? `${DRAWER_WIDTH}px` : 0}
      top="50%"
      transform="translateY(-50%)"
      width={`${HANDLE_WIDTH}px`}
      height="96px"
      zIndex={1600}
      cursor="pointer"
      borderTopLeftRadius="18px"
      borderBottomLeftRadius="18px"
      borderTopRightRadius={0}
      borderBottomRightRadius={0}
      style={{
        background:
          "linear-gradient(135deg, rgba(167, 139, 250, 0.95), rgba(124, 58, 237, 0.95))",
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
        boxShadow:
          "-8px 0 32px rgba(124, 58, 237, 0.28), inset 1px 0 0 rgba(255,255,255,0.2)",
        border: "1px solid rgba(255,255,255,0.18)",
        borderRight: "none",
        transition:
          "right 360ms cubic-bezier(0.32, 0.72, 0, 1), transform 220ms ease, box-shadow 220ms ease",
      }}
      _hover={{
        transform: "translate(-3px, -50%)",
      }}
    >
      <VStack gap={1} height="full" justify="center" color="white">
        <LuSparkles size={14} />
        <Text
          fontSize="10px"
          fontWeight="semibold"
          letterSpacing="0.12em"
          style={{
            writingMode: "vertical-rl",
            textOrientation: "mixed",
            transform: "rotate(180deg)",
            fontFamily: SYSTEM_FONT_STACK,
          }}
        >
          SAGE
        </Text>
      </VStack>
    </Box>
  );
}

function SagePanel({
  isOpen,
  onClose,
  proposalHandlers,
}: {
  isOpen: boolean;
  onClose: () => void;
  proposalHandlers?: ProposalHandlers;
}) {
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
      { body: { projectId } },
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
      position="fixed"
      top={0}
      right={0}
      height="100vh"
      width={`${DRAWER_WIDTH}px`}
      zIndex={1500}
      style={{
        transform: isOpen ? "translateX(0)" : `translateX(${DRAWER_WIDTH}px)`,
        transition: "transform 360ms cubic-bezier(0.32, 0.72, 0, 1)",
        background:
          "linear-gradient(180deg, rgba(252, 251, 255, 0.82) 0%, rgba(245, 243, 255, 0.78) 100%)",
        backdropFilter: "blur(40px) saturate(180%)",
        WebkitBackdropFilter: "blur(40px) saturate(180%)",
        borderLeft: "1px solid rgba(124, 58, 237, 0.1)",
        boxShadow:
          "-32px 0 60px rgba(15, 23, 42, 0.12), inset 1px 0 0 rgba(255,255,255,0.6)",
        borderTopLeftRadius: "24px",
        borderBottomLeftRadius: "24px",
        fontFamily: SYSTEM_FONT_STACK,
      }}
    >
      <VStack gap={0} align="stretch" height="full">
        <PanelHeader onClose={onClose} />
        <Box ref={scrollRef} flex={1} overflowY="auto" paddingX={5} paddingY={4}>
          {messages.length === 0 ? (
            <EmptyState onPick={(prompt) => void send(prompt)} />
          ) : (
            <VStack gap={4} align="stretch">
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
}

function PanelHeader({ onClose }: { onClose: () => void }) {
  return (
    <HStack
      paddingX={5}
      paddingY={4}
      borderBottom="1px solid"
      borderColor="rgba(124, 58, 237, 0.08)"
      gap={3}
    >
      <Box
        width="32px"
        height="32px"
        borderRadius="10px"
        display="flex"
        alignItems="center"
        justifyContent="center"
        color="white"
        style={{
          background:
            "linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%)",
          boxShadow:
            "0 6px 20px rgba(124, 58, 237, 0.35), inset 0 1px 0 rgba(255,255,255,0.4)",
        }}
      >
        <LuSparkles size={16} />
      </Box>
      <VStack align="start" gap={0}>
        <Text
          fontSize="15px"
          fontWeight="600"
          letterSpacing="-0.01em"
          color="gray.900"
        >
          Sage
        </Text>
        <Text fontSize="11px" color="gray.500" letterSpacing="0.02em">
          Propose &amp; apply
        </Text>
      </VStack>
      <Box flex={1} />
      <IconButton
        size="sm"
        variant="ghost"
        aria-label="Close Sage"
        onClick={onClose}
        borderRadius="10px"
      >
        <LuX size={16} />
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
      color="gray.500"
      fontSize="12px"
      paddingX={3}
      paddingY={2}
      borderRadius="12px"
      style={{
        background: "rgba(255, 255, 255, 0.5)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        border: "1px solid rgba(124, 58, 237, 0.08)",
        alignSelf: "flex-start",
      }}
    >
      <Spinner size="xs" colorPalette="purple" />
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
      paddingX={4}
      paddingY={4}
      borderTop="1px solid"
      borderColor="rgba(124, 58, 237, 0.08)"
    >
      <HStack
        gap={2}
        paddingX={2}
        paddingY={2}
        borderRadius="14px"
        style={{
          background: "rgba(255, 255, 255, 0.75)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          border: "1px solid rgba(124, 58, 237, 0.12)",
          boxShadow: "0 1px 3px rgba(15, 23, 42, 0.04)",
        }}
      >
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
          border="none"
          _focus={{ outline: "none", boxShadow: "none" }}
          _focusVisible={{ outline: "none", boxShadow: "none" }}
          fontSize="13px"
          color="gray.800"
        />
        <IconButton
          size="sm"
          aria-label="Send"
          onClick={onSend}
          disabled={!canSend}
          borderRadius="10px"
          style={{
            background: canSend
              ? "linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%)"
              : "rgba(124, 58, 237, 0.15)",
            color: "white",
            boxShadow: canSend
              ? "0 4px 12px rgba(124, 58, 237, 0.35)"
              : "none",
            transition: "all 200ms ease",
          }}
        >
          <LuSend size={14} />
        </IconButton>
      </HStack>
    </Box>
  );
}

function EmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <VStack align="stretch" gap={4} paddingTop={4}>
      <VStack align="start" gap={2}>
        <Text
          fontSize="15px"
          fontWeight="600"
          color="gray.900"
          letterSpacing="-0.01em"
        >
          Hey, I&apos;m Sage.
        </Text>
        <Text fontSize="13px" color="gray.600" lineHeight="1.55">
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
            padding={3}
            borderRadius="12px"
            cursor="pointer"
            style={{
              background: "rgba(255, 255, 255, 0.7)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              border: "1px solid rgba(124, 58, 237, 0.1)",
              transition: "all 180ms ease",
            }}
            _hover={{
              transform: "translateY(-1px)",
            }}
            onClick={() => onPick(prompt)}
          >
            <HStack gap={2} align="flex-start">
              <Box color="purple.500" paddingTop="2px">
                <LuArrowRight size={12} />
              </Box>
              <Text fontSize="12.5px" color="gray.700" lineHeight="1.4">
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
            paddingX="14px"
            paddingY="10px"
            borderRadius={isUser ? "16px 16px 4px 16px" : "16px 16px 16px 4px"}
            style={
              isUser
                ? {
                    background:
                      "linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%)",
                    color: "white",
                    boxShadow: "0 4px 14px rgba(124, 58, 237, 0.25)",
                  }
                : {
                    background: "rgba(255, 255, 255, 0.78)",
                    backdropFilter: "blur(12px)",
                    WebkitBackdropFilter: "blur(12px)",
                    border: "1px solid rgba(124, 58, 237, 0.08)",
                    boxShadow: "0 1px 3px rgba(15, 23, 42, 0.04)",
                  }
            }
          >
            {isUser ? (
              <Text fontSize="13px" whiteSpace="pre-wrap" lineHeight="1.5">
                {textParts}
              </Text>
            ) : (
              <Box
                fontSize="13px"
                color="gray.800"
                lineHeight="1.55"
                css={{
                  "& p": { margin: 0 },
                  "& p + p": { marginTop: "6px" },
                  "& ul, & ol": {
                    paddingLeft: "18px",
                    margin: "4px 0",
                  },
                  "& code": {
                    fontSize: "12px",
                    padding: "1px 5px",
                    borderRadius: "4px",
                    background: "rgba(124, 58, 237, 0.08)",
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
  return (
    <Box
      padding={4}
      borderRadius="16px"
      opacity={faded ? 0.7 : 1}
      style={{
        background: isApplied
          ? "linear-gradient(135deg, rgba(220, 252, 231, 0.85), rgba(240, 253, 244, 0.85))"
          : "linear-gradient(135deg, rgba(250, 245, 255, 0.88), rgba(243, 232, 255, 0.88))",
        backdropFilter: "blur(16px) saturate(180%)",
        WebkitBackdropFilter: "blur(16px) saturate(180%)",
        border: isApplied
          ? "1px solid rgba(34, 197, 94, 0.25)"
          : "1px solid rgba(124, 58, 237, 0.18)",
        boxShadow: isApplied
          ? "0 4px 14px rgba(34, 197, 94, 0.12)"
          : "0 6px 20px rgba(124, 58, 237, 0.12)",
        transition: "all 200ms ease",
      }}
    >
      <VStack align="stretch" gap={2}>
        <HStack gap={2}>
          <Box
            width="22px"
            height="22px"
            borderRadius="7px"
            display="flex"
            alignItems="center"
            justifyContent="center"
            color="white"
            style={{
              background: isApplied
                ? "linear-gradient(135deg, #4ade80, #22c55e)"
                : "linear-gradient(135deg, #a78bfa, #7c3aed)",
            }}
          >
            {isApplied ? <LuCheck size={12} /> : <LuSparkles size={12} />}
          </Box>
          <Text
            fontSize="10.5px"
            fontWeight="600"
            letterSpacing="0.08em"
            textTransform="uppercase"
            color={isApplied ? "green.700" : "purple.700"}
          >
            {statusLabel}
          </Text>
        </HStack>
        <Text
          fontSize="13.5px"
          fontWeight="600"
          color="gray.900"
          letterSpacing="-0.005em"
        >
          {proposal.summary}
        </Text>
        {proposal.rationale && (
          <Text fontSize="12px" color="gray.600" lineHeight="1.5">
            {proposal.rationale}
          </Text>
        )}
        {!isApplied && !isDiscarded && (
          <HStack gap={2} paddingTop={1}>
            <Button
              size="xs"
              onClick={onApply}
              borderRadius="10px"
              paddingX={3}
              height="28px"
              style={{
                background: "linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%)",
                color: "white",
                boxShadow: "0 4px 12px rgba(124, 58, 237, 0.3)",
                fontSize: "12px",
                fontWeight: 600,
              }}
            >
              <LuCheck size={12} />
              Apply
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={onDiscard}
              borderRadius="10px"
              paddingX={3}
              height="28px"
              color="gray.600"
              fontSize="12px"
            >
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
