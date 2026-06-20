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
import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, ChevronsDownUp, ChevronsUpDown, Copy } from "lucide-react";
import {
  memo,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAnnotationsByTraceIds } from "~/hooks/useAnnotationsByTraceIds";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { RouterOutputs } from "~/utils/api";
import { useConversationTurns } from "../../../hooks/useConversationTurns";
import { useTraceDrawerNavigation } from "../../../hooks/useTraceDrawerNavigation";
import type { TraceListItem } from "../../../types/trace";
import { RenderedMarkdown } from "../markdownView";
import { SegmentedToggle } from "../SegmentedToggle";
import { extractReadableText, extractReasoningText } from "../transcript";
import { AnnotationsView } from "./AnnotationsView";
import { ChatTurnRow } from "./ChatTurnRow";
import { ConversationExpandContext } from "./expandContext";
import { SystemPromptBanner } from "./SystemPromptBanner";
import {
  EMPTY_TURNS,
  type Mode,
  type ParsedTurn,
  type TurnLayout,
} from "./types";
import {
  buildConversationMarkdownChunks,
  type ConversationMarkdownChunk,
  joinConversationMarkdown,
  parseLastUserText,
  parseSystemPrompt,
} from "./utils";

type AnnotationItem = RouterOutputs["annotation"]["getByTraceIds"][number];
export type AnnotationsByTrace = Map<string, AnnotationItem[]>;
const EMPTY_ANNOTATION_ITEMS: AnnotationItem[] = [];

/**
 * Below this turn count it's cheaper to render every row inline than to
 * mount a scrolling virtualizer + measureElement refs.
 */
const VIRTUALIZE_AT = 12;
/** Estimated row height for the virtualizer; refined by measureElement. */
const ESTIMATED_TURN_HEIGHT = 220;

/**
 * Pre-measure estimate per markdown chunk. Picked to overshoot rather than
 * undershoot — undershooting tells the virtualizer more chunks fit than
 * really do, mounting extra rows on every render. Real heights replace this
 * once `measureElement` runs on the rendered chunk.
 */
const MARKDOWN_CHUNK_ESTIMATE_PX = 360;

const EMPTY_CHUNKS: ConversationMarkdownChunk[] = [];

interface ConversationViewProps {
  conversationId: string;
  currentTraceId: string;
}

export const ConversationView = memo(function ConversationView({
  conversationId,
  currentTraceId,
}: ConversationViewProps) {
  const { navigateToTrace } = useTraceDrawerNavigation();
  const [mode, setMode] = useState<Mode>("thread");
  // "Expand all" seeds every message's local expand state; individual
  // Show more / Show less toggles override until the next expand-all flip.
  const [isExpandAllEnabled, setIsExpandAllEnabled] = useState(false);
  const query = useConversationTurns(conversationId);

  const turns =
    (query.data?.items as TraceListItem[] | undefined) ?? EMPTY_TURNS;

  const traceIds = useMemo(() => turns.map((t) => t.traceId), [turns]);
  const { project, hasPermission } = useOrganizationTeamProject();
  const annotationsQuery = useAnnotationsByTraceIds({
    projectId: project?.id ?? "",
    traceIds,
    enabled: !!project?.id && hasPermission("annotations:view"),
    keepPreviousData: true,
  });
  const annotationsByTrace = useMemo<AnnotationsByTrace>(() => {
    const map: AnnotationsByTrace = new Map();
    for (const a of annotationsQuery.data ?? []) {
      const list = map.get(a.traceId);
      if (list) list.push(a);
      else map.set(a.traceId, [a]);
    }
    return map;
  }, [annotationsQuery.data]);

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
        // Open the turn's Summary, not the raw Trace tab — and transiently, so
        // peeking at a turn doesn't repoint the user's remembered tab.
        toViewMode: "summary",
        persistViewMode: false,
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
  const markdownChunks = useMemo<ConversationMarkdownChunk[]>(() => {
    if (!hasViewedMarkdown) return EMPTY_CHUNKS;
    return buildConversationMarkdownChunks(conversationId, parsedTurns);
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
        isExpandAllEnabled={isExpandAllEnabled}
        onToggleExpandAll={() => setIsExpandAllEnabled((v) => !v)}
      />
      {mode === "thread" || mode === "bubbles" ? (
        <ConversationExpandContext.Provider
          value={{ isExpandable: true, shouldExpandAll: isExpandAllEnabled }}
        >
          <TurnsView
            layout={mode}
            parsedTurns={parsedTurns}
            systemPromptInput={turns[0]?.input}
            currentTraceId={currentTraceId}
            onSelectTurn={handleSelectTurn}
            annotationsByTrace={annotationsByTrace}
          />
        </ConversationExpandContext.Provider>
      ) : mode === "annotations" ? (
        <AnnotationsView
          parsedTurns={parsedTurns}
          currentTraceId={currentTraceId}
        />
      ) : (
        <MarkdownConversationView chunks={markdownChunks} />
      )}
    </VStack>
  );
});

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
        <Text textStyle="xs" color="fg.subtle" truncate>
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
  isExpandAllEnabled: boolean;
  onToggleExpandAll: () => void;
}> = ({
  conversationId,
  turnCount,
  mode,
  onModeChange,
  isExpandAllEnabled,
  onToggleExpandAll,
}) => {
  // Expand-all only applies to the message layouts that truncate.
  const isExpandAllVisible = mode === "thread" || mode === "bubbles";
  return (
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
      <Text textStyle="xs" color="fg.subtle" truncate>
        {conversationId}
      </Text>
      <Box flex={1} />
      {isExpandAllVisible && (
        <Button
          size="xs"
          variant="ghost"
          color="fg.muted"
          gap={1}
          onClick={onToggleExpandAll}
          aria-pressed={isExpandAllEnabled}
        >
          <Icon
            as={isExpandAllEnabled ? ChevronsDownUp : ChevronsUpDown}
            boxSize="13px"
          />
          {isExpandAllEnabled ? "Collapse all" : "Expand all"}
        </Button>
      )}
      <SegmentedToggle
        value={mode}
        onChange={(v) => onModeChange(v as Mode)}
        options={["thread", "bubbles", "markdown", "annotations"]}
      />
    </HStack>
  );
};

