import { Box, Circle, Flex, HStack, Icon, Spacer, Text, VStack } from "@chakra-ui/react";
import { AlertTriangle, Lightbulb, MessageSquare } from "lucide-react";
import { Fragment, memo, useCallback, useEffect, useMemo, useState } from "react";
import { Markdown } from "../../../markdown";
import { TraceMediaStrip } from "../../../traces/trace-media-strip";
import { RedactedInline } from "../../../redacted-field";
import type { MediaPartData } from "../../../../../behavior/shared/traces/media-parts";
import type { RouterOutputs } from "../../../trace-api";
import { TRANSLATE_TEXT_MAX_CHARS } from "../../../../../model/constants";
import {
  type UseTextTranslationResult,
  useTextTranslation,
} from "../../hooks/use-text-translation";
import {
  formatCost,
  formatDuration,
  formatRelativeTimeAgo,
  isSessionMarked,
  isTerminalOrigin,
  useAnnotationQueueSessionStore,
} from "../../../../../index";
import type { TraceListItem } from "../../types/trace";
import {
  Bubble,
  type BubbleSide,
  type BubbleTone,
  truncateMarkdown,
} from "../../trace-table/registry/addons/conversation/bubble";
import { getDisplayRoleVisuals, useIsScenarioRole } from "../scenario-roles";
import { getRolePalette, ReasoningBlock } from "../transcript";
import { useConversationExpand } from "../../../../../behavior/explorer/trace-drawer/conversation-view/expand-context";
import {
  MessageAnnotateCluster,
  type MessageAnnotateTarget,
  type MessageTranslation,
} from "./message-annotate-cluster";
import { MessageExpandToggle } from "../../../../elements/explorer/trace-drawer/conversation-view/message-expand-toggle";
import {
  TurnAnnotationBadges,
  TurnEditTraceAction,
  TurnSessionCheckbox,
} from "./turn-annotations";
import { TurnSteps, turnHasGenieSteps } from "./turn-steps";
import type { TurnLayout } from "./types";
import { formatGap } from "./utils";

type AnnotationItem = RouterOutputs["annotation"]["getByTraceIds"][number];
const EMPTY_ANNOTATIONS: AnnotationItem[] = [];
const EMPTY_MEDIA: MediaPartData[] = [];

interface MessageAnnotationSummary {
  count: number;
  hasCorrection: boolean;
}

/**
 * Which of a turn's comments read on which of its two messages.
 *
 * A comment about the turn as a whole is a judgement on the answer it gave, so
 * it counts on the reply, beside the comments left on the reply itself. A
 * comment on the turn's input counts on the message the user sent. Anything
 * narrower belongs to the surface where that part is read and counts on
 * neither.
 */
function splitAnnotationsBySide({
  traceId,
  turnAnnotations,
  anchoredAnnotations,
}: {
  traceId: string;
  turnAnnotations: AnnotationItem[];
  anchoredAnnotations: AnnotationItem[];
}): {
  userAnnotations: MessageAnnotationSummary | undefined;
  assistantAnnotations: MessageAnnotationSummary | undefined;
} {
  const onField = (path: "input" | "output") =>
    anchoredAnnotations.filter(
      (a) => a.anchorKind === "field" && a.anchorId === traceId && a.anchorPath === path,
    );
  return {
    userAnnotations: summarizeAnnotations(onField("input")),
    assistantAnnotations: summarizeAnnotations([
      ...turnAnnotations,
      ...onField("output"),
    ]),
  };
}

/** What one message's cluster needs of its translation: the state, and the toggle. */
function toMessageTranslation(translation: UseTextTranslationResult): MessageTranslation {
  return {
    isActive: translation.isActive,
    isLoading: translation.isLoading,
    onToggle: translation.toggle,
  };
}

function summarizeAnnotations(
  items: AnnotationItem[],
): MessageAnnotationSummary | undefined {
  if (items.length === 0) return undefined;
  return {
    count: items.length,
    hasCorrection: items.some((a) => !!a.expectedOutput),
  };
}

