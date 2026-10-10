/**
 * The card, the header line and the row separators every results table is drawn with.
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { Box, chakra, Text } from "@langwatch/design-system/primitives";
import type { ReactNode } from "react";

/** The card every results table sits in. */
export function ResultsTableCard({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <Box
      borderWidth="1px"
      borderColor="border"
      borderRadius="xl"
      background="bg.panel"
      overflow="hidden"
      boxShadow="0 1px 2px color-mix(in srgb, var(--chakra-colors-bg-scrim) 4%, transparent)"
      data-testid={testId}
    >
      {children}
    </Box>
  );
}

/** The uppercase header line of a table, laid out on the given columns. */
export function ResultsTableHead({
  columns,
  headings,
}: {
  columns: string;
  /** One entry per column. An empty string draws a column with no heading. */
  headings: { key: string; text: string; align?: "right" }[];
}) {
  return (
    <Box
      display="grid"
      gridTemplateColumns={columns}
      columnGap={3}
      alignItems="center"
      paddingX={4}
      paddingY={2}
      background="bg.muted/50"
      borderBottomWidth="1px"
      borderBottomColor="border"
      textStyle="micro"
      fontWeight="semibold"
      textTransform="uppercase"
      letterSpacing="0.025em"
      color="fg.muted"
    >
      {headings.map((heading) => (
        <Text key={heading.key} as="span" textAlign={heading.align}>
          {heading.text}
        </Text>
      ))}
    </Box>
  );
}

/** The rows of a table, hairlined between one another. */
export function ResultsTableBody({ children }: { children: ReactNode }) {
  return (
    <chakra.div
      css={{
        "& > * + *": {
          borderTopWidth: "1px",
          borderTopColor: "var(--chakra-colors-border-muted)",
        },
      }}
    >
      {children}
    </chakra.div>
  );
}

/** One row: the grid, the padding and the hover every table shares. */
export function ResultsTableRow({
  columns,
  onClick,
  testId,
  paddingY = "10px",
  children,
}: {
  columns: string;
  onClick?: () => void;
  testId?: string;
  paddingY?: string;
  children: ReactNode;
}) {
  return (
    <Box
      display="grid"
      gridTemplateColumns={columns}
      columnGap={3}
      alignItems="center"
      paddingX={4}
      paddingY={paddingY}
      cursor={onClick ? "pointer" : undefined}
      _hover={onClick ? { background: "bg.muted/40" } : undefined}
      onClick={onClick}
      data-testid={testId}
    >
      {children}
    </Box>
  );
}

/** What a table says when the filters leave it nothing. */
export function ResultsTableEmptyLine({ text }: { text: string }) {
  return (
    <Text
      textStyle="bodySm"
      color="fg.muted"
      textAlign="center"
      paddingX={4}
      paddingY={10}
      data-testid="results-table-empty"
    >
      {text}
    </Text>
  );
}

/**
 * The line under a table that has more rows than it drew.
 */
export function ResultsTableTruncationLine({ text }: { text: string }) {
  return (
    <Text
      textStyle="micro"
      color="fg.muted"
      borderTopWidth="1px"
      borderTopColor="border"
      paddingX={4}
      paddingY={2}
      data-testid="results-table-truncation"
    >
      {text}
    </Text>
  );
}
