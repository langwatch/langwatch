import {
  Circle,
  HoverCard,
  HStack,
  Portal,
  Text,
  VStack,
} from "@chakra-ui/react";
import type React from "react";
import type { TraceEvalResult, TraceListEvent } from "../../../types/trace";

const EVAL_CHIP_COLORS: Record<string, string> = {
  processed_pass: "green.solid",
  processed_fail: "red.solid",
  processed_neutral: "blue.solid",
  error: "red.solid",
  skipped: "yellow.solid",
  in_progress: "blue.solid",
  scheduled: "gray.solid",
};

export function evalChipColor(ev: TraceEvalResult): string {
  if (ev.status === "processed") {
    if (ev.passed === true) return EVAL_CHIP_COLORS.processed_pass!;
    if (ev.passed === false) return EVAL_CHIP_COLORS.processed_fail!;
    return EVAL_CHIP_COLORS.processed_neutral!;
  }
  return EVAL_CHIP_COLORS[ev.status] ?? "gray.solid";
}

export function formatEvalScore(ev: TraceEvalResult): string | null {
  if (ev.score == null) return null;
  if (ev.score <= 1) return ev.score.toFixed(2);
  return ev.score.toFixed(1);
}

function getStatusLabel(ev: TraceEvalResult): string {
  if (ev.status === "processed") {
    if (ev.passed === true) return "Passed";
    if (ev.passed === false) return "Failed";
    return "Processed";
  }
  if (ev.status === "in_progress") return "Running";
  if (ev.status === "scheduled") return "Pending";
  if (ev.status === "error") return "Error";
  if (ev.status === "skipped") return "Skipped";
  return ev.status;
}

export const EvalChip: React.FC<{ eval_: TraceEvalResult }> = ({ eval_ }) => {
  const color = evalChipColor(eval_);
  const scoreText = formatEvalScore(eval_);
  const displayName = eval_.evaluatorName ?? eval_.evaluatorId;

  return (
    <HoverCard.Root
      openDelay={200}
      closeDelay={150}
      positioning={{ placement: "top" }}
    >
      <HoverCard.Trigger asChild>
        <HStack
          gap={1.5}
          paddingX={2}
          paddingY={0.5}
          borderRadius="md"
          borderWidth="1px"
          borderColor="border"
          bg="bg.panel"
          cursor="help"
          flexShrink={0}
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
        >
          <Circle size="8px" bg={color} flexShrink={0} />
          <Text
            textStyle="2xs"
            fontWeight="medium"
            color="fg"
            truncate
            maxWidth="80px"
            lineHeight="1.2"
          >
            {displayName}
          </Text>
          {scoreText && (
            <Text
              textStyle="2xs"
              fontWeight="semibold"
              color="fg.muted"
              whiteSpace="nowrap"
              lineHeight="1.2"
            >
              {scoreText}
            </Text>
          )}
          {eval_.passed != null && eval_.score == null && (
            <Text
              textStyle="2xs"
              fontWeight="semibold"
              color={eval_.passed ? "green.fg" : "red.fg"}
              whiteSpace="nowrap"
              lineHeight="1.2"
            >
              {eval_.passed ? "Pass" : "Fail"}
            </Text>
          )}
        </HStack>
      </HoverCard.Trigger>
      <Portal>
        <HoverCard.Positioner>
          <HoverCard.Content
            width="auto"
            minWidth="160px"
            maxWidth="220px"
            padding={3}
            borderRadius="lg"
            background="bg.panel"
            boxShadow="lg"
          >
            <VStack align="stretch" gap={1.5}>
              <HStack gap={2}>
                <Circle size="8px" bg={color} flexShrink={0} />
                <Text textStyle="xs" fontWeight="semibold" color="fg" truncate>
                  {displayName}
                </Text>
              </HStack>
              {scoreText && (
                <HStack justify="space-between" gap={3}>
                  <Text textStyle="2xs" color="fg.muted">
                    Score
                  </Text>
                  <Text textStyle="2xs" fontWeight="semibold" color="fg">
                    {scoreText}
                  </Text>
                </HStack>
              )}
              {eval_.label && (
                <HStack justify="space-between" gap={3}>
                  <Text textStyle="2xs" color="fg.muted">
                    Label
                  </Text>
                  <Text textStyle="2xs" fontWeight="semibold" color="fg">
                    {eval_.label}
                  </Text>
                </HStack>
              )}
              {eval_.passed != null && (
                <HStack justify="space-between" gap={3}>
                  <Text textStyle="2xs" color="fg.muted">
                    Result
                  </Text>
                  <Text
                    textStyle="2xs"
                    fontWeight="semibold"
                    color={eval_.passed ? "green.fg" : "red.fg"}
                  >
                    {eval_.passed ? "Passed" : "Failed"}
                  </Text>
                </HStack>
              )}
              <HStack justify="space-between" gap={3}>
                <Text textStyle="2xs" color="fg.muted">
                  Status
                </Text>
                <Text textStyle="2xs" fontWeight="semibold" color={color}>
                  {getStatusLabel(eval_)}
                </Text>
              </HStack>
            </VStack>
          </HoverCard.Content>
        </HoverCard.Positioner>
      </Portal>
    </HoverCard.Root>
  );
};

export const EventBadge: React.FC<{ event: TraceListEvent }> = ({ event }) => (
  <HStack
    gap={1}
    paddingX={2}
    paddingY={0.5}
    borderRadius="md"
    borderWidth="1px"
    borderColor="border"
    bg="bg.panel"
    flexShrink={0}
  >
    <Circle size="6px" bg="blue.solid" flexShrink={0} />
    <Text
      textStyle="2xs"
      fontWeight="medium"
      color="fg"
      truncate
      maxWidth="100px"
      lineHeight="1.2"
    >
      {event.name}
    </Text>
  </HStack>
);
