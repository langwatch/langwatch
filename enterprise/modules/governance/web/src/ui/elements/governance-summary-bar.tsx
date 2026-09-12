/**
 * The resume strip a governance page pins above its tabs.
 *
 * ONE STRIP, MANY PAGES. The inventory, the people list and the agents fleet
 * each open with the same question — how much of this is there, and how much
 * of it needs me — and each was about to answer it with its own row of
 * numbers. The section already carries the scar of that: the shared empty
 * state exists because the same requirement landed on two governance pages in
 * one round and produced two divergent components. So the shape is built once
 * here and the three pages import it.
 *
 * WHAT IT HOLDS AND WHAT IT REFUSES TO HOLD. Every figure arrives as a prop,
 * already measured and already formatted by whoever measured it. This
 * component runs no query, sums nothing and rounds nothing. That is not
 * modesty about layout code, it is the section's rule about numbers: a figure
 * the read side could not total arrives as null and is drawn as an em dash,
 * and a strip that quietly substituted a zero for that would report an
 * unmeasured organization as an empty one.
 *
 * Spec: specs/ai-governance/dashboard/governance-summary-strip.feature
 *
 * Ported from `platform/app/src/components/governance/summary/GovernanceSummaryBar.tsx`.
 */

import { Box, HStack, SimpleGrid, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";

/**
 * What a figure reads as when nothing measured it.
 *
 * An em dash, never a zero and never a spinner. Zero is a measurement and
 * would be a lie; a spinner says the page is still working when it has
 * finished and simply has no answer.
 */
export const GOVERNANCE_SUMMARY_UNMEASURED = "—";

export interface GovernanceSummaryBarItem {
  /** Stable across renders. The React key, and nothing else reads it. */
  key: string;
  /**
   * The figure, formatted by the caller. Null or undefined when the read held
   * nothing, which draws the em dash above.
   */
  value: ReactNode;
  /**
   * What the figure counts, in the reader's own words and never abbreviated:
   * "requests", not "req"; "tokens", not "tok".
   */
  label: string;
  /** One shorter line beneath the pair. Omitted rather than padded. */
  hint?: ReactNode;
}

/**
 * A row of figures on one card, evenly spread and centred.
 *
 * Even spread rather than left packing, because the strip is read as a set of
 * peers: four figures bunched at the left of a widescreen card invite the
 * reader to treat the first as the headline and the rest as footnotes, and
 * these are four answers to four different questions.
 *
 * It wraps to two columns and then to one rather than scrolling sideways. A
 * figure that has scrolled off the edge of a summary is a figure the summary
 * did not give anyone.
 */
export function GovernanceSummaryBar({
  items,
  testId,
}: {
  items: ReadonlyArray<GovernanceSummaryBarItem>;
  testId?: string;
}) {
  // No figures, no card. An empty bordered strip reads as a component that
  // failed to load rather than a page with nothing to summarize.
  if (items.length === 0) return null;

  return (
    <Box
      data-testid={testId}
      width="full"
      borderWidth="1px"
      borderColor="border.subtle"
      borderRadius="lg"
      backgroundColor="bg.panel"
      paddingX={{ base: 4, md: 6 }}
      paddingY={4}
    >
      <SimpleGrid
        width="full"
        gap={4}
        justifyItems="center"
        columns={{ base: 1, sm: 2, lg: items.length }}
      >
        {items.map((item) => (
          <VStack
            key={item.key}
            // Each figure addressable on its own, because the figure and its
            // label are separate text nodes: a test asserting "not 0 tools"
            // against the whole strip matches no single node and passes
            // whatever the tools figure says, and one asserting an em dash
            // anywhere in the strip is satisfied by a dash belonging to a
            // different pane. Both were live here. A caller that gives the
            // strip no test id gets no per-item ones either.
            data-testid={testId ? `${testId}-${item.key}` : undefined}
            gap={1}
            align="center"
            textAlign="center"
          >
            <HStack gap={2} alignItems="baseline">
              <Text
                fontSize="2xl"
                fontWeight="semibold"
                // Tabular figures, so a number that changes under the reader
                // does not shuffle its own label sideways.
                fontVariantNumeric="tabular-nums"
                lineHeight="1.1"
                color="fg"
              >
                {item.value ?? GOVERNANCE_SUMMARY_UNMEASURED}
              </Text>
              <Text fontSize="sm" fontWeight="normal" color="fg.muted">
                {item.label}
              </Text>
            </HStack>
            {item.hint ? (
              <Text fontSize="xs" color="fg.subtle">
                {item.hint}
              </Text>
            ) : null}
          </VStack>
        ))}
      </SimpleGrid>
    </Box>
  );
}