/**
 * ChatGPT-style thread layout constrains the column to a comfortable reading
 * width and centers it; bubbles span the pane so the left/right sides have
 * room to breathe.
 */
const THREAD_MAX_WIDTH = "800px";

const TurnsView: React.FC<{
  layout: TurnLayout;
  parsedTurns: ParsedTurn[];
  systemPromptInput: string | null | undefined;
  currentTraceId: string;
  onSelectTurn: (traceId: string) => void;
  annotationsByTrace: AnnotationsByTrace;
}> = ({
  layout,
  parsedTurns,
  systemPromptInput,
  currentTraceId,
  onSelectTurn,
  annotationsByTrace,
}) => {
  const systemPrompt = useMemo(
    () => parseSystemPrompt(systemPromptInput),
    [systemPromptInput],
  );

  if (parsedTurns.length >= VIRTUALIZE_AT) {
    return (
      <VirtualizedTurnsView
        layout={layout}
        parsedTurns={parsedTurns}
        systemPrompt={systemPrompt}
        currentTraceId={currentTraceId}
        onSelectTurn={onSelectTurn}
        annotationsByTrace={annotationsByTrace}
      />
    );
  }

  const maxWidth = layout === "thread" ? THREAD_MAX_WIDTH : undefined;

  // On open, drop the reader at the turn whose trace the drawer is showing
  // rather than at the top — a long thread otherwise opens scrolled away
  // from the turn the operator clicked in from. Centers once per mount; we
  // don't re-scroll on later navigation so we never fight the user.
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  useCenterActiveTurnOnce({ scrollRef, activeRef });

  return (
    <Box
      ref={scrollRef}
      position="relative"
      flex={1}
      overflow="auto"
      paddingX={5}
      paddingY={4}
    >
      <VStack
        align="stretch"
        gap={layout === "thread" ? 2 : 5}
        width="full"
        maxWidth={maxWidth}
        marginX="auto"
      >
        {systemPrompt && <SystemPromptBanner text={systemPrompt} />}
        {parsedTurns.map((p, i) => {
          const isCurrent = p.turn.traceId === currentTraceId;
          return (
            <Box
              key={p.turn.traceId}
              ref={isCurrent ? activeRef : undefined}
              width="full"
            >
              <ChatTurnRow
                layout={layout}
                turn={p.turn}
                userText={p.userText}
                assistantText={p.assistantText}
                assistantReasoning={p.assistantReasoning}
                gapSecs={p.gapSecs}
                showGap={p.showGap}
                index={i + 1}
                isCurrent={isCurrent}
                onSelect={onSelectTurn}
                annotationItems={
                  annotationsByTrace.get(p.turn.traceId) ??
                  EMPTY_ANNOTATION_ITEMS
                }
              />
            </Box>
          );
        })}
      </VStack>
    </Box>
  );
};

/**
 * Scroll the active turn to the vertical center of its scroll container,
 * exactly once after mount. `offsetTop` is measured against the nearest
 * positioned ancestor, so the scroll container sets `position: relative`.
 */