interface ChatTurnRowProps {
  turn: TraceListItem;
  userText: string;
  assistantText: string;
  assistantReasoning: string;
  /**
   * Media recorded on the turn's input side, rendered under the user message
   * in thread layout. The side bubbles render no media yet.
   */
  userMedia?: MediaPartData[];
  /** Media recorded on the turn's output side, rendered under the reply. */
  assistantMedia?: MediaPartData[];
  /** Wall-clock seconds between the previous turn's end and this turn's start. */
  gapSecs: number;
  /** Whether the inter-turn gap is long enough to surface as a divider. */
  showGap: boolean;
  index: number;
  isCurrent: boolean;
  onSelect: (traceId: string) => void;
  /** ChatGPT-style full-width thread vs left/right side bubbles. */
  layout?: TurnLayout;
  /**
   * Annotations for this turn, prefetched at the conversation level so each
   * row doesn't fire its own `getByTraceId`. Drives the bubble's annotation
   * marker and seeds the inline badge popover.
   */
  annotationItems?: AnnotationItem[];
  /**
   * Comments about the parts inside this turn. Only the ones left on the turn's
   * own input and output read here, on the message they were left on; the rest
   * belong to the surfaces those parts are read from.
   */
  anchoredAnnotationItems?: AnnotationItem[];
  /**
   * Whether the separator offers to count this turn's trace into the annotation
   * session. Only the queue, which has a session to count into, asks for it.
   */
  showSessionCheckbox?: boolean;
}

