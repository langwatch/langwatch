import { Box, Flex, HStack, Text, VStack } from "@chakra-ui/react";
import { AlertTriangle } from "lucide-react";
import { memo, useCallback } from "react";
import type { TraceListItem } from "../../../types/trace";
import {
  abbreviateModel,
  formatCost,
  formatDuration,
  formatRelativeTime,
  formatTokens,
} from "../../../utils/formatters";
import { Bubble } from "../../TraceTable/registry/addons/conversation/Bubble";
import { getDisplayRoleVisuals, useIsScenarioRole } from "../scenarioRoles";
import { TurnActionRow, TurnAnnotationBadges } from "./TurnAnnotations";
import { formatGap } from "./utils";

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
}) {
  const handleSelect = useCallback(
    () => onSelect(turn.traceId),
    [onSelect, turn.traceId],
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
    <VStack align="stretch" gap={2}>
      {showGap && (
        <Flex align="center" gap={2}>
          <Box height="1px" flex={1} bg="border.muted" />
          <Text textStyle="2xs" color="fg.subtle" fontFamily="mono">
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
      />

      {userText && (
        <Bubble
          side={userSide}
          tone={userVisuals.displayRole}
          label={userVisuals.bubbleLabel}
          icon={<UserIcon />}
          text={userText}
          isSelected={isCurrent}
          onClick={handleSelect}
          size="compact"
          maxChars={500}
        />
      )}

      {assistantText ? (
        <Bubble
          side={assistantSide}
          tone={assistantVisuals.displayRole}
          label={assistantLabel}
          icon={<AssistantIcon />}
          text={assistantText}
          reasoning={assistantReasoning}
          isSelected={isCurrent}
          onClick={handleSelect}
          size="compact"
          maxChars={500}
        />
      ) : turn.error ? (
        <Bubble
          side={assistantSide}
          tone="error"
          label="Error"
          icon={<AlertTriangle />}
          text={turn.error}
          reasoning={assistantReasoning}
          isSelected={isCurrent}
          onClick={handleSelect}
          size="compact"
          maxChars={500}
        />
      ) : assistantReasoning ? (
        <Bubble
          side={assistantSide}
          tone={assistantVisuals.displayRole}
          label={assistantLabel}
          icon={<AssistantIcon />}
          text=""
          reasoning={assistantReasoning}
          isSelected={isCurrent}
          onClick={handleSelect}
          size="compact"
          maxChars={500}
        />
      ) : null}

    </VStack>
  );
});

const TurnSeparator: React.FC<{
  index: number;
  turn: TraceListItem;
  isCurrent: boolean;
  onSelect: () => void;
}> = ({ index, turn, isCurrent, onSelect }) => {
  // Pick the bits worth showing per turn — model, duration, latency, token
  // load, cost, error state — so the separator reads as a per-turn ledger
  // rather than just "Turn N · Xs". Skips fields that don't apply (no cost
  // → no `$0` chip; ok status → no error chip) to stay scannable.
  const model = turn.models[0] ? abbreviateModel(turn.models[0]) : null;
  const hasCost = (turn.totalCost ?? 0) > 0;
  const hasTokens = turn.totalTokens > 0;
  const isError = turn.status === "error";

  const Sep = () => (
    <Text textStyle="2xs" color="fg.subtle" fontFamily="mono">
      ·
    </Text>
  );

  return (
    <Flex
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
            <Text textStyle="2xs" color="fg.muted" fontFamily="mono">
              {model}
            </Text>
          </>
        )}
        <Sep />
        <Text textStyle="2xs" color="fg.subtle" fontFamily="mono">
          {formatDuration(turn.durationMs)}
        </Text>
        {turn.ttft != null && turn.ttft > 0 && (
          <>
            <Sep />
            <Text textStyle="2xs" color="fg.subtle" fontFamily="mono">
              ttft {formatDuration(turn.ttft)}
            </Text>
          </>
        )}
        {hasTokens && (
          <>
            <Sep />
            <Text textStyle="2xs" color="fg.subtle" fontFamily="mono">
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
            <Text textStyle="2xs" color="fg.subtle" fontFamily="mono">
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
      <TurnAnnotationBadges traceId={turn.traceId} output={turn.output} />
      <TurnActionRow traceId={turn.traceId} output={turn.output} />
    </Flex>
  );
};
