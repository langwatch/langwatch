import { Box, HStack, Text } from "@chakra-ui/react";
import type React from "react";
import { Tooltip } from "~/components/ui/tooltip";
import {
  CHAPTERS,
  type ChapterId,
  chapterIndex,
} from "../chapters/chapters";
import type { StageId } from "../chapters/onboardingJourneyConfig";

interface BeadStripProps {
  /** Current journey stage — used to compute which dot is active. */
  stage: StageId;
  /**
   * Optional callback. When provided, dots act as click-to-jump
   * affordances; consumers (`TracesEmptyOnboarding`) translate the
   * chosen chapter into a starting `StageId` and call `setStage`.
   * When omitted the strip is purely indicative.
   */
  onJump?: (chapter: ChapterId) => void;
}

/**
 * A row of six small dots — one per chapter — anchored under the
 * hero. The chapter the user is currently in is filled and slightly
 * larger; chapters they've been through are filled but smaller; the
 * remainder are hollow.
 *
 * The strip is intentionally quiet (small dots, muted, generous
 * spacing). It's a "where am I in this" hint, not a navigation bar.
 * Hover/focus surfaces the chapter label and one-line hint via the
 * existing tooltip primitive.
 */
export function BeadStrip({
  stage,
  onJump,
}: BeadStripProps): React.ReactElement {
  const currentIdx = chapterIndex(stage);

  return (
    <HStack
      role="progressbar"
      aria-label="Tour progress"
      aria-valuemin={1}
      aria-valuemax={CHAPTERS.length}
      aria-valuenow={currentIdx + 1}
      gap={2.5}
      justify="center"
      paddingY={1}
    >
      {CHAPTERS.map((chapter, i) => {
        const isCurrent = i === currentIdx;
        const isPast = i < currentIdx;
        // Hover/focus tooltip pairs the chapter label and hint —
        // gives the dots semantic weight without putting that text
        // permanently on screen and competing with the hero copy.
        const labelNode = (
          <Box>
            <Text textStyle="xs" fontWeight={500} color="fg">
              {chapter.label}
            </Text>
            <Text textStyle="2xs" color="fg.muted">
              {chapter.hint}
            </Text>
          </Box>
        );
        const dot = (
          <Box
            as={onJump ? "button" : "span"}
            type={onJump ? "button" : undefined}
            aria-label={chapter.label}
            aria-current={isCurrent ? "step" : undefined}
            onClick={onJump ? () => onJump(chapter.id) : undefined}
            cursor={onJump ? "pointer" : "default"}
            // Three visual states share the same component so the
            // strip animates smoothly on stage change rather than
            // popping a different element type each beat.
            width={isCurrent ? "10px" : "6px"}
            height={isCurrent ? "10px" : "6px"}
            borderRadius="full"
            background={
              isCurrent
                ? "orange.solid"
                : isPast
                  ? "border.emphasized"
                  : "transparent"
            }
            borderWidth={isCurrent || isPast ? 0 : "1px"}
            borderColor="border.muted"
            transition="all 220ms cubic-bezier(0.16, 1, 0.3, 1)"
            _hover={onJump ? { background: "orange.muted" } : undefined}
            _focusVisible={{
              outline: "2px solid",
              outlineColor: "orange.solid",
              outlineOffset: "2px",
            }}
          />
        );
        return (
          <Tooltip
            key={chapter.id}
            content={labelNode}
            positioning={{ placement: "top" }}
          >
            {dot}
          </Tooltip>
        );
      })}
    </HStack>
  );
}