export const ChatTurnRow = memo<ChatTurnRowProps>(function ChatTurnRow({
  turn,
  userText: originalUserText,
  assistantText: originalAssistantText,
  assistantReasoning,
  userMedia = EMPTY_MEDIA,
  assistantMedia = EMPTY_MEDIA,
  gapSecs,
  showGap,
  index,
  isCurrent,
  onSelect,
  layout = "bubbles",
  annotationItems = EMPTY_ANNOTATIONS,
  anchoredAnnotationItems = EMPTY_ANNOTATIONS,
  showSessionCheckbox = false,
}) {
  const handleSelect = useCallback(
    () => onSelect(turn.traceId),
    [onSelect, turn.traceId],
  );

  // Translate-to-English per message rather than per turn
  // (specs/traces-v2/message-translation.feature): a reader flips exactly the
  // side they cannot read, and the other side is left as it was written.
  // Sliced to the translate endpoint's payload cap so a pathological message
  // can't become one giant prompt.
  const userTranslation = useTextTranslation({
    texts: useMemo(
      () => ({ user: originalUserText.slice(0, TRANSLATE_TEXT_MAX_CHARS) }),
      [originalUserText],
    ),
  });
  const assistantTranslation = useTextTranslation({
    texts: useMemo(
      () => ({
        assistant: originalAssistantText.slice(0, TRANSLATE_TEXT_MAX_CHARS),
      }),
      [originalAssistantText],
    ),
  });
  const userText = userTranslation.displayTexts.user ?? originalUserText;
  const assistantText =
    assistantTranslation.displayTexts.assistant ?? originalAssistantText;

  const { userAnnotations, assistantAnnotations } = useMemo(
    () =>
      splitAnnotationsBySide({
        traceId: turn.traceId,
        turnAnnotations: annotationItems,
        anchoredAnnotations: anchoredAnnotationItems,
      }),
    [turn.traceId, annotationItems, anchoredAnnotationItems],
  );

  // Scenario-aware visual mapping. The text fields stay role-faithful
  // (`userText` is whatever the source `user` message said), but the
  // bubble's side / tone / label / icon flip in scenario mode so the
  // agent under test reads as the trace's "user" and the simulator
  // reads as the "assistant".
  const isScenario = useIsScenarioRole();
  const userVisuals = getDisplayRoleVisuals("user", { isScenario });
  const assistantVisuals = getDisplayRoleVisuals("assistant", { isScenario });
  const userSide = userVisuals.displayRole === "user" ? "left" : "right";
  const assistantSide = assistantVisuals.displayRole === "user" ? "left" : "right";
  const UserIcon = userVisuals.Icon;
  const AssistantIcon = assistantVisuals.Icon;
  // The raw model id labels the agent's response — i.e. whichever bubble
  // carries `assistantText`. The fallback comes from the helper so it
  // reads "Assistant" normally and "Agent" in scenario mode.
  const assistantLabel = turn.models[0] || assistantVisuals.bubbleLabel;

  // A field a privacy rule hid never renders the media that was hidden with
  // it. The server drops the references alongside the text; this is the
  // render-side half of the same rule, so a reference that outlives its
  // content still shows nothing.
  const visibleUserMedia = turn.inputRedacted ? EMPTY_MEDIA : userMedia;
  const visibleAssistantMedia = turn.outputRedacted ? EMPTY_MEDIA : assistantMedia;
  // Only the thread layout has a message body to hang media off, so it is the
  // only one where media on its own is reason enough to draw a message: a
  // voice turn that recorded no transcript would otherwise lose its recording.
  const hasUserMedia = layout === "thread" && visibleUserMedia.length > 0;
  const hasAssistantMedia = layout === "thread" && visibleAssistantMedia.length > 0;

  // Each side carries what it said, so a correction of it starts from that
  // text: the reply's from the turn's output, the user message's from the
  // turn's input, which is the field a correction of it replaces.
  const userAnnotateTarget = useMemo(
    () => ({
      traceId: turn.traceId,
      anchorPath: "input" as const,
      text: turn.input,
    }),
    [turn.traceId, turn.input],
  );
  const assistantAnnotateTarget = useMemo(
    () => ({
      traceId: turn.traceId,
      anchorPath: "output" as const,
      text: turn.output,
    }),
    [turn.traceId, turn.output],
  );

  // Only a side with text of its own can be translated: an empty message has
  // nothing to flip, and offering it would be a button that does nothing.
  const userTranslate = originalUserText.trim()
    ? toMessageTranslation(userTranslation)
    : undefined;
  const assistantTranslate = originalAssistantText.trim()
    ? toMessageTranslation(assistantTranslation)
    : undefined;

  return (
    <VStack align="stretch" gap={layout === "thread" ? 1 : 2}>
      {showGap && (
        <Flex align="center" gap={2}>
          <Box height="1px" flex={1} bg="border.muted" />
          <Text textStyle="2xs" color="fg.subtle">
            {formatGap(gapSecs)}
          </Text>
          <Box height="1px" flex={1} bg="border.muted" />
        </Flex>
      )}

      <TurnSeparator
        index={index}
        turn={turn}
        isCurrent={isCurrent}
        onSelect={handleSelect}
        // Thread layout stacks both roles full-width on the left, so there's
        // no "opposite side" to anchor the inline actions to — pin them right.
        assistantSide={layout === "thread" ? "right" : assistantSide}
        annotationItems={annotationItems}
        showSessionCheckbox={showSessionCheckbox}
      />

      {userText || hasUserMedia ? (
        <TurnMessage
          layout={layout}
          side={userSide}
          tone={userVisuals.displayRole}
          label={userVisuals.bubbleLabel}
          icon={<UserIcon />}
          text={userText}
          media={visibleUserMedia}
          isSelected={isCurrent}
          onClick={handleSelect}
          annotation={userAnnotations}
          annotate={userAnnotateTarget}
          translate={userTranslate}
        />
      ) : turn.inputRedacted ? (
        // Input hidden by a privacy rule — show the shared "Redacted" marker on
        // the user side rather than silently omitting the bubble, so a hidden
        // turn doesn't read as the user having said nothing.
        <RedactedTurnLine
          layout={layout}
          side={userSide}
          tone={userVisuals.displayRole}
          label={userVisuals.bubbleLabel}
          icon={<UserIcon />}
          visibleTo={turn.inputVisibleTo}
        />
      ) : null}

      {/*
        The loop that ran between the prompt and the reply. A coding-agent turn
        can call the model five times and run a dozen tools, and the two bubbles
        either side of this show none of it — so the steps sit where they
        happened. Collapsed by default; the spans are only fetched on open.
      */}
      {((isTerminalOrigin({
        serviceName: turn.serviceName,
        origin: turn.origin,
      }) &&
        // TurnSteps parses Claude Code's span names — for any other coding
        // agent the strip would announce steps and then find none.
        (turn.serviceName ?? "").toLowerCase().includes("claude")) ||
        // Routed Genie turns carry no coding-agent service name; the trace
        // name is their signal, and only multi-span turns have a SQL step.
        turnHasGenieSteps(turn)) && (
        <TurnSteps
          traceId={turn.traceId}
          occurredAtMs={turn.timestamp}
          spanCount={turn.spanCount}
        />
      )}

      {assistantText ? (
        <TurnMessage
          layout={layout}
          side={assistantSide}
          tone={assistantVisuals.displayRole}
          label={assistantLabel}
          icon={<AssistantIcon />}
          text={assistantText}
          reasoning={assistantReasoning}
          media={visibleAssistantMedia}
          isSelected={isCurrent}
          onClick={handleSelect}
          annotation={assistantAnnotations}
          annotate={assistantAnnotateTarget}
          translate={assistantTranslate}
        />
      ) : turn.error ? (
        <TurnMessage
          layout={layout}
          side={assistantSide}
          tone="error"
          label="Error"
          icon={<AlertTriangle />}
          text={turn.error}
          reasoning={assistantReasoning}
          media={visibleAssistantMedia}
          isSelected={isCurrent}
          onClick={handleSelect}
          annotation={assistantAnnotations}
          annotate={assistantAnnotateTarget}
          translate={assistantTranslate}
        />
      ) : assistantReasoning || hasAssistantMedia ? (
        <TurnMessage
          layout={layout}
          side={assistantSide}
          tone={assistantVisuals.displayRole}
          label={assistantLabel}
          icon={<AssistantIcon />}
          text=""
          reasoning={assistantReasoning}
          media={visibleAssistantMedia}
          isSelected={isCurrent}
          onClick={handleSelect}
          annotation={assistantAnnotations}
          annotate={assistantAnnotateTarget}
          translate={assistantTranslate}
        />
      ) : turn.outputRedacted ? (
        // Output hidden by a privacy rule — the shared "Redacted" marker on the
        // assistant side, so a hidden response isn't mistaken for an empty turn.
        <RedactedTurnLine
          layout={layout}
          side={assistantSide}
          tone={assistantVisuals.displayRole}
          label={assistantLabel}
          icon={<AssistantIcon />}
          visibleTo={turn.outputVisibleTo}
        />
      ) : null}
    </VStack>
  );
});

