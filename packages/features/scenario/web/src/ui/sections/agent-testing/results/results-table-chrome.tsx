/**
 * The card, the header line and the row separators every results table is
 * drawn with.
 *
 * The four groupings show different columns, but they are one table to the
 * reader: same card, same header weight, same row rhythm. Stating that once
 * here is what stops the four drifting apart.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { Box, chakra, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";
import {
  FG_MUTED,
  ROW_HOVER_BG,
  TABLE_HEADER_BG,
} from "../../../../model/agent-testing/shared/design";

/** The card every results table sits in. */
export function ResultsTableCard({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <Box
      borderWidth="1px"
      borderColor="border"
      borderRadius="xl"
      background="bg.panel"
      overflow="hidden"
      boxShadow="0 1px 2px rgb(16 16 32 / 0.04)"
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
      background={TABLE_HEADER_BG}
      borderBottomWidth="1px"
      borderBottomColor="border"
      fontSize="10.5px"
      fontWeight="semibold"
      textTransform="uppercase"
      letterSpacing="0.025em"
      color={FG_MUTED}
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
      _hover={onClick ? { background: ROW_HOVER_BG } : undefined}
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
      fontSize="12.5px"
      color={FG_MUTED}
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
 *
 * Always drawn when a list is cut short. A page that silently shows the first
 * N of many reads as the whole set, and every total beside it reads as a total
 * of everything.
 */
export function ResultsTableTruncationLine({ text }: { text: string }) {
  return (
    <Text
      fontSize="11px"
      color={FG_MUTED}
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
