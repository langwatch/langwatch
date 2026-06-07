import {
  Box,
  Circle,
  Flex,
  HStack,
  Icon,
  Text,
  VStack,
} from "@chakra-ui/react";
import { AlertTriangle, Lightbulb, MessageSquare } from "lucide-react";
import { memo, useCallback, useMemo } from "react";
import { Markdown } from "~/components/Markdown";
import type { RouterOutputs } from "~/utils/api";
import type { TraceListItem } from "../../../types/trace";
import {
  abbreviateModel,
  formatCost,
  formatDuration,
  formatRelativeTime,
  formatTokens,
} from "../../../utils/formatters";
import {
  Bubble,
  type BubbleSide,
  type BubbleTone,
  truncateMarkdown,
} from "../../TraceTable/registry/addons/conversation/Bubble";
import { getDisplayRoleVisuals, useIsScenarioRole } from "../scenarioRoles";
import { getRolePalette, ReasoningBlock } from "../transcript";
import { TurnActionRow, TurnAnnotationBadges } from "./TurnAnnotations";
import type { TurnLayout } from "./types";
import { formatGap } from "./utils";

type AnnotationItem = RouterOutputs["annotation"]["getByTraceIds"][number];
const EMPTY_ANNOTATIONS: AnnotationItem[] = [];

interface ChatTurnRowProps {
  turn: TraceListItem;
  userText: string;
  assistantText: string;
  assistantReasoning: string;
  gapSecs: number;
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
}

export const ChatTurnRow = memo<ChatTurnRowProps>(function ChatTurnRow({
  turn,
  userText,
  assistantText,
  assistantReasoning,
  gapSecs,
  showGap,
  index,
  isCurrent,
  onSelect,
  layout = "bubbles",
  annotationItems = EMPTY_ANNOTATIONS,
}) {
  const handleSelect = useCallback(
    () => onSelect(turn.traceId),
    [onSelect, turn.traceId],
  );

  const annotationSummary = useMemo(() => {
    if (annotationItems.length === 0) return undefined;
    return {
      count: annotationItems.length,
      hasCorrection: annotationItems.some((a) => !!a.expectedOutput),
    };
  }, [annotationItems]);

  // Scenario-aware visual mapping. The text fields stay role-faithful
  // (`userText` is whatever the source `user` message said), but the
  // bubble's side / tone / label / icon flip in scenario mode so the
  // agent under test reads as the trace's "user" and the simulator
  // reads as the "assistant".
  const isScenario = useIsScenarioRole();
  const userVisuals = getDisplayRoleVisuals("user", { isScenario });
  const assistantVisuals = getDisplayRoleVisuals("assistant", { isScenario });
  const userSide = userVisuals.displayRole === "user" ? "left" : "right";
  const assistantSide =
    assistantVisuals.displayRole === "user" ? "left" : "right";
  const UserIcon = userVisuals.Icon;
  const AssistantIcon = assistantVisuals.Icon;
  // Model abbreviation belongs with the agent's response — i.e. whichever
  // bubble carries `assistantText`. The fallback comes from the helper so
  // it reads "Assistant" normally and "Agent" in scenario mode.
  const assistantLabel = turn.models[0]
    ? abbreviateModel(turn.models[0])
    : assistantVisuals.bubbleLabel;

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
      />

      {userText && (
        <TurnMessage
          layout={layout}
          side={userSide}
          tone={userVisuals.displayRole}
          label={userVisuals.bubbleLabel}
          icon={<UserIcon />}
          text={userText}
          isSelected={isCurrent}
          onClick={handleSelect}
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
          isSelected={isCurrent}
          onClick={handleSelect}
          annotation={annotationSummary}
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
          isSelected={isCurrent}
          onClick={handleSelect}
          annotation={annotationSummary}
        />
      ) : assistantReasoning ? (
        <TurnMessage
          layout={layout}
          side={assistantSide}
          tone={assistantVisuals.displayRole}
          label={assistantLabel}
          icon={<AssistantIcon />}
          text=""
          reasoning={assistantReasoning}
          isSelected={isCurrent}
          onClick={handleSelect}
          annotation={annotationSummary}
        />
      ) : null}
    </VStack>
  );
});

interface TurnMessageProps {
  layout: TurnLayout;
  side: BubbleSide;
  tone: BubbleTone;
  label: string;
  icon: React.ReactNode;
  text: string;
  reasoning?: string;
  isSelected?: boolean;
  onClick?: () => void;
  annotation?: { count: number; hasCorrection: boolean };
}

/**
 * One message bubble in a turn, rendered either as a side bubble (bubbles
 * layout) or a full-width ChatGPT-style row (thread layout). Both share the
 * same tone / label / annotation inputs so toggling the layout never changes
 * what's shown, only how it's arranged.
 */
