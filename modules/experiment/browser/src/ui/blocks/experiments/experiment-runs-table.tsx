import { EmptyValue } from "@langwatch/design-system/empty-value";
import { FormattedDate } from "@langwatch/design-system/formatted-date";
import { formatCost } from "@langwatch/design-system/metric-value-formatters";
import { Box, Table, Text } from "@langwatch/design-system/primitives";
import type { ExperimentRun } from "@langwatch/experiment-contract";
import { readableDate } from "@langwatch/time";

import {
  changeOfRun,
  describeChange,
  formatMetricValue,
  pooledValue,
  runCost,
  type ListMetric,
} from "../../../model/experiments/experiment-list-metrics.ts";
import { ChangeChip } from "./change-chip.tsx";

const RUNS_SHOWN = 8;

/** Every run, newest first: when it started, the metric over all targets, the change, the cost. */
export function ExperimentRunsTable({
  runs,
  metric,
}: {
  /** Oldest first, so the index is the run number. */
  runs: ExperimentRun[];
  metric: ListMetric;
}) {
  const shown = runs
    .map((run, index) => ({ run, index }))
    .reverse()
    .slice(0, RUNS_SHOWN);
  return (
    <Box paddingY={2}>
      <Text textStyle="label">
        Every run
        <Text as="span" fontWeight="normal" color="fg.muted">
          {" · "}all targets of each run together, against the run before that has a value
        </Text>
      </Text>
      <Table.Root size="sm" variant="line" marginTop={2}>
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader width="8%">Run</Table.ColumnHeader>
            <Table.ColumnHeader width="22%">Started</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">{metric.label}</Table.ColumnHeader>
            <Table.ColumnHeader>Change</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">Cost</Table.ColumnHeader>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {shown.map(({ run, index }) => {
            const value = pooledValue(run, metric);
            const change = changeOfRun({ runs, index, metric });
            return (
              <Table.Row key={run.runId}>
                <Table.Cell color="fg.muted">#{index + 1}</Table.Cell>
                <Table.Cell whiteSpace="nowrap">
                  <FormattedDate value={readableDate(run.timestamps.createdAt).getTime()} />
                </Table.Cell>
                <Table.Cell textAlign="end">
                  {value === undefined ? (
                    <EmptyValue label="No value" />
                  ) : (
                    formatMetricValue(metric, value)
                  )}
                </Table.Cell>
                <Table.Cell>
                  {change ? (
                    <ChangeChip
                      change={describeChange({
                        delta: change.delta,
                        kind: metric.kind,
                        against: change.againstRunNumber,
                      })}
                    />
                  ) : null}
                </Table.Cell>
                <Table.Cell textAlign="end">{formatCost(runCost(run) ?? null)}</Table.Cell>
              </Table.Row>
            );
          })}
        </Table.Body>
      </Table.Root>
      {runs.length > RUNS_SHOWN && (
        <Text textStyle="caption" color="fg.muted" marginTop={1}>
          Showing {RUNS_SHOWN} of {runs.length} runs; the experiment page has all of them.
        </Text>
      )}
    </Box>
  );
}
