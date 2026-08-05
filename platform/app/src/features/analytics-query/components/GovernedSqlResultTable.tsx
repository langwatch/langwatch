/**
 * The native result table.
 *
 * A real `<table>` — not a grid of divs — because the thing on screen *is*
 * tabular data, and a member reading it with a screen reader needs the row and
 * column relationships the element already carries. Virtualization is done with
 * spacer rows rather than absolute positioning for the same reason: the
 * document keeps one `<tr>` per visible row inside a normal `<tbody>`, so the
 * table stays a table while only a window of it exists.
 *
 * The result ceiling is 10,000 rows
 * (`DEFAULT_GOVERNED_SQL_RESULT_LIMITS.maxRows`), so the window is what keeps
 * the surface usable at the ceiling.
 *
 * `ListTable` is deliberately not reused here: it is the shared look for
 * *index pages that list resources*, and its container clips overflow, which is
 * exactly what a wide result must not do.
 *
 * @see dev/docs/best_practices/list-table.md
 * @see specs/analytics/governed-sql-workbench.feature
 */

import { Alert, Box, Table, Text, VStack } from "@chakra-ui/react";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useMemo, useState } from "react";

import type { GovernedSqlQueryResult } from "~/server/analytics/governed-sql";

import {
  duplicateGovernedSqlColumnNames,
  readGovernedSqlCell,
} from "../logic/governedSqlValueFormat";
import { GovernedSqlValueCell } from "./GovernedSqlValueCell";

type GovernedSqlRow = Record<string, unknown>;

/** Fixed row height, in pixels — what the virtualizer measures against. */
const ROW_HEIGHT = 34;

/** Rows kept either side of the window so scrolling does not flash. */
const OVERSCAN = 8;

/** How tall the scrolling viewport is before the page itself scrolls. */
const VIEWPORT_MAX_HEIGHT = "480px";

export interface GovernedSqlResultTableProps {
  result: GovernedSqlQueryResult;
}