/**
 * A turn message slot whose content was hidden by a privacy rule. Reuses the
 * same role icon + label chrome as a real message (so the side/role still reads
 * at a glance) but renders the shared `RedactedInline` marker where the prose
 * would be. One treatment across the bubbles and thread layouts.
 */
function RedactedTurnLine({
  layout,
  side,
  tone,
  label,
  icon,
  visibleTo,
}: {
  layout: TurnLayout;
  side: BubbleSide;
  tone: BubbleTone;
  label: string;
  icon: React.ReactNode;
  visibleTo?: string | null;
}) {
  const palette = getRolePalette(TONE_ROLE[tone]);
  const marker = <RedactedInline visibleTo={visibleTo} size="xs" />;
  if (layout === "thread") {
    return (
      <Flex gap={2.5} align="center" width="full" paddingX={3} paddingY={2.5}>
        <Circle size="24px" bg={palette.muted} color={palette.fg} flexShrink={0}>
          <Icon boxSize="13px">{icon}</Icon>
        </Circle>
        <Box flex={1} minWidth={0}>
          <Text
            textStyle="2xs"
            fontWeight="600"
            color={palette.fg}
            textTransform="uppercase"
            letterSpacing="0.06em"
            marginBottom={1}
          >
            {label}
          </Text>
          {marker}
        </Box>
      </Flex>
    );
  }
  // Bubbles layout: align the marker to the message's side so it sits where the
  // bubble would, framed by the same role label.
  return (
    <Flex justify={side === "right" ? "flex-end" : "flex-start"} width="full">
      <VStack align={side === "right" ? "flex-end" : "flex-start"} gap={1} maxWidth="78%">
        <HStack gap={1.5} color={palette.fg}>
          <Icon boxSize="13px">{icon}</Icon>
          <Text
            textStyle="2xs"
            fontWeight="600"
            textTransform="uppercase"
            letterSpacing="0.06em"
          >
            {label}
          </Text>
        </HStack>
        {marker}
      </VStack>
    </Flex>
  );
}

