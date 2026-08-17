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
import { hasRedactionMarker } from "@langwatch/redaction";
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
import { PIIRedactionAlert } from "~/components/ui/PIIRedactionNotice";
import type { AnnotationByTrace } from "~/hooks/useAnnotationsByTraceIds";
import { useConversationAnnotations } from "../../../hooks/useConversationAnnotations";
import { useConversationTurnEvents } from "../../../hooks/useConversationTurnEvents";
import { useConversationTurns } from "../../../hooks/useConversationTurns";
import { useCopyToClipboard } from "../../../hooks/useCopyToClipboard";
import { useTraceDrawerNavigation } from "../../../hooks/useTraceDrawerNavigation";
import {
  isTurnRailDraft,
  useAnnotationDraftStore,
} from "../../../stores/annotationDraftStore";
import type { TraceListItem } from "../../../types/trace";
import { FormatSelect } from "../FormatSelect";
import { RenderedMarkdown } from "../markdownView";
import {
  extractReadableText,
  extractReasoningText,
  extractSystemText,
} from "../transcript";
import { AnnotatedTurnRow } from "./AnnotatedTurnRow";
import { ConversationExpandContext } from "./expandContext";
import {
  FOCUS_SCROLL_REST_MS,
  useFocusedTurnBlink,
  useScrollFocusedTurnIntoView,
} from "./FocusedTurn";
import { SystemPromptBanner } from "./SystemPromptBanner";
import {
  EMPTY_TURNS,
  type Mode,
  type ParsedTurn,
  type TurnLayout,
} from "./types";
import {
  type RailLayout,
  isRailActive as resolveIsRailActive,
  threadColumnMaxWidth,
  useRailLayout,
} from "./useRailLayout";
import {
  buildConversationMarkdownChunks,
  type ConversationMarkdownChunk,
  joinConversationMarkdown,
  turnMediaForSide,
} from "./utils";

type AnnotationsByTrace = Map<string, AnnotationByTrace[]>;
const EMPTY_ANNOTATION_ITEMS: AnnotationByTrace[] = [];

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
  /** The thread to render. Null renders `fallbackTurns` instead. */
  conversationId: string | null;
  currentTraceId: string;
  /**
   * Where picking a turn takes the reader. Defaults to opening that turn in
   * the trace drawer.
   */
  onSelectTurn?: (turn: { traceId: string; timestamp: number }) => void;
  /** The turns to render when there is no thread to query. */
  fallbackTurns?: TraceListItem[];
  /** Seeds "Expand all"; the reader can still toggle it. */
  defaultExpandAll?: boolean;
  /**
   * The turn under review, which the conversation scrolls to, blinks once, and
   * keeps tinted for as long as it is the one being reviewed.
   */
  focusTraceId?: string;
  /**
   * Whether each turn offers to be counted into the annotation session. Only
   * the queue, which has a session to count into, asks for them.
   */
  showSessionCheckboxes?: boolean;
}

