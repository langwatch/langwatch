import {
  Box,
  Button,
  Flex,
  HStack,
  Icon,
  Skeleton,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Settings2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConversationTurns } from "../../../hooks/useConversationTurns";
import { useTraceDrawerNavigation } from "../../../hooks/useTraceDrawerNavigation";
import type { TraceListItem } from "../../../types/trace";
import { RenderedMarkdown } from "../markdownView";
import { SegmentedToggle } from "../SegmentedToggle";
import { extractReadableText, extractReasoningText } from "../transcript";
import { AnnotationsView } from "./AnnotationsView";
import { ChatTurnRow } from "./ChatTurnRow";
import { EMPTY_TURNS, type Mode, type ParsedTurn } from "./types";
import {
  buildConversationMarkdown,
  parseLastUserText,
  parseSystemPrompt,
} from "./utils";

interface ConversationViewProps {
  conversationId: string;
  currentTraceId: string;
}

export function ConversationView({
  conversationId,
  currentTraceId,
}: ConversationViewProps) {
  const { navigateToTrace } = useTraceDrawerNavigation();
  const [mode, setMode] = useState<Mode>("bubbles");
  const query = useConversationTurns(conversationId);

  const turns =
    (query.data?.items as TraceListItem[] | undefined) ?? EMPTY_TURNS;

  // Single pass over `turns`: pre-parse the latest user message and the
  // wall-clock gap to the previous turn. Without this, every ChatTurnRow
  // re-render would re-JSON.parse the entire input payload on its own.
  const parsedTurns = useMemo<ParsedTurn[]>(() => {
    const out: ParsedTurn[] = new Array(turns.length);
    for (let i = 0; i < turns.length; i++) {
      const t = turns[i]!;
      const prev = i > 0 ? turns[i - 1]! : undefined;
      const gapSecs = prev
        ? (t.timestamp - (prev.timestamp + prev.durationMs)) / 1000
        : 0;
      out[i] = {
        turn: t,
        // Use the shared Transcript helper so we handle the same shapes
        // the I/O viewer does (chat arrays, single message objects,
        // typed-block content arrays). parseLastUserText only handled
        // chat arrays, missing single-message and bare-block envelopes.
        userText:
          extractReadableText(t.input, "user") || parseLastUserText(t.input),
        assistantText: extractReadableText(t.output, "assistant"),
        assistantReasoning: extractReasoningText(t.output),
        gapSecs,
        showGap: gapSecs > 5,
      };
    }
    return out;
  }, [turns]);

  // Stable select callback. Closes over a ref instead of `currentTraceId` so
  // its identity doesn't change every time the user navigates to a different
  // turn — otherwise every row's memo would bail on each navigation even
  // though only the previously- and newly-selected rows actually change.
  const currentTraceIdRef = useRef(currentTraceId);
  useEffect(() => {
    currentTraceIdRef.current = currentTraceId;
  }, [currentTraceId]);
  const handleSelectTurn = useCallback(
    (traceId: string) => {
      navigateToTrace({
        fromTraceId: currentTraceIdRef.current,
        fromViewMode: "conversation",
        toTraceId: traceId,
        toViewMode: "trace",
      });
    },
    [navigateToTrace],
  );

  // Build markdown at the parent so the result survives mode toggles. Stay
  // lazy: skip the build until the user has actually viewed markdown at least
  // once, so first render in bubbles mode pays nothing.
  const [hasViewedMarkdown, setHasViewedMarkdown] = useState(
    () => mode === "markdown",
  );
  useEffect(() => {
    if (mode === "markdown") setHasViewedMarkdown(true);
  }, [mode]);
  const markdown = useMemo(() => {
    if (!hasViewedMarkdown) return "";
    return buildConversationMarkdown(conversationId, parsedTurns);
  }, [hasViewedMarkdown, conversationId, parsedTurns]);

  // Only show the skeleton on the very first load. With keepPreviousData
  // the previous conversation's turns stay rendered while the new query
  // fetches in the background, so re-clicking a cached conversation no
  // longer flashes the skeleton.
  if (query.isLoading && !query.data) {
    return <ConversationSkeleton conversationId={conversationId} />;
  }

  if (turns.length === 0) {
    return (
      <Flex align="center" justify="center" padding={6}>
        <Text textStyle="xs" color="fg.subtle">
          No turns found in this conversation
        </Text>
      </Flex>
    );
  }

  return (
    <VStack align="stretch" gap={0} height="full">
      <ConversationHeader
        conversationId={conversationId}
        turnCount={turns.length}
        mode={mode}
        onModeChange={setMode}
      />
      {mode === "bubbles" ? (
        <BubblesView
          parsedTurns={parsedTurns}
          systemPromptInput={turns[0]?.input}
          currentTraceId={currentTraceId}
          onSelectTurn={handleSelectTurn}
        />
      ) : mode === "annotations" ? (
        <AnnotationsView
          parsedTurns={parsedTurns}
          currentTraceId={currentTraceId}
        />
      ) : (
        <MarkdownConversationView markdown={markdown} />
      )}
    </VStack>
  );
}

