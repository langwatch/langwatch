/**
 * One query's last run, rendered as a result table or an error — the same
 * `QueryLastRun` shape whether it came from the live chart's `LW.query` or
 * the Queries tab's own standalone Run button (`usePlaygroundWidgetExecutor`).
 */

import { Box, HStack, Table, Text } from "@chakra-ui/react";

import { formatNumber } from "~/utils/formatNumber";

import type { QueryLastRun } from "./usePlaygroundWidgetExecutor";

/** How many result rows the preview table shows — this is a query tester, not a data grid. */
const MAX_PREVIEW_ROWS = 20;

function elapsedMsOf(run: QueryLastRun): number | undefined {
  const value = run.result?.statistics.elapsedMs;
  return typeof value === "number" ? value : undefined;
}

/**
 * Same "Partial result" convention as the workbench's own
 * `LangWatchQLResultPane.tsx` — truncation is the one diagnostic that says
 * the answer might be wrong by omission, so it gets a banner, not a suffix
 * folded into the row-count line.
 */
function TruncationBanner() {
  return (
    <HStack
      gap={2}
      align="flex-start"
      role="status"
      background="orange.subtle"
      borderWidth="1px"
      borderColor="border"
      borderRadius="md"
      paddingX={2}
      paddingY={1}
      marginBottom={1}
    >
      <Text fontSize="11px" fontWeight="700" color="orange.fg" flexShrink={0}>
        Partial result
      </Text>
      <Text fontSize="11px" color="fg.muted">
        The rest did not fit — aggregate or narrow the query to see it.
      </Text>
    </HStack>
  );
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
      {result.truncated && <TruncationBanner />}
      <Text fontSize="11px" color="fg.muted" marginBottom={1}>
        {formatNumber(result.rows.length)} row
        {result.rows.length === 1 ? "" : "s"}
        {elapsedMs !== undefined ? ` · ${elapsedMs}ms` : ""}
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