export const ConversationView = memo(function ConversationView({
  conversationId,
  currentTraceId,
  onSelectTurn,
  fallbackTurns,
  defaultExpandAll = false,
  focusTraceId,
  showSessionCheckboxes = false,
}: ConversationViewProps) {
  const [mode, setMode] = useState<Mode>("thread");
  // "Expand all" seeds every message's local expand state; individual
  // Show more / Show less toggles override until the next expand-all flip.
  const [isExpandAllEnabled, setIsExpandAllEnabled] =
    useState(defaultExpandAll);
  const query = useConversationTurns(conversationId);

  const queriedTurns = resolveTurns({
    conversationId,
    queriedTurns: query.data?.items as TraceListItem[] | undefined,
    fallbackTurns,
  });
  // Events are read back per thread rather than carried on the turn summary.
  const turns = useConversationTurnEvents(queriedTurns);

  const traceIds = useMemo(
    () => queriedTurns.map((t) => t.traceId),
    [queriedTurns],
  );
  const annotations = useConversationAnnotations(traceIds);

  // The rail belongs to this conversation only when the composer that opened
  // it did: the queue page and the trace drawer can each be showing one at the
  // same time, and only the annotated one should change shape. A composer for
  // a part read elsewhere in the trace opens there rather than in the rail, so
  // it is not what opens one.
  const draftTraceId = useAnnotationDraftStore((s) =>
    s.draft && isTurnRailDraft(s.draft) ? s.draft.traceId : null,
  );
  const turnTraceIds = useMemo(() => new Set(traceIds), [traceIds]);
  const isRailActive = resolveIsRailActive({
    layout: mode,
    hasAnnotations: annotations.hasAny,
    draftTraceId,
    turnTraceIds,
  });

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
        // typed-block content arrays, and the raw-string fallback).
        userText: extractReadableText(t.input, "user"),
        assistantText: extractReadableText(t.output, "assistant"),
        assistantReasoning: extractReasoningText(t.output),
        userMedia: turnMediaForSide({
          refs: t.inputMediaRefs,
          value: t.input,
          side: "input",
        }),
        assistantMedia: turnMediaForSide({
          refs: t.outputMediaRefs,
          value: t.output,
          side: "output",
        }),
        gapSecs,
        showGap: gapSecs > 5,
      };
    }
    return out;
  }, [turns]);

  // One notice for the whole conversation rather than one per message: the
  // policy that redacted a turn is the project's, and repeating it above every
  // turn it touched buries the thread it is meant to explain.
  const hasRedactedText = useMemo(
    () =>
      parsedTurns.some(
        (p) =>
          hasRedactionMarker(p.userText) || hasRedactionMarker(p.assistantText),
      ),
    [parsedTurns],
  );

  const handleSelectTurn = useTurnSelection({
    currentTraceId,
    turns,
    onSelectTurn,
  });

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
    return buildConversationMarkdownChunks(conversationId ?? "", parsedTurns);
  }, [hasViewedMarkdown, conversationId, parsedTurns]);

  // Only show the skeleton on the very first load. With keepPreviousData
  // the previous conversation's turns stay rendered while the new query
  // fetches in the background, so re-clicking a cached conversation no
  // longer flashes the skeleton. Without a conversation there is no query to
  // wait on: react-query reports a disabled query as loading forever.
  if (conversationId && query.isLoading && !query.data) {
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
        currentTraceId={currentTraceId}
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
            hasRedactedText={hasRedactedText}
            currentTraceId={currentTraceId}
            onSelectTurn={handleSelectTurn}
            annotationsByTrace={annotations.byTrace}
            annotationsByAnchor={annotations.byAnchor}
            isRailActive={isRailActive}
            focusTraceId={focusTraceId}
            showSessionCheckboxes={showSessionCheckboxes}
          />
        </ConversationExpandContext.Provider>
      ) : (
        <MarkdownConversationView chunks={markdownChunks} />
      )}
    </VStack>
  );
});

/**
 * One turn as the conversation renders it, framed when it is the one under
 * review. Shared by the virtualized and un-virtualized paths so a turn reads
 * and measures the same however the list around it is built.
 */
const ConversationTurn: React.FC<{
  layout: TurnLayout;
  parsed: ParsedTurn;
  index: number;
  isCurrent: boolean;
  isFocused: boolean;
  isBlinking: boolean;
  onSelectTurn: (traceId: string) => void;
  annotationsByTrace: AnnotationsByTrace;
  annotationsByAnchor: AnnotationsByTrace;
  isRailActive: boolean;
  railLayout: RailLayout;
  showSessionCheckbox: boolean;
}> = ({
  parsed,
  annotationsByTrace,
  annotationsByAnchor,
  showSessionCheckbox,
  ...rowProps
}) => (
  <AnnotatedTurnRow
    parsed={parsed}
    {...rowProps}
    {...turnAnnotations({
      traceId: parsed.turn.traceId,
      byTrace: annotationsByTrace,
      byAnchor: annotationsByAnchor,
    })}
    showSessionCheckbox={showSessionCheckbox}
  />
);