const SKELETON_TURNS: { user: string; assistant: [string, string?] }[] = [
  { user: "62%", assistant: ["88%", "54%"] },
  { user: "44%", assistant: ["76%"] },
  { user: "70%", assistant: ["92%", "68%"] },
];

const ConversationSkeleton: React.FC<{ conversationId: string }> = ({
  conversationId,
}) => {
  return (
    <VStack
      align="stretch"
      gap={0}
      height="full"
      aria-busy="true"
      aria-label="Loading conversation"
    >
      <HStack
        gap={2}
        paddingX={4}
        paddingY={2.5}
        borderBottomWidth="1px"
        borderColor="border.muted"
        bg="bg.subtle"
        flexShrink={0}
      >
        <Text
          textStyle="2xs"
          color="fg.muted"
          textTransform="uppercase"
          letterSpacing="0.06em"
          fontWeight="semibold"
        >
          Conversation
        </Text>
        <Text textStyle="xs" color="fg.subtle" fontFamily="mono" truncate>
          {conversationId}
        </Text>
        <Box flex={1} />
        <Skeleton height="10px" width="40px" borderRadius="sm" />
        <Skeleton height="20px" width="96px" borderRadius="md" />
      </HStack>

      <VStack
        align="stretch"
        gap={5}
        paddingX={5}
        paddingY={4}
        overflow="hidden"
      >
        {SKELETON_TURNS.map((turn, i) => (
          <VStack key={i} align="stretch" gap={2}>
            <Flex align="center" gap={2}>
              <Skeleton height="14px" width="20px" borderRadius="sm" />
              <Box height="1px" flex={1} bg="border.muted" />
              <Skeleton height="10px" width="48px" borderRadius="sm" />
            </Flex>

            <HStack align="flex-start" gap={2}>
              <Skeleton boxSize="22px" borderRadius="full" flexShrink={0} />
              <VStack
                align="stretch"
                gap={1}
                flex={1}
                maxWidth="78%"
                borderRadius="lg"
                borderTopLeftRadius="sm"
                borderWidth="1px"
                borderColor="border.muted"
                bg="bg.subtle"
                paddingX={3}
                paddingY={2}
              >
                <Skeleton height="9px" width="32px" borderRadius="sm" />
                <Skeleton height="11px" width={turn.user} borderRadius="sm" />
              </VStack>
            </HStack>

            <HStack align="flex-start" gap={2} justify="flex-end">
              <VStack
                align="stretch"
                gap={1}
                flex={1}
                maxWidth="78%"
                borderRadius="lg"
                borderTopRightRadius="sm"
                borderWidth="1px"
                borderColor="border.muted"
                bg="bg.panel"
                paddingX={3}
                paddingY={2}
              >
                <Skeleton height="9px" width="56px" borderRadius="sm" />
                <Skeleton
                  height="11px"
                  width={turn.assistant[0]}
                  borderRadius="sm"
                />
                {turn.assistant[1] && (
                  <Skeleton
                    height="11px"
                    width={turn.assistant[1]}
                    borderRadius="sm"
                  />
                )}
              </VStack>
              <Skeleton boxSize="22px" borderRadius="full" flexShrink={0} />
            </HStack>
          </VStack>
        ))}
      </VStack>
    </VStack>
  );
};

