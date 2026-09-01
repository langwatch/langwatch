/**
 * One query's last run, rendered as a result table or an error — the same
 * `QueryLastRun` shape whether it came from the live chart's `LW.query` or
 * the Queries tab's own standalone Run button (`usePlaygroundWidgetExecutor`).
 */

import { Box, Table, Text } from "@chakra-ui/react";

import type { QueryLastRun } from "./usePlaygroundWidgetExecutor";

/** How many result rows the preview table shows — this is a query tester, not a data grid. */
const MAX_PREVIEW_ROWS = 20;

function elapsedMsOf(run: QueryLastRun): number | undefined {
  const value = run.result?.statistics.elapsedMs;
  return typeof value === "number" ? value : undefined;
}

interface PlaygroundQueryResultViewProps {
  run: QueryLastRun | undefined;
}

export function PlaygroundQueryResultView({
  run,
}: PlaygroundQueryResultViewProps) {
  if (!run) {
    return (
      <Text fontSize="12px" color="fg.muted">
        Not run yet.
      </Text>
    );
  }

  if (run.error) {
    return (
      <Box
        fontSize="12px"
        color="red.500"
        borderWidth="1px"
        borderColor="red.subtle"
        borderRadius="md"
        padding={2}
      >
        {run.error.title} [{run.error.code}]: {run.error.message}
      </Box>
    );
  }

  const result = run.result;
  if (!result) return null;

  const elapsedMs = elapsedMsOf(run);
  const shown = result.rows.slice(0, MAX_PREVIEW_ROWS);

  return (
    <Box>
      <Text fontSize="11px" color="fg.muted" marginBottom={1}>
        {result.rows.length} row{result.rows.length === 1 ? "" : "s"}
        {elapsedMs !== undefined ? ` · ${elapsedMs}ms` : ""}
        {result.truncated ? " · truncated" : ""}
        {result.rows.length > MAX_PREVIEW_ROWS
          ? ` · showing first ${MAX_PREVIEW_ROWS}`
          : ""}
      </Text>
      <Box
        maxHeight="200px"
        overflow="auto"
        borderWidth="1px"
        borderColor="border"
        borderRadius="md"
      >
        <Table.Root size="sm">
          <Table.Header>
            <Table.Row>
              {result.columns.map((column) => (
                <Table.ColumnHeader key={column.name} fontSize="11px">
                  {column.name}
                </Table.ColumnHeader>
              ))}
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {shown.map((row, rowIndex) => (
              // result rows carry no id of their own; the list is never reordered
              <Table.Row key={rowIndex}>
                {result.columns.map((column) => (
                  <Table.Cell key={column.name} fontSize="11px">
                    {String(row[column.name])}
                  </Table.Cell>
                ))}
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </Box>
    </Box>
  );
}
