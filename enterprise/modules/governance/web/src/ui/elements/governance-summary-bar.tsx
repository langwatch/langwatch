/** Summary strip showing pre-formatted figures; holds no queries or sums. */

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

/** Row of evenly-spread figures that wraps to columns, not scroll. */
export function GovernanceSummaryBar({
  items,
  testId,
}: {
  items: readonly GovernanceSummaryBarItem[];
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
