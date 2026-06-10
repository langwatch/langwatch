import {
  Circle,
  HoverCard,
  HStack,
  Portal,
  Text,
  VStack,
} from "@chakra-ui/react";
import type React from "react";
import type { IconType } from "react-icons";
import { LuCircleSlash, LuCircleAlert } from "react-icons/lu";
import {
  getEvalChipDisplay,
  type EvalChipDisplay,
} from "~/utils/evaluationResults";
import type { TraceEvalResult, TraceListEvent } from "../../../types/trace";

/**
 * Re-exported for callers that already imported from this module — the
 * canonical formatter now lives in `evaluationResults.ts` so the trace
 * table, the drawer header and any future surface format scores
 * identically.
 */
export function formatEvalScore(ev: TraceEvalResult): string | null {
  return getEvalChipDisplay(ev).scoreText;
}

export function evalChipColor(ev: TraceEvalResult): string {
  return getEvalChipDisplay(ev).color;
}

/**
 * Render the trailing verdict slot. Skipped / error get a tinted-bg
 * badge with a leading icon so they don't look like a real score; pure
 * boolean verdicts get colored "Pass" / "Fail" text; numeric scores stay
 * as muted-foreground numerals.
 */
function VerdictSlot({ display }: { display: EvalChipDisplay }) {
  if (display.status === "skipped") return <NoVerdictBadge label="SKIPPED" icon={LuCircleSlash} />;
  if (display.status === "error") return <NoVerdictBadge label="ERROR" icon={LuCircleAlert} />;
  if (display.scoreText) {
    return (
      <Text
        textStyle="2xs"
        fontWeight="semibold"
        color="fg.muted"
        whiteSpace="nowrap"
        lineHeight="1.2"
      >
        {display.scoreText}
      </Text>
    );
  }
  if (display.passLabel) {
    return (
      <Text
        textStyle="2xs"
        fontWeight="semibold"
        color={display.passLabel.color}
        whiteSpace="nowrap"
        lineHeight="1.2"
      >
        {display.passLabel.text}
      </Text>
    );
  }
  return null;
}

function NoVerdictBadge({ label, icon: Icon }: { label: string; icon: IconType }) {
  return (
    <HStack
      gap={1}
      paddingX={1.5}
      paddingY={0}
      borderRadius="sm"
      borderWidth="1px"
      borderColor="border.muted"
      bg="bg.muted"
      flexShrink={0}
    >
      <Icon size={10} />
      <Text
        textStyle="2xs"
        fontWeight="bold"
        color="fg.muted"
        letterSpacing="0.04em"
        lineHeight="1.2"
      >
        {label}
      </Text>
    </HStack>
  );
}

export const EvalChip: React.FC<{ eval_: TraceEvalResult }> = ({ eval_ }) => {
  const display = getEvalChipDisplay(eval_);

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
          {/* Dot always renders so every chip lines up regardless of
              whether the trailing slot is a score, a Pass/Fail label,
              or a no-verdict badge. */}
          <Circle size="10px" bg={display.color} flexShrink={0} />
          <Text
            textStyle="2xs"
            fontWeight="medium"
            color="fg"
            truncate
            maxWidth="80px"
            lineHeight="1.2"
          >
            {display.displayName}
          </Text>
          <VerdictSlot display={display} />
        </HStack>
      </HoverCard.Trigger>
      <Portal>
        <HoverCard.Positioner>
          <HoverCard.Content
            width="auto"
            minWidth="160px"
            maxWidth="220px"
            padding={3}
            borderRadius="xl"
            background="bg.panel"
            boxShadow="lg"
          >
            <VStack align="stretch" gap={1.5}>
              <HStack gap={2}>
                <Circle size="8px" bg={display.color} flexShrink={0} />
                <Text textStyle="xs" fontWeight="semibold" color="fg" truncate>
                  {display.displayName}
                </Text>
              </HStack>
              {display.scoreText && (
                <HStack justify="space-between" gap={3}>
                  <Text textStyle="2xs" color="fg.muted">
                    Score
                  </Text>
                  <Text textStyle="2xs" fontWeight="semibold" color="fg">
                    {display.scoreText}
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
              {display.passLabel && (
                <HStack justify="space-between" gap={3}>
                  <Text textStyle="2xs" color="fg.muted">
                    Result
                  </Text>
                  <Text
                    textStyle="2xs"
                    fontWeight="semibold"
                    color={display.passLabel.color}
                  >
                    {display.statusLabel}
                  </Text>
                </HStack>
              )}
              <HStack justify="space-between" gap={3}>
                <Text textStyle="2xs" color="fg.muted">
                  Status
                </Text>
                <Text
                  textStyle="2xs"
                  fontWeight="semibold"
                  color={display.color}
                >
                  {display.statusLabel}
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