function useCenterActiveTurnOnce({
  scrollRef,
  activeRef,
}: {
  scrollRef: RefObject<HTMLDivElement | null>;
  activeRef: RefObject<HTMLDivElement | null>;
}) {
  const done = useRef(false);
  useLayoutEffect(() => {
    if (done.current) return;
    const container = scrollRef.current;
    const active = activeRef.current;
    if (!container || !active) return;
    done.current = true;
    const top =
      active.offsetTop - container.clientHeight / 2 + active.offsetHeight / 2;
    container.scrollTop = Math.max(0, top);
  }, [scrollRef, activeRef]);
}

/**
 * Virtualized rendering path for long conversations. Mirrors the threshold +
 * shape used by `ConversationTurnsList` so we share a mental model across the
 * codebase. The system-prompt banner stays sticky at the top, outside the
 * virtual range, so it doesn't get measured + remeasured every scroll.
 */
const VirtualizedTurnsView: React.FC<{
  layout: TurnLayout;
  parsedTurns: ParsedTurn[];
  systemPrompt: string | null;
  currentTraceId: string;
  onSelectTurn: (traceId: string) => void;
  annotationsByTrace: AnnotationsByTrace;
}> = ({
  layout,
  parsedTurns,
  systemPrompt,
  currentTraceId,
  onSelectTurn,
  annotationsByTrace,
}) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: parsedTurns.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATED_TURN_HEIGHT,
    overscan: 4,
    measureElement: (el) => el.getBoundingClientRect().height,
    getItemKey: (index) => parsedTurns[index]!.turn.traceId,
  });

  // Land on the open trace's turn instead of the top of a long thread.
  // Once per mount; the virtualizer settles estimated heights as the user
  // scrolls, but centering on the index is close enough on open.
  const scrolledToActive = useRef(false);
  useEffect(() => {
    if (scrolledToActive.current) return;
    const activeIndex = parsedTurns.findIndex(
      (p) => p.turn.traceId === currentTraceId,
    );
    if (activeIndex <= 0) return;
    scrolledToActive.current = true;
    virtualizer.scrollToIndex(activeIndex, { align: "center" });
  }, [parsedTurns, currentTraceId, virtualizer]);

  const maxWidth = layout === "thread" ? THREAD_MAX_WIDTH : undefined;

  return (
    <Box ref={parentRef} flex={1} overflow="auto" paddingX={5} paddingY={4}>
      <Box width="full" maxWidth={maxWidth} marginX="auto">
        {systemPrompt && (
          <Box marginBottom={5}>
            <SystemPromptBanner text={systemPrompt} />
          </Box>
        )}
        <Box
          height={`${virtualizer.getTotalSize()}px`}
          width="full"
          position="relative"
        >
          {virtualizer.getVirtualItems().map((row) => {
            const p = parsedTurns[row.index]!;
            return (
              <Box
                key={row.key}
                ref={virtualizer.measureElement}
                data-index={row.index}
                position="absolute"
                top={0}
                left={0}
                width="full"
                transform={`translateY(${row.start}px)`}
                paddingBottom={layout === "thread" ? 2 : 5}
              >
                <ChatTurnRow
                  layout={layout}
                  turn={p.turn}
                  userText={p.userText}
                  assistantText={p.assistantText}
                  assistantReasoning={p.assistantReasoning}
                  gapSecs={p.gapSecs}
                  showGap={p.showGap}
                  index={row.index + 1}
                  isCurrent={p.turn.traceId === currentTraceId}
                  onSelect={onSelectTurn}
                  annotationItems={
                    annotationsByTrace.get(p.turn.traceId) ??
                    EMPTY_ANNOTATION_ITEMS
                  }
                />
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
};

const MarkdownConversationView: React.FC<{
  chunks: ConversationMarkdownChunk[];
}> = ({ chunks }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(joinConversationMarkdown(chunks));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [chunks]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: chunks.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => MARKDOWN_CHUNK_ESTIMATE_PX,
    overscan: 2,
    measureElement: (el) => el.getBoundingClientRect().height,
    getItemKey: (index) => chunks[index]?.id ?? index,
  });

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
      <Box ref={scrollRef} flex={1} minHeight={0} overflow="auto" bg="bg.panel">
        <Box
          height={`${virtualizer.getTotalSize()}px`}
          width="full"
          position="relative"
        >
          {virtualizer.getVirtualItems().map((row) => {
            const chunk = chunks[row.index]!;
            return (
              <Box
                key={row.key}
                ref={virtualizer.measureElement}
                data-index={row.index}
                position="absolute"
                top={0}
                left={0}
                width="full"
                transform={`translateY(${row.start}px)`}
              >
                <RenderedMarkdown
                  markdown={chunk.markdown}
                  paddingX={4}
                  paddingY={2}
                />
              </Box>
            );
          })}
        </Box>
      </Box>
    </VStack>
  );
};
