/**
 * The column layout, the empty line and the truncation note every results table shares,
 * over the design system's ListTable.
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { ListTable } from "@langwatch/design-system/list-table";
import { Table, Text } from "@langwatch/design-system/primitives";
import type { ReactNode } from "react";

/**
 * One column of a results table. A column without a width shares the free width; a width
 * holds the cell padding as well as the content. `action` is the pinned row-menu column.
 */
export type ResultsColumn = {
  key: string;
  text: string;
  width?: string;
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
      <Table.ColumnGroup>
        {columns.map((column) => (
          <Table.Column key={column.key} width={column.width} data-column={column.key} />
        ))}
      </Table.ColumnGroup>
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
    <Table.Header data-testid={testId}>
      <Table.Row>
        {columns.map((column) =>
          column.action ? (
            <ListTable.ActionHeader key={column.key} />
          ) : (
            <Table.ColumnHeader key={column.key} textAlign={column.align}>
              {column.text}
            </Table.ColumnHeader>
          ),
        )}
      </Table.Row>
    </Table.Header>
  );
}

/** What a table says when the filters leave it nothing. */
export function ResultsTableEmptyLine({ text, columns }: { text: string; columns: number }) {
  return (
    <ListTable.SpanRow columns={columns}>
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
    </ListTable.SpanRow>
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