interface TurnMessageProps {
  layout: TurnLayout;
  side: BubbleSide;
  tone: BubbleTone;
  label: string;
  icon: React.ReactNode;
  text: string;
  reasoning?: string;
  /** Media recorded on this message's side of the turn. Thread layout only. */
  media?: MediaPartData[];
  isSelected?: boolean;
  onClick?: () => void;
  annotation?: MessageAnnotationSummary;
  /** What a comment left on this message is about. */
  annotate?: MessageAnnotateTarget;
  /** Flipping this message to English, when it has text to flip. */
  translate?: MessageTranslation;
}

/**
 * One message bubble in a turn, rendered either as a side bubble (bubbles
 * layout) or a full-width ChatGPT-style row (thread layout). Both share the
 * same tone / label / annotation inputs so toggling the layout never changes
 * what's shown, only how it's arranged.
 */
function TurnMessage({ layout, side, media, ...rest }: TurnMessageProps) {
  if (layout === "thread") {
    return <ThreadMessage media={media} {...rest} />;
  }
  return <Bubble side={side} size="compact" maxChars={500} {...rest} />;
}

/** Maps a bubble tone onto the canonical role palette used by thread layout. */
const TONE_ROLE: Record<BubbleTone, string> = {
  user: "user",
  assistant: "assistant",
  system: "system",
  error: "assistant",
};

const THREAD_MAX_CHARS = 800;

function ThreadMessage({
  tone,
  label,
  icon,
  text,
  reasoning,
  media = EMPTY_MEDIA,
  onClick,
  annotation,
  annotate,
  translate,
}: Omit<TurnMessageProps, "layout" | "side">) {
  const palette = getRolePalette(TONE_ROLE[tone]);
  const isError = tone === "error";
  const hasAnnotation = !!annotation && annotation.count > 0;

  // Per-message expand, seeded from the conversation-view "Expand all"
  // toggle. A truncated message gets a Show more / Show less affordance
  // instead of a bare "…". See
  // specs/traces-v2/conversation-message-expand.feature
  const { shouldExpandAll } = useConversationExpand();
  const [expanded, setExpanded] = useState(shouldExpandAll);
  useEffect(() => setExpanded(shouldExpandAll), [shouldExpandAll]);
  const canExpand = text.length > THREAD_MAX_CHARS;
  const display =
    !canExpand || expanded
      ? text
      : truncateMarkdown({ text, maxChars: THREAD_MAX_CHARS }).replace(/\n+…\s*$/, "");

  // No persistent "selected" background — the active turn reads flat like the
  // rest of the thread (ChatGPT-style); only a transient hover cue signals the
  // row is clickable.
  return (
    <Flex
      gap={2.5}
      align="flex-start"
      width="full"
      paddingX={3}
      paddingY={2.5}
      borderRadius="lg"
      cursor={onClick ? "pointer" : "default"}
      transition="background 0.15s ease"
      _hover={onClick ? { bg: "bg.subtle" } : undefined}
      // `className="group"` is what the comment cluster's `_groupHover`
      // resolves against; the role is what tells a reader the message and its
      // actions are one thing. The turn separator's own group sits on a
      // sibling, so the two scopes never nest.
      className="group"
      role="group"
      onClick={(e: React.MouseEvent) => {
        if (!onClick) return;
        e.stopPropagation();
        onClick();
      }}
    >
      <Circle
        size="24px"
        bg={isError ? "red.muted" : palette.muted}
        color={isError ? "red.fg" : palette.fg}
        flexShrink={0}
        marginTop="1px"
      >
        <Icon boxSize="13px">{icon}</Icon>
      </Circle>

      <Box flex={1} minWidth={0}>
        <HStack gap={1.5} marginBottom={1} align="center">
          <Text
            textStyle="2xs"
            fontWeight="600"
            color={isError ? "red.fg" : palette.fg}
            textTransform="uppercase"
            letterSpacing="0.06em"
          >
            {label}
          </Text>
          {hasAnnotation && (
            <HStack
              gap={0.5}
              paddingX={1.5}
              paddingY={0.5}
              borderRadius="sm"
              bg="amber.subtle"
              color="amber.fg"
              aria-label={`${annotation!.count} annotation${
                annotation!.count === 1 ? "" : "s"
              }${annotation!.hasCorrection ? ", includes correction" : ""}`}
            >
              <Icon as={MessageSquare} boxSize="10px" />
              <Text textStyle="2xs" fontWeight="600" lineHeight="1">
                {annotation!.count}
              </Text>
              {annotation!.hasCorrection && (
                <Icon as={Lightbulb} boxSize="10px" color="yellow.fg" />
              )}
            </HStack>
          )}
          {annotate && (
            <>
              <Spacer />
              <MessageAnnotateCluster target={annotate} translation={translate} />
            </>
          )}
        </HStack>

        {reasoning && (
          <Box mb={text ? "2.5" : "0"} bg="bg.muted/60" px="3" py="2" borderRadius="md">
            <ReasoningBlock text={reasoning} />
          </Box>
        )}

        {display && (
          <Box
            color={isError ? "red.fg" : "fg"}
            css={{
              "& > div": { fontSize: "13.5px", lineHeight: "1.6" },
              "& h1": { fontSize: "1.15em !important" },
              "& h2": { fontSize: "1.1em !important" },
              "& h3": { fontSize: "1.05em !important" },
              "& h4, & h5, & h6": { fontSize: "1em !important" },
            }}
          >
            <Markdown>{display}</Markdown>
          </Box>
        )}

        {canExpand && (
          <MessageExpandToggle
            expanded={expanded}
            onToggle={() => setExpanded((v) => !v)}
          />
        )}

        {/* Recordings, images and attachments sit under the prose they came
            with, the way attachments sit under an email body. Clicks stay on
            the widget so scrubbing a player doesn't navigate to the turn. */}
        {media.length > 0 && (
          <Box paddingTop={2} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
            <TraceMediaStrip parts={media} />
          </Box>
        )}
      </Box>
    </Flex>
  );
}