export function GovernedSqlResultTable({ result }: GovernedSqlResultTableProps) {
  // Held in state rather than a ref so that attaching the element re-renders
  // once and the virtualizer gets a scroll element to measure. A bare ref is
  // still `null` on the render that would have set the count.
  const [scrollContainer, setScrollContainer] = useState<HTMLDivElement | null>(
    null,
  );

  const duplicates = useMemo(
    () => duplicateGovernedSqlColumnNames(result.columns),
    [result.columns],
  );

  const columns = useMemo<ColumnDef<GovernedSqlRow>[]>(
    () =>
      result.columns.map((column, index) => ({
        // Position-qualified: two columns can share a name, and react-table
        // requires distinct ids. The header still shows the name as it came.
        id: `${column.name}#${index}`,
        header: column.name,
        cell: ({ row }) => (
          <GovernedSqlValueCell
            columnName={column.name}
            cell={readGovernedSqlCell({
              row: row.original,
              column: column.name,
            })}
          />
        ),
      })),
    [result.columns],
  );

  // Keyed by column id rather than read positionally, so the type under a
  // header can never end up belonging to a different column.
  const typeByColumnId = useMemo(
    () =>
      new Map(
        result.columns.map((column, index) => [
          `${column.name}#${index}`,
          column.type,
        ]),
      ),
    [result.columns],
  );

  const data = useMemo(
    () => result.rows as GovernedSqlRow[],
    [result.rows],
  );

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const rows = table.getRowModel().rows;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollContainer,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  });

  const virtualRows = virtualizer.getVirtualItems();
  const paddingTop = virtualRows[0]?.start ?? 0;
  const paddingBottom =
    virtualRows.length > 0
      ? virtualizer.getTotalSize() - (virtualRows[virtualRows.length - 1]?.end ?? 0)
      : 0;

  return (
    <VStack align="stretch" gap={2} width="full">
      {duplicates.length > 0 && (
        <DuplicateColumnWarning names={duplicates} />
      )}

      <Box
        ref={setScrollContainer}
        data-testid="governed-sql-result-scroll"
        // Inline, like the virtualizer's own row heights below: both axes
        // scrolling *inside this box* is the behaviour that keeps a 40-column
        // result from scrolling the page sideways, so it is set where nothing
        // in the styling pipeline can fail to apply it.
        style={{ overflowX: "auto", overflowY: "auto" }}
        maxHeight={VIEWPORT_MAX_HEIGHT}
        borderWidth="1px"
        borderColor="border.emphasized"
        borderRadius="md"
        // Focusable so the rows can be reached and scrolled from the keyboard;
        // a scrollable region that is not focusable is unreachable without a
        // pointer.
        tabIndex={0}
        role="region"
        aria-label="Query result rows"
      >
        <Table.Root size="sm" variant="line" width="full">
          <Table.Header>
            <Table.Row>
              {table.getHeaderGroups()[0]?.headers.map((header) => {
                return (
                  <Table.ColumnHeader
                    key={header.id}
                    // Inline for the same reason as the scroll container: the
                    // header staying put while the rows move is behaviour the
                    // spec pins, not decoration.
                    style={{ position: "sticky", top: 0 }}
                    zIndex={1}
                    backgroundColor="bg.subtle"
                    whiteSpace="nowrap"
                  >
                    <VStack align="start" gap={0}>
                      <Text fontSize="12.5px" fontWeight="semibold">
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                      </Text>
                      {/* The database's own type, on screen rather than behind
                          a hover: it is what tells a member whether a column
                          can be charted or compared. */}
                      <Text
                        fontSize="11px"
                        color="fg.muted"
                        fontWeight="normal"
                        data-testid="governed-sql-column-type"
                      >
                        {typeByColumnId.get(header.column.id)}
                      </Text>
                    </VStack>
                  </Table.ColumnHeader>
                );
              })}
            </Table.Row>
          </Table.Header>

          <Table.Body>
            {rows.length === 0 ? (
              <Table.Row>
                <Table.Cell colSpan={Math.max(columns.length, 1)}>
                  <Text
                    fontSize="13px"
                    color="fg.muted"
                    data-testid="governed-sql-result-empty"
                  >
                    The query ran and matched no rows.
                  </Text>
                </Table.Cell>
              </Table.Row>
            ) : (
              <>
                {paddingTop > 0 && (
                  <Table.Row aria-hidden="true">
                    <Table.Cell
                      colSpan={columns.length}
                      style={{ height: `${paddingTop}px`, padding: 0 }}
                    />
                  </Table.Row>
                )}

                {virtualRows.map((virtualRow) => {
                  const row = rows[virtualRow.index];
                  if (!row) return null;
                  return (
                    <Table.Row
                      key={row.id}
                      data-index={virtualRow.index}
                      data-testid="governed-sql-result-row"
                      style={{ height: `${ROW_HEIGHT}px` }}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <Table.Cell
                          key={cell.id}
                          maxWidth="360px"
                          overflow="hidden"
                        >
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </Table.Cell>
                      ))}
                    </Table.Row>
                  );
                })}

                {paddingBottom > 0 && (
                  <Table.Row aria-hidden="true">
                    <Table.Cell
                      colSpan={columns.length}
                      style={{ height: `${paddingBottom}px`, padding: 0 }}
                    />
                  </Table.Row>
                )}
              </>
            )}
          </Table.Body>
        </Table.Root>
      </Box>
    </VStack>
  );
}

/**
 * Says out loud that a repeated column name cost the member a column.
 *
 * Rows arrive keyed by name, so the second column of a repeated name has
 * already overwritten the first. Rendering both headers with the same values
 * under them would look like the result preserved two columns when it kept one.
 */
function DuplicateColumnWarning({ names }: { names: readonly string[] }) {
  return (
    <Alert.Root status="warning" data-testid="governed-sql-duplicate-columns">
      <Alert.Indicator />
      <Alert.Content>
        <Text fontSize="12.5px">
          {names.length === 1
            ? `The result names the column ${names[0]} twice, and each row carries one value per name. Alias one of them to see both.`
            : `The result names these columns more than once: ${names.join(", ")}. Each row carries one value per name, so alias them to see every column.`}
        </Text>
      </Alert.Content>
    </Alert.Root>
  );
}
