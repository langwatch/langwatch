import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import type { PropsWithChildren, ReactNode } from "react";

import { DOT } from "~/features/asaplangy/tokens";

import { GOVERNANCE_SUMMARY_UNMEASURED } from "./GovernanceSummaryBar";

/**
 * The other resume shape: several small cards rather than one strip.
 *
 * A strip is for figures that are peers — four counts of four different
 * things, each one line long. Cards are for a summary whose parts have
 * different shapes: a headline count with a trend under it, a short list of
 * statuses, a ranking. Both answer "what is in here", so both live in this
 * directory, and a page picks the one that fits what it has to say rather than
 * inventing a third.
 *
 * Composable on purpose. The row takes cards, a card takes anything, and the
 * two list rows below are supplied because every caller was otherwise going to
 * hand-roll a coloured dot and a right-aligned percentage. Nothing here
 * queries, totals or knows what a figure means.
 *
 * Spec: specs/ai-governance/dashboard/governance-summary-strip.feature
 */

/** How loudly a status reads, which is a property of the status and not the page. */
export type GovernanceSummaryTone = "good" | "attention" | "bad" | "neutral";

/**
 * The dot's colour.
 *
 * Three of the four come from the section's own status palette rather than
 * being chosen again here. "Neutral" is the one this file adds, for a status
 * that is neither healthy nor a problem — idle is the standing example — and
 * it is deliberately the quietest thing on the card.
 */
const TONE_DOT: Record<GovernanceSummaryTone, string> = {
  good: DOT.good,
  attention: DOT.attention,
  bad: DOT.bad,
  neutral: "fg.subtle",
};

/**
 * A row of small cards that wraps.
 *
 * Each card grows equally and none falls below a readable width, so three
 * cards fill a wide screen and four become two-and-two on a narrow one without
 * the row being told how many it holds.
 */
export function GovernanceSummaryCards({
  children,
  testId,
}: PropsWithChildren<{ testId?: string }>) {
  return (
    <HStack
      data-testid={testId}
      width="full"
      gap={3}
      align="stretch"
      wrap="wrap"
    >
      {children}
    </HStack>
  );
}

/**
 * One card, named by an eyebrow.
 *
 * The eyebrow is the card's only fixed piece. It is set in the section's
 * uppercase chrome voice because it names a region rather than saying
 * anything, and everything that says something sits beneath it at full
 * strength.
 */
export function GovernanceSummaryCard({
  eyebrow,
  children,
  testId,
}: PropsWithChildren<{
  /** Two or three words naming what the card holds. Never abbreviated. */
  eyebrow: string;
  testId?: string;
}>) {
  return (
    <Box
      data-testid={testId}
      // Grows with its siblings, never narrower than a readable card.
      flex="1 1 220px"
      minWidth="200px"
      borderWidth="1px"
      borderColor="border.subtle"
      borderRadius="lg"
      backgroundColor="bg.panel"
      padding={4}
    >
      <VStack align="stretch" gap={2}>
        <Text
          fontSize="10.5px"
          letterSpacing="0.1em"
          textTransform="uppercase"
          color="fg.subtle"
        >
          {eyebrow}
        </Text>
        {children}
      </VStack>
    </Box>
  );
}

/**
 * One line of a card's status list: a dot, a count, and what those items are
 * doing.
 *
 * The dot repeats what the words already say rather than replacing them. A
 * list that reported health in colour alone would report nothing at all to a
 * reader who cannot separate the two, so the dot is marked decorative and the
 * sentence carries the meaning.
 */
export function GovernanceSummaryStatusRow({
  tone,
  value,
  label,
}: {
  tone: GovernanceSummaryTone;
  /** The count, formatted by the caller. Null draws the em dash. */
  value: ReactNode;
  /** What those items are doing: "responding", "idle", "erroring". */
  label: string;
}) {
  return (
    <HStack gap={2} align="center">
      <Box
        aria-hidden="true"
        width="7px"
        height="7px"
        borderRadius="full"
        backgroundColor={TONE_DOT[tone]}
        flexShrink={0}
      />
      <Text fontSize="sm" fontVariantNumeric="tabular-nums" color="fg">
        {value ?? GOVERNANCE_SUMMARY_UNMEASURED}
      </Text>
      <Text fontSize="sm" color="fg.muted">
        {label}
      </Text>
    </HStack>
  );
}

/**
 * One line of a ranking: a name on the left, its share on the right.
 *
 * The share is right-aligned and tabular so a column of them can be compared
 * down the edge, which is the only reason to rank things in the first place.
 * The name truncates rather than wrapping, because a two-line name would break
 * the alignment the ranking is read by.
 */
export function GovernanceSummaryRankRow({
  label,
  value,
}: {
  label: string;
  /** The share, formatted by the caller. Null draws the em dash. */
  value: ReactNode;
}) {
  return (
    <HStack gap={3} justify="space-between" align="baseline" width="full">
      <Text fontSize="sm" color="fg" truncate>
        {label}
      </Text>
      <Text
        fontSize="sm"
        color="fg.muted"
        fontVariantNumeric="tabular-nums"
        flexShrink={0}
      >
        {value ?? GOVERNANCE_SUMMARY_UNMEASURED}
      </Text>
    </HStack>
  );
}