interface LedgerSegment {
  id: string;
  text: string;
}

/**
 * The scannable few fields a separator carries, in reading order: duration,
 * latency, cost, how many events the turn recorded, and how long ago it ran. A
 * field the turn has nothing to say about is left out rather than shown as
 * zero. The model abbreviation and the raw input→output token count read as
 * cryptic here, and live in the trace header and metrics instead.
 */
function turnLedgerSegments(turn: TraceListItem): LedgerSegment[] {
  const segments: LedgerSegment[] = [
    { id: "duration", text: formatDuration(turn.durationMs) },
  ];
  if (turn.ttft != null && turn.ttft > 0) {
    segments.push({ id: "ttft", text: `ttft ${formatDuration(turn.ttft)}` });
  }
  if ((turn.totalCost ?? 0) > 0) {
    segments.push({ id: "cost", text: formatCost(turn.totalCost) });
  }
  // The count only: the legacy thread view also drew the vote an event
  // carried, and the conversation's turn data has no event metrics for it.
  const eventCount = turn.events.totalCount;
  if (eventCount > 0) {
    segments.push({
      id: "events",
      text: `${eventCount} ${eventCount === 1 ? "event" : "events"}`,
    });
  }
  segments.push({ id: "age", text: formatRelativeTimeAgo(turn.timestamp) });
  return segments;
}

function Sep() {
  return (
    <Text textStyle="2xs" color="fg.subtle">
      ·
    </Text>
  );
}

/** Which turn this is, what it cost to run, and whether it failed. */
function TurnLedger({
  index,
  turn,
  isHighlighted,
}: {
  index: number;
  turn: TraceListItem;
  /** True on the turn under review, and on one the sitting counts. */
  isHighlighted: boolean;
}) {
  return (
    <HStack gap={1.5} flexShrink={0} flexWrap="wrap" justify="center">
      <Text
        textStyle="2xs"
        color={isHighlighted ? "blue.fg" : "fg.subtle"}
        fontWeight="600"
        textTransform="uppercase"
        letterSpacing="0.06em"
      >
        Turn {index}
      </Text>
      {turnLedgerSegments(turn).map((segment) => (
        <Fragment key={segment.id}>
          <Sep />
          <Text textStyle="2xs" color="fg.subtle">
            {segment.text}
          </Text>
        </Fragment>
      ))}
      {turn.status === "error" && (
        <>
          <Sep />
          <Text
            textStyle="2xs"
            color="red.fg"
            fontWeight="600"
            textTransform="uppercase"
            letterSpacing="0.06em"
          >
            error
          </Text>
        </>
      )}
    </HStack>
  );
}