const ConversationHeader: React.FC<{
  conversationId: string;
  turnCount: number;
  mode: Mode;
  onModeChange: (m: Mode) => void;
}> = ({ conversationId, turnCount, mode, onModeChange }) => (
  <HStack
    gap={2}
    paddingX={4}
    paddingY={2.5}
    borderBottomWidth="1px"
    borderColor="border.muted"
    bg="bg.subtle"
    flexShrink={0}
  >
    <Text
      textStyle="2xs"
      color="fg.muted"
      textTransform="uppercase"
      letterSpacing="0.06em"
      fontWeight="semibold"
    >
      Conversation
    </Text>
    <Text textStyle="xs" color="fg.subtle" fontFamily="mono" truncate>
      {conversationId}
    </Text>
    <Box flex={1} />
    <Text textStyle="2xs" color="fg.subtle" fontFamily="mono">
      {turnCount} turn{turnCount === 1 ? "" : "s"}
    </Text>
    <SegmentedToggle
      value={mode}
      onChange={(v) => onModeChange(v as Mode)}
      options={["bubbles", "markdown", "annotations"]}
    />
  </HStack>
);

const BubblesView: React.FC<{
  parsedTurns: ParsedTurn[];
  systemPromptInput: string | null | undefined;
  currentTraceId: string;
  onSelectTurn: (traceId: string) => void;
}> = ({ parsedTurns, systemPromptInput, currentTraceId, onSelectTurn }) => {
  const systemPrompt = useMemo(
    () => parseSystemPrompt(systemPromptInput),
    [systemPromptInput],
  );

  return (
    <VStack align="stretch" gap={5} paddingX={5} paddingY={4} overflow="auto">
      {systemPrompt && <SystemPromptBanner text={systemPrompt} />}
      {parsedTurns.map((p, i) => (
        <ChatTurnRow
          key={p.turn.traceId}
          turn={p.turn}
          userText={p.userText}
          assistantText={p.assistantText}
          assistantReasoning={p.assistantReasoning}
          gapSecs={p.gapSecs}
          showGap={p.showGap}
          index={i + 1}
          isCurrent={p.turn.traceId === currentTraceId}
          onSelect={onSelectTurn}
        />
      ))}
    </VStack>
  );
};

const SystemPromptBanner: React.FC<{ text: string }> = ({ text }) => {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > 280;
  return (
    <Box
      borderRadius="lg"
      borderWidth="1px"
      borderColor="border.muted"
      bg="bg.subtle"
      overflow="hidden"
    >
      <HStack
        gap={2}
        paddingX={3}
        paddingY={2}
        cursor={isLong ? "pointer" : "default"}
        onClick={isLong ? () => setExpanded((v) => !v) : undefined}
        _hover={isLong ? { bg: "bg.muted" } : undefined}
      >
        <Icon as={Settings2} boxSize="13px" color="fg.muted" />
        <Text
          textStyle="2xs"
          fontWeight="600"
          color="fg.muted"
          textTransform="uppercase"
          letterSpacing="0.06em"
        >
          System
        </Text>
        <Box flex={1} />
        {isLong && (
          <Icon
            as={expanded ? ChevronDown : ChevronRight}
            boxSize="13px"
            color="fg.subtle"
          />
        )}
      </HStack>
      <Box
        paddingX={3}
        paddingBottom={2.5}
        paddingTop={0.5}
        borderTopWidth="1px"
        borderTopColor="border.muted"
      >
        <Text
          textStyle="xs"
          fontFamily="mono"
          color="fg.muted"
          whiteSpace="pre-wrap"
          lineHeight="1.6"
          lineClamp={isLong && !expanded ? 3 : undefined}
        >
          {text}
        </Text>
      </Box>
    </Box>
  );
};

const MarkdownConversationView: React.FC<{ markdown: string }> = ({
  markdown,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [markdown]);

  return (
    <VStack align="stretch" gap={0} flex={1} minHeight={0}>
      <HStack
        paddingX={4}
        paddingY={2}
        gap={2}
        borderBottomWidth="1px"
        borderColor="border.muted"
        bg="bg.panel"
        flexShrink={0}
      >
        <Text textStyle="xs" color="fg.muted">
          Rendered for reading — Copy gives you the raw markdown source.
        </Text>
        <Box flex={1} />
        <Button
          size="xs"
          variant="outline"
          colorPalette="blue"
          onClick={handleCopy}
        >
          <Icon as={copied ? Check : Copy} boxSize="12px" />
          {copied ? "Copied" : "Copy"}
        </Button>
      </HStack>
      <Box flex={1} overflow="auto" bg="bg.panel">
        <RenderedMarkdown markdown={markdown} paddingX={4} paddingY={3} />
      </Box>
    </VStack>
  );
};