function TurnMessage({ layout, side, ...rest }: TurnMessageProps) {
  if (layout === "thread") {
    return <ThreadMessage {...rest} />;
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
  onClick,
  annotation,
}: Omit<TurnMessageProps, "layout" | "side">) {
  const palette = getRolePalette(TONE_ROLE[tone]);
  const isError = tone === "error";
  const display = truncateMarkdown({ text, maxChars: THREAD_MAX_CHARS });
  const hasAnnotation = !!annotation && annotation.count > 0;

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
        </HStack>

        {reasoning && (
          <Box
            mb={text ? "2.5" : "0"}
            bg="bg.muted/60"
            px="3"
            py="2"
            borderRadius="md"
          >
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
      </Box>
    </Flex>
  );
}

const TurnSeparator: React.FC<{
  index: number;
  turn: TraceListItem;
  isCurrent: boolean;
  onSelect: () => void;
  assistantSide: "left" | "right";
  annotationItems: AnnotationItem[];
}> = ({ index, turn, isCurrent, onSelect, assistantSide, annotationItems }) => {
  // Pick the bits worth showing per turn — model, duration, latency, token
  // load, cost, error state — so the separator reads as a per-turn ledger
  // rather than just "Turn N · Xs". Skips fields that don't apply (no cost
  // → no `$0` chip; ok status → no error chip) to stay scannable.
  const model = turn.models[0] ? abbreviateModel(turn.models[0]) : null;
  const hasCost = (turn.totalCost ?? 0) > 0;
  const hasTokens = turn.totalTokens > 0;
  const isError = turn.status === "error";

  const Sep = () => (
    <Text textStyle="2xs" color="fg.subtle">
      ·
    </Text>
  );

  const annotationsOnLeft = assistantSide === "left";
  return (
    <Flex
      position="relative"
      align="center"
      gap={2}
      cursor="pointer"
      onClick={onSelect}
      role="group"
      _hover={{ "& > .turn-line": { bg: "border.emphasized" } }}
    >
      <Box
        className="turn-line"
        height="1px"
        flex={1}
        bg={isCurrent ? "blue.solid" : "border.muted"}
        transition="background 0.12s ease"
      />
      <HStack gap={1.5} flexShrink={0} flexWrap="wrap" justify="center">
        <Text
          textStyle="2xs"
          color={isCurrent ? "blue.fg" : "fg.subtle"}
          fontWeight="600"
          textTransform="uppercase"
          letterSpacing="0.06em"
        >
          Turn {index}
        </Text>
        {model && (
          <>
            <Sep />
            <Text textStyle="2xs" color="fg.muted">
              {model}
            </Text>
          </>
        )}
        <Sep />
        <Text textStyle="2xs" color="fg.subtle">
          {formatDuration(turn.durationMs)}
        </Text>
        {turn.ttft != null && turn.ttft > 0 && (
          <>
            <Sep />
            <Text textStyle="2xs" color="fg.subtle">
              ttft {formatDuration(turn.ttft)}
            </Text>
          </>
        )}
        {hasTokens && (
          <>
            <Sep />
            <Text textStyle="2xs" color="fg.subtle">
              {turn.inputTokens != null && turn.outputTokens != null
                ? `${formatTokens(turn.inputTokens)}→${formatTokens(turn.outputTokens)}`
                : `${formatTokens(turn.totalTokens)} tok`}
              {turn.tokensEstimated ? "*" : ""}
            </Text>
          </>
        )}
        {hasCost && (
          <>
            <Sep />
            <Text textStyle="2xs" color="fg.subtle">
              {formatCost(turn.totalCost)}
            </Text>
          </>
        )}
        <Sep />
        <Text textStyle="2xs" color="fg.subtle">
          {formatRelativeTime(turn.timestamp)}
        </Text>
        {isError && (
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
      <Box
        className="turn-line"
        height="1px"
        flex={1}
        bg={isCurrent ? "blue.solid" : "border.muted"}
        transition="background 0.12s ease"
      />
      {/* Inline actions float over one end of the separator instead of
          sitting in flow — the hidden hover chrome used to reserve ~180px of
          width, stopping the divider line short of the edge. Absolutely
          positioned, the lines now span the full width and the badge/actions
          overlay the end (badges only when present, actions on hover). */}
      <HStack
        position="absolute"
        top="50%"
        transform="translateY(-50%)"
        gap={1}
        {...(annotationsOnLeft ? { left: 0 } : { right: 0 })}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        <TurnAnnotationBadges
          traceId={turn.traceId}
          output={turn.output}
          prefetchedItems={annotationItems}
        />
        <TurnActionRow traceId={turn.traceId} output={turn.output} />
      </HStack>
    </Flex>
  );
};
