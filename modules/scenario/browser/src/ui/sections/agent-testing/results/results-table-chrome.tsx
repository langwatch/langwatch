/**
 * The column layout, the empty line and the truncation note every results table shares,
 * over the design system's ListTable.
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { ListTable } from "@langwatch/design-system/list-table";
import type { EmptyNext } from "@langwatch/design-system/no-data-info-block";
import { Text } from "@langwatch/design-system/primitives";
import type { ReactNode } from "react";

/**
 * One column of a results table. A column without a width shares the free width; a width
 * holds the cell padding as well as the content. `action` is the pinned row-menu column.
 */
export type ResultsColumn = {
  key: string;
  text: string;
  /** The hidden name of a column whose heading is empty. */
  label?: string;
  width?: `${number}px`;
  align?: "end";
  action?: boolean;
};

/** The table, laid out by its columns so a long name truncates rather than widening it. */
export function ResultsTable({
  columns,
  minWidth,
  testId,
  children,
}: {
  columns: ResultsColumn[];
  /** The width under which the table scrolls sideways rather than squeezing its columns. */
  minWidth?: string;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <ListTable
      tableLayout="fixed"
      minWidth={minWidth}
      containerProps={{ overflowX: "auto" }}
      data-testid={testId}
    >
      <ListTable.ColumnGroup>
        {columns.map((column) => (
          <ListTable.Column key={column.key} width={column.width} data-column={column.key} />
        ))}
      </ListTable.ColumnGroup>
      {children}
    </ListTable>
  );
}

/** The header line: one heading per column, the row-menu column named for screen readers. */
export function ResultsTableHead({
  columns,
  testId,
}: {
  columns: ResultsColumn[];
  testId?: string;
}) {
  return (
    <ListTable.Header data-testid={testId}>
      <ListTable.Row>
        {columns.map((column) =>
          column.action ? (
            <ListTable.ActionHeader key={column.key} />
          ) : (
            <ListTable.ColumnHeader key={column.key} align={column.align} label={column.label}>
              {column.text}
            </ListTable.ColumnHeader>
          ),
        )}
      </ListTable.Row>
    </ListTable.Header>
  );
}

/** Where a table with nothing in it sends the reader. */
const RESULTS_NEXT: EmptyNext = [
  {
    kind: "docs",
    label: "Read about results",
    href: "https://docs.langwatch.ai/agent-testing/results",
  },
];

/** What a table says when it has nothing to draw, and where to go from there. */
export function ResultsTableEmptyLine({
  columns,
  state,
  title,
  description,
  onClearFilters,
}: {
  columns: number;
  state: "empty" | "no-results";
  title: string;
  description?: string;
  /** Offered beside the next step when filters left the table empty. */
  onClearFilters?: () => void;
}) {
  return (
    <ListTable.EmptyRow
      columns={columns}
      state={state}
      title={title}
      description={description}
      next={RESULTS_NEXT}
      onClearFilters={onClearFilters}
    />
  );
}

/** The line under a table that has more rows than it drew. */
export function ResultsTableTruncationLine({ text, columns }: { text: string; columns: number }) {
  return (
    <ListTable.SpanRow columns={columns}>
      <Text
        textStyle="micro"
        color="fg.muted"
        paddingX={4}
        paddingY={2}
        data-testid="results-table-truncation"
      >
        {text}
      </Text>
    </ListTable.SpanRow>
  );
}
