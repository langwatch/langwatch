/**
 * A query's last run, rendered as a result table or an error — the same
 * `QueryLastRun` shape whether it came from the live chart's `LW.query` or
 * the Queries tab's own standalone Run button (`useDashboardWidgetExecutor`).
 */

import { Banner } from "@langwatch/design-system/banner";
import { Card } from "@langwatch/design-system/card";
import { ListTable } from "@langwatch/design-system/list-table";
import { Box, Text } from "@langwatch/design-system/primitives";

import { formatNumber } from "../../../../model/format.ts";
import type { QueryLastRun } from "../../behavior/use-dashboard-widget-executor.ts";

/** How many result rows the preview table shows — this is a query tester, not a data grid. */
const MAX_PREVIEW_ROWS = 20;

function elapsedMsOf(run: QueryLastRun): number | undefined {
  const value = run.result?.statistics.elapsedMs;
  return typeof value === "number" ? value : undefined;
}

interface DashboardWidgetQueryResultViewProps {
  run: QueryLastRun | undefined;
}

export function DashboardWidgetQueryResultView({ run }: DashboardWidgetQueryResultViewProps) {
  if (!run) {
    return (
      <Text textStyle="caption" color="fg.muted">
        Not run yet.
      </Text>
    );
  }

  if (run.error) {
    return (
      <Banner status="error" placement="inline" title={run.error.title}>
        [{run.error.code}]: {run.error.message}
      </Banner>
    );
  }

  const result = run.result;
  if (!result) return null;

  const elapsedMs = elapsedMsOf(run);
  const shown = result.rows.slice(0, MAX_PREVIEW_ROWS);

  return (
    <Box>
      <Text textStyle="micro" color="fg.muted" marginBottom={1}>
        {formatNumber(result.rows.length)} row
        {result.rows.length === 1 ? "" : "s"}
        {elapsedMs !== undefined ? ` · ${elapsedMs}ms` : ""}
        {result.rows.length > MAX_PREVIEW_ROWS
          ? ` · showing ${shown.length} of ${formatNumber(result.rows.length)}`
          : ""}
      </Text>
      <Card variant="frame" padding="none">
        <Box
          maxHeight="200px"
          overflow="auto"
          as="section"
          aria-label="Query result rows"
          tabIndex={0}
        >
          <ListTable variant="embedded" density="compact" scroll="external" stickyHeader>
            <ListTable.Header>
              <ListTable.Row>
                {result.columns.map((column) => (
                  <ListTable.ColumnHeader key={column.name}>{column.name}</ListTable.ColumnHeader>
                ))}
              </ListTable.Row>
            </ListTable.Header>
            <ListTable.Body>
              {shown.map((row, rowIndex) => (
                // result rows carry no id of their own; the list is never reordered
                <ListTable.Row key={rowIndex}>
                  {result.columns.map((column) => (
                    <ListTable.Cell key={column.name}>
                      <Text textStyle="micro">{String(row[column.name])}</Text>
                    </ListTable.Cell>
                  ))}
                </ListTable.Row>
              ))}
            </ListTable.Body>
          </ListTable>
        </Box>
      </Card>
    </Box>
  );
}