const TurnSeparator: React.FC<{
  index: number;
  turn: TraceListItem;
  isCurrent: boolean;
  onSelect: () => void;
  assistantSide: "left" | "right";
  annotationItems: AnnotationItem[];
  showSessionCheckbox: boolean;
}> = ({
  index,
  turn,
  isCurrent,
  onSelect,
  assistantSide,
  annotationItems,
  showSessionCheckbox,
}) => {
  // A turn the sitting counts reads the way the turn under review does: the
  // tick alone is a small thing to find again on a long conversation, and the
  // separator is what the eye follows down it.
  const countsInSession = useAnnotationQueueSessionStore(
    (s) => showSessionCheckbox && isSessionMarked(s.marks, turn.traceId),
  );
  const readsSelected = isCurrent || countsInSession;
  const annotationsOnLeft = assistantSide === "left";
  /*
   * Hover actions float over one end of the separator instead of sitting in
   * flow: the hidden chrome used to reserve ~180px of width, stopping the
   * divider line short of the edge. Absolutely positioned, the lines span the
   * full width and the actions overlay the end while the pointer is on the
   * turn.
   *
   * The badge stays in flow, because it is on screen the whole time a turn
   * carries an annotation and overlaying it would cover the ledger. That puts
   * it at the same end as the actions, so the actions anchor to the badge
   * rather than to the separator: a hidden action row is still a click target,
   * and one lying across the badge swallows the click that opens the
   * annotation list.
   */
  const badgeAnchor = annotationsOnLeft
    ? { left: "100%", marginLeft: 2 }
    : { right: "100%", marginRight: 2 };
  const badgesWithActions = (
    <Box position="relative" display="flex" alignItems="center" flexShrink={0}>
      <TurnAnnotationBadges
        traceId={turn.traceId}
        output={turn.output}
        prefetchedItems={annotationItems}
      />
      <HStack
        position="absolute"
        top="50%"
        transform="translateY(-50%)"
        gap={1}
        // Shrink-to-fit would size the actions against the badge slot they are
        // anchored to and let them wrap, or spill back over the badge.
        width="max-content"
        {...badgeAnchor}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        <TurnEditTraceAction traceId={turn.traceId} occurredAtMs={turn.timestamp} />
      </HStack>
    </Box>
  );
  return (
    <Flex
      position="relative"
      align="center"
      gap={2}
      cursor="pointer"
      onClick={onSelect}
      // `className="group"` is what `_groupHover` on the action row resolves
      // against; the role is what tells a reader the separator and its actions
      // are one thing.
      className="group"
      role="group"
      // Says in one place what the lines and the ledger read from: the turn
      // under review, or one the sitting counts.
      data-highlighted={readsSelected ? "true" : "false"}
      _hover={{ "& > .turn-line": { bg: "border.emphasized" } }}
    >
      {/* The session's tick leads the separator: ticked state is scanned down
          the left of a list of turns, and it is on screen the whole time the
          queue is being walked rather than arriving with the pointer like the
          actions do. */}
      {showSessionCheckbox && <TurnSessionCheckbox traceId={turn.traceId} />}
      {annotationsOnLeft && badgesWithActions}
      <Box
        className="turn-line"
        height="1px"
        flex={1}
        bg={readsSelected ? "blue.solid" : "border.muted"}
        transition="background 0.12s ease"
      />
      <TurnLedger index={index} turn={turn} isHighlighted={readsSelected} />
      <Box
        className="turn-line"
        height="1px"
        flex={1}
        bg={readsSelected ? "blue.solid" : "border.muted"}
        transition="background 0.12s ease"
      />
      {!annotationsOnLeft && badgesWithActions}
    </Flex>
  );
};