/**
 * The turn the reviewer was sent to read, when the conversation has one to tell
 * apart from the rest.
 *
 * A conversation of a single turn has not: tinting the only thing on screen
 * says nothing, so it is left plain and read as any other trace would be.
 */
function turnUnderReview({
  parsedTurns,
  focusTraceId,
}: {
  parsedTurns: ParsedTurn[];
  focusTraceId: string | undefined;
}): string | undefined {
  return parsedTurns.length > 1 ? focusTraceId : undefined;
}

/**
 * What a turn's rail is handed: what was said about the turn, and what was said
 * about the parts inside it. The two are kept apart all the way to the rail,
 * because only the first is what the turn counts.
 */
function turnAnnotations({
  traceId,
  byTrace,
  byAnchor,
}: {
  traceId: string;
  byTrace: AnnotationsByTrace;
  byAnchor: AnnotationsByTrace;
}): {
  annotations: AnnotationByTrace[];
  anchoredAnnotations: AnnotationByTrace[];
} {
  return {
    annotations: byTrace.get(traceId) ?? EMPTY_ANNOTATION_ITEMS,
    anchoredAnnotations: byAnchor.get(traceId) ?? EMPTY_ANNOTATION_ITEMS,
  };
}

/**
 * The turns to render: the queried thread when there is one, otherwise the
 * turns the host supplied. A trace with no thread still reads as a
 * conversation, it just gets its turns handed to it.
 */
function resolveTurns({
  conversationId,
  queriedTurns,
  fallbackTurns,
}: {
  conversationId: string | null;
  queriedTurns: TraceListItem[] | undefined;
  fallbackTurns: TraceListItem[] | undefined;
}): TraceListItem[] {
  if (!conversationId) return fallbackTurns ?? EMPTY_TURNS;
  return queriedTurns ?? EMPTY_TURNS;
}

/**
 * What clicking a turn does. Opens that turn in the trace drawer unless the
 * host asked for something else.
 *
 * The callback closes over refs rather than values so its identity survives
 * navigation. Otherwise every row's memo would bail each time the reader moves
 * to another turn, even though only two rows actually changed.
 */
