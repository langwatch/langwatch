import { Box, HStack, Text, VStack } from "@chakra-ui/react";
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
 * Chapter progress strip — connector line, six beads, and a
 * chapter-name label underneath. Sits below the secondary footer
 * (docs / skip buttons) so the dots aren't competing with the hero
 * copy or the primary CTA. The connector line and the active "pill"
 * (a wider rounded rect rather than a dot) make the "you are here +
 * how many left" reading land in one glance, which the previous
 * six-equal-dots design didn't quite do.
 *
 * Tooltip on hover/focus surfaces the chapter label + one-line hint
 * so the dots still earn their semantic weight.
 */
export function BeadStrip({
  stage,
  onJump,
}: BeadStripProps): React.ReactElement {
  const currentIdx = chapterIndex(stage);
  const total = CHAPTERS.length;
  const currentChapter = CHAPTERS[currentIdx];
  // Width of the orange "completed" track. Past beads are fully
  // covered, the active one fills halfway (pill is half along its
  // own slot) so the bar reads as "in the middle of chapter 3" not
  // "chapter 3 done."
  const progressPct = ((currentIdx + 0.5) / total) * 100;

  return (
    <VStack gap={1.5} aria-label="Tour progress">
      <Box
        role="progressbar"
        aria-label="Tour progress"
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={currentIdx + 1}
        position="relative"
        width="180px"
        paddingY={2}
      >
        {/* Connector line — full width, soft. The bar reads as a
            continuous path the user is travelling along, not six
            disconnected dots. */}
        <Box
          position="absolute"
          left={0}
          right={0}
          top="50%"
          height="2px"
          borderRadius="full"
          background="border.muted"
          transform="translateY(-50%)"
        />
        {/* Filled progress — orange section that covers everything up
            to (and including half of) the current chapter. Animates
            smoothly per stage change. */}
        <Box
          position="absolute"
          left={0}
          top="50%"
          height="2px"
          borderRadius="full"
          background="orange.solid"
          transform="translateY(-50%)"
          width={`${progressPct}%`}
          transition="width 280ms cubic-bezier(0.16, 1, 0.3, 1)"
        />
        {/* Beads sit on top of the connector. Equal flex slots so the
            spacing stays even regardless of chapter count. */}
        <HStack
          gap={0}
          justify="space-between"
          position="relative"
          width="full"
        >
          {CHAPTERS.map((chapter, i) => {
            const isCurrent = i === currentIdx;
            const isPast = i < currentIdx;
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
            // The active beat is a wider pill so the eye snaps to it
            // even at small sizes; past/future stay as small dots.
            const dot = (
              <Box
                as={onJump ? "button" : "span"}
                type={onJump ? "button" : undefined}
                aria-label={chapter.label}
                aria-current={isCurrent ? "step" : undefined}
                onClick={onJump ? () => onJump(chapter.id) : undefined}
                cursor={onJump ? "pointer" : "default"}
                width={isCurrent ? "16px" : "8px"}
                height="8px"
                borderRadius="full"
                background={
                  isCurrent || isPast ? "orange.solid" : "bg.surface"
                }
                borderWidth="1px"
                borderColor={
                  isCurrent || isPast ? "orange.solid" : "border.muted"
                }
                boxShadow={
                  isCurrent ? "0 0 0 3px var(--chakra-colors-orange-muted)" : undefined
                }
                transition="all 220ms cubic-bezier(0.16, 1, 0.3, 1)"
                _hover={onJump ? { background: "orange.solid" } : undefined}
                _focusVisible={
                  onJump
                    ? {
                        outline: "2px solid",
                        outlineColor: "orange.solid",
                        outlineOffset: "2px",
                      }
                    : undefined
                }
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
      </Box>
      {/* "Chapter 3 of 6 · Slice" — gives the dots semantic meaning
          without forcing the user to hover. Lowercase "of" feels
          more conversational than "/". */}
      {currentChapter && (
        <Text textStyle="2xs" color="fg.muted" letterSpacing="0.02em">
          <Text as="span" color="fg.subtle">
            {currentIdx + 1} of {total} ·
          </Text>{" "}
          <Text as="span" color="fg.muted" fontWeight={500}>
            {currentChapter.label}
          </Text>
        </Text>
      )}
    </VStack>
  );
}
