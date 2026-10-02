/** Summary strip showing pre-formatted figures; holds no queries or sums. */

import { Box, HStack, SimpleGrid, Text, VStack } from "@langwatch/design-system/primitives";
import type { ReactNode } from "react";

/**
 * What a figure reads as when nothing measured it: an em dash, never a
 * zero (a measurement, and a lie here) and never a spinner (the page is
 * done, it just has no answer).
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
  /** A small glyph above the figure, saying what kind of thing it counts. */
  icon?: ReactNode;
}

/** Row of raised tiles, one per figure, that wraps to columns rather than scroll. */
export function GovernanceSummaryBar({
  items,
  testId,
}: {
  items: readonly GovernanceSummaryBarItem[];
  testId?: string;
}) {
  // No figures, no tiles. An empty row reads as a component that failed to
  // load rather than a page with nothing to summarize.
  if (items.length === 0) return null;

  return (
    <SimpleGrid
      data-testid={testId}
      width="full"
      gap={3}
      columns={{ base: 1, sm: 2, lg: items.length }}
    >
      {items.map((item) => (
        <VStack
          key={item.key}
          // Each figure addressable on its own: figure and label are
          // separate text nodes, so a whole-strip assertion can match the wrong tile.
          data-testid={testId ? `${testId}-${item.key}` : undefined}
          align="start"
          gap={1.5}
          minWidth={0}
          borderWidth="1px"
          borderColor="border.muted"
          borderRadius="xl"
          backgroundColor="bg.panel"
          boxShadow="sm"
          paddingX={4}
          paddingY={3}
        >
          {item.icon ? <Box color="fg.muted">{item.icon}</Box> : null}
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
            <Text fontSize="xs" color="fg.subtle" lineClamp={2}>
              {item.hint}
            </Text>
          ) : null}
        </VStack>
      ))}
    </SimpleGrid>
  );
}