function useTurnSelection({
  currentTraceId,
  turns,
  onSelectTurn,
}: {
  currentTraceId: string;
  turns: TraceListItem[];
  onSelectTurn?: (turn: { traceId: string; timestamp: number }) => void;
}): (traceId: string) => void {
  const { navigateToTrace } = useTraceDrawerNavigation();

  const currentTraceIdRef = useRef(currentTraceId);
  useEffect(() => {
    currentTraceIdRef.current = currentTraceId;
  }, [currentTraceId]);
  const turnsRef = useRef(turns);
  useEffect(() => {
    turnsRef.current = turns;
  }, [turns]);

  return useCallback(
    (traceId: string) => {
      if (onSelectTurn) {
        // A row only knows its trace; the host's contract is the turn, so read
        // the timestamp back off the turn the row was rendered from.
        const turn = turnsRef.current.find((t) => t.traceId === traceId);
        if (turn) onSelectTurn({ traceId, timestamp: turn.timestamp });
        return;
      }
      navigateToTrace({
        fromTraceId: currentTraceIdRef.current,
        fromViewMode: "conversation",
        toTraceId: traceId,
        // Open the turn's Summary, not the raw Trace tab. Transiently too, so
        // peeking at a turn doesn't repoint the user's remembered tab.
        toViewMode: "summary",
        persistViewMode: false,
      });
    },
    [navigateToTrace, onSelectTurn],
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

const CONVERSATION_MODES: Mode[] = ["thread", "bubbles", "markdown"];

const ConversationHeader: React.FC<{
  conversationId: string | null;
  currentTraceId: string;
  turnCount: number;
  mode: Mode;
  onModeChange: (m: Mode) => void;
  isExpandAllEnabled: boolean;
  onToggleExpandAll: () => void;
}> = ({
  conversationId,
  currentTraceId,
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
        {/* A threadless trace reads as a one-turn conversation; name it by
            the trace so the header is never blank. */}
        {conversationId ?? currentTraceId}
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
      <FormatSelect
        value={mode}
        onChange={(v) => onModeChange(v as Mode)}
        options={CONVERSATION_MODES}
        ariaLabel="Conversation view format"
      />
    </HStack>
  );
};

/**
 * Where an un-virtualized thread scrolls itself to.
 *
 * On open, the reader is dropped at the turn whose trace the drawer is showing
 * rather than at the top: a long thread otherwise opens scrolled away from the
 * turn the operator clicked in from. That happens once per mount, so later
 * navigation never fights the reader. A turn put under review is scrolled to
 * as well, each time a different one is.
 */
function useTurnListScrolling(focusTraceId: string | undefined) {
  const activeRef = useRef<HTMLDivElement>(null);
  const focusedRef = useRef<HTMLDivElement>(null);
  const { layout: railLayout, setScroller } = useRailLayout();
  const { ref: scrollRef, attachScroller } = useMeasuredScroller(setScroller);
  useCenterActiveTurnOnce({ scrollRef, activeRef });
  useScrollFocusedTurnIntoView({ scrollRef, focusedRef, focusTraceId });
  const isBlinking = useFocusedTurnBlink(focusTraceId);
  return { activeRef, focusedRef, railLayout, attachScroller, isBlinking };
}

interface TurnsViewProps {
  layout: TurnLayout;
  parsedTurns: ParsedTurn[];
  /** Whether any turn's text carries a redaction marker. */
  hasRedactedText: boolean;
  currentTraceId: string;
  onSelectTurn: (traceId: string) => void;
  annotationsByTrace: AnnotationsByTrace;
  annotationsByAnchor: AnnotationsByTrace;
  isRailActive: boolean;
  focusTraceId: string | undefined;
  showSessionCheckboxes: boolean;
}

/**
 * The thread, rendered the way its length asks for: short ones row by row, long
 * ones through a virtualizer. Each path scrolls itself, so the one that is not
 * rendering sets nothing up.
 */
const TurnsView: React.FC<
  TurnsViewProps & { systemPromptInput: string | null | undefined }
> = ({ systemPromptInput, ...listProps }) => {
  const systemPrompt = useMemo(
    () => extractSystemText(systemPromptInput),
    [systemPromptInput],
  );

  if (listProps.parsedTurns.length >= VIRTUALIZE_AT) {
    return <VirtualizedTurnsView systemPrompt={systemPrompt} {...listProps} />;
  }
  return <PlainTurnsView systemPrompt={systemPrompt} {...listProps} />;
};

/** A thread short enough to render row by row, in one scrolling column. */
const PlainTurnsView: React.FC<
  TurnsViewProps & { systemPrompt: string | null }
> = ({
  layout,
  parsedTurns,
  systemPrompt,
  hasRedactedText,
  currentTraceId,
  onSelectTurn,
  annotationsByTrace,
  annotationsByAnchor,
  isRailActive,
  focusTraceId,
  showSessionCheckboxes,
}) => {
  const { activeRef, focusedRef, railLayout, attachScroller, isBlinking } =
    useTurnListScrolling(focusTraceId);
  const underReview = turnUnderReview({ parsedTurns, focusTraceId });

  return (
    <Box
      ref={attachScroller}
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
        maxWidth={columnMaxWidth({ layout, isRailActive, railLayout })}
        marginX="auto"
      >
        {hasRedactedText && <PIIRedactionAlert />}
        {systemPrompt && <SystemPromptBanner text={systemPrompt} />}
        {parsedTurns.map((p, i) => {
          const isCurrent = p.turn.traceId === currentTraceId;
          const isFocused = p.turn.traceId === underReview;
          return (
            <Box
              key={p.turn.traceId}
              ref={isFocused ? focusedRef : isCurrent ? activeRef : undefined}
              width="full"
            >
              <ConversationTurn
                layout={layout}
                parsed={p}
                index={i + 1}
                isCurrent={isCurrent}
                isFocused={isFocused}
                isBlinking={isBlinking}
                onSelectTurn={onSelectTurn}
                annotationsByTrace={annotationsByTrace}
                annotationsByAnchor={annotationsByAnchor}
                isRailActive={isRailActive}
                railLayout={railLayout}
                showSessionCheckbox={showSessionCheckboxes}
              />
            </Box>
          );
        })}
      </VStack>
    </Box>
  );
};

/**
 * One ref for the conversation's scroll container. The code that scrolls it and
 * the virtualizer read the node; the rail has to be told the moment it is
 * attached, since a conversation swaps scrollers as its turn count crosses the
 * virtualization threshold.
 */
/**
 * Land on the open trace's turn instead of the top of a long thread. Once per
 * mount: the virtualizer settles estimated heights as the reader scrolls, but
 * centering on the index is close enough on open.
 */
function useCenterActiveTurnInVirtualizer({
  virtualizer,
  parsedTurns,
  currentTraceId,
}: {
  virtualizer: {
    scrollToIndex: (index: number, options: { align: "center" }) => void;
  };
  parsedTurns: ParsedTurn[];
  currentTraceId: string;
}) {
  const hasCentered = useRef(false);
  useEffect(() => {
    if (hasCentered.current) return;
    const activeIndex = parsedTurns.findIndex(
      (p) => p.turn.traceId === currentTraceId,
    );
    if (activeIndex <= 0) return;
    hasCentered.current = true;
    virtualizer.scrollToIndex(activeIndex, { align: "center" });
  }, [parsedTurns, currentTraceId, virtualizer]);
}

/**
 * Brings the turn under review onto the screen, through the virtualizer rather
 * than the DOM: a turn that is not on screen has no element to scroll to, and
 * the index is what the virtualizer needs to put one there. It waits out the
 * same rest the un-virtualized path does, so a long thread and a short one
 * carry the reader at the same moment.
 */
function useScrollFocusedTurnInVirtualizer({
  virtualizer,
  parsedTurns,
  focusTraceId,
}: {
  virtualizer: {
    scrollToIndex: (
      index: number,
      options: { align: "center"; behavior: "smooth" },
    ) => void;
  };
  parsedTurns: ParsedTurn[];
  focusTraceId: string | undefined;
}) {
  // Once per turn put under review: the virtualizer is rebuilt on every render,
  // and scrolling again on each one would fight the reader's own scrolling for
  // as long as they stay on that turn.
  const scrolledTo = useRef<string | null>(null);
  const rest = useRef(0);
  useEffect(() => {
    if (!focusTraceId || scrolledTo.current === focusTraceId) return;
    const focusedIndex = parsedTurns.findIndex(
      (p) => p.turn.traceId === focusTraceId,
    );
    if (focusedIndex < 0) return;
    scrolledTo.current = focusTraceId;
    rest.current = window.setTimeout(() => {
      virtualizer.scrollToIndex(focusedIndex, {
        align: "center",
        behavior: "smooth",
      });
    }, FOCUS_SCROLL_REST_MS);
  }, [focusTraceId, parsedTurns, virtualizer]);
  // The wait is only called off when the conversation goes away: a re-render
  // inside it must not cancel a carry that is already on its way, and the
  // guard above would never arm another one.
  useEffect(() => () => window.clearTimeout(rest.current), []);
}

function useMeasuredScroller(setScroller: (node: HTMLElement | null) => void): {
  ref: RefObject<HTMLDivElement | null>;
  attachScroller: (node: HTMLDivElement | null) => void;
} {
  const ref = useRef<HTMLDivElement>(null);
  const attachScroller = useCallback(
    (node: HTMLDivElement | null) => {
      ref.current = node;
      setScroller(node);
    },
    [setScroller],
  );
  return { ref, attachScroller };
}

/**
 * How wide the centered column may grow. Bubbles span the pane; thread caps
 * itself at a comfortable reading width, plus the rail when one is open.
 */
function columnMaxWidth({
  layout,
  isRailActive,
  railLayout,
}: {
  layout: TurnLayout;
  isRailActive: boolean;
  railLayout: RailLayout;
}): string | undefined {
  if (layout !== "thread") return undefined;
  return threadColumnMaxWidth({ isActive: isRailActive, layout: railLayout });
}

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
 * The virtualizer a long thread renders through, and where it scrolls itself
 * to: the open trace's turn on arrival, and the turn under review each time a
 * different one is put there.
 */
function useVirtualizedTurnList({
  parsedTurns,
  currentTraceId,
  focusTraceId,
}: {
  parsedTurns: ParsedTurn[];
  currentTraceId: string;
  focusTraceId: string | undefined;
}) {
  const { layout: railLayout, setScroller } = useRailLayout();
  const { ref: scrollerRef, attachScroller } = useMeasuredScroller(setScroller);
  const virtualizer = useVirtualizer({
    count: parsedTurns.length,
    getScrollElement: () => scrollerRef.current,
    estimateSize: () => ESTIMATED_TURN_HEIGHT,
    overscan: 4,
    measureElement: (el) => el.getBoundingClientRect().height,
    getItemKey: (index) => parsedTurns[index]!.turn.traceId,
  });

  useCenterActiveTurnInVirtualizer({
    virtualizer,
    parsedTurns,
    currentTraceId,
  });
  useScrollFocusedTurnInVirtualizer({ virtualizer, parsedTurns, focusTraceId });
  const isBlinking = useFocusedTurnBlink(focusTraceId);

  return { virtualizer, railLayout, attachScroller, isBlinking };
}

/**
 * Virtualized rendering path for long conversations. Mirrors the threshold +
 * shape used by `ConversationTurnsList` so we share a mental model across the
 * codebase. The system-prompt banner stays sticky at the top, outside the
 * virtual range, so it doesn't get measured + remeasured every scroll.
 */
const VirtualizedTurnsView: React.FC<
  TurnsViewProps & { systemPrompt: string | null }
> = ({
  layout,
  parsedTurns,
  systemPrompt,
  hasRedactedText,
  currentTraceId,
  onSelectTurn,
  annotationsByTrace,
  annotationsByAnchor,
  isRailActive,
  focusTraceId,
  showSessionCheckboxes,
}) => {
  const { virtualizer, railLayout, attachScroller, isBlinking } =
    useVirtualizedTurnList({ parsedTurns, currentTraceId, focusTraceId });
  const underReview = turnUnderReview({ parsedTurns, focusTraceId });

  return (
    <Box
      ref={attachScroller}
      flex={1}
      overflow="auto"
      paddingX={5}
      paddingY={4}
    >
      <Box
        width="full"
        maxWidth={columnMaxWidth({ layout, isRailActive, railLayout })}
        marginX="auto"
      >
        {hasRedactedText && (
          <Box marginBottom={systemPrompt ? 2 : 5}>
            <PIIRedactionAlert />
          </Box>
        )}
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
                <ConversationTurn
                  layout={layout}
                  parsed={p}
                  index={row.index + 1}
                  isCurrent={p.turn.traceId === currentTraceId}
                  isFocused={p.turn.traceId === underReview}
                  isBlinking={isBlinking}
                  onSelectTurn={onSelectTurn}
                  annotationsByTrace={annotationsByTrace}
                  annotationsByAnchor={annotationsByAnchor}
                  isRailActive={isRailActive}
                  railLayout={railLayout}
                  showSessionCheckbox={showSessionCheckboxes}
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
  const { copied, copy } = useCopyToClipboard();

  const handleCopy = useCallback(() => {
    copy(joinConversationMarkdown(chunks));
  }, [chunks, copy]);

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
