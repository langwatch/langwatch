import { EmptyValue } from "@langwatch/design-system/empty-value";
import { FormattedDate } from "@langwatch/design-system/formatted-date";
import { Box, Table, Text } from "@langwatch/design-system/primitives";
import type { ExperimentRun } from "@langwatch/experiment-contract";
import { nowInstant, readableDate } from "@langwatch/time";

import {
  changeOfRun,
  describeChange,
  formatMetricValue,
  formatUsd,
  metricNoun,
  pooledValue,
  runCost,
  type ListMetric,
} from "../../../model/experiments/experiment-list-metrics.ts";
import { RUN_STATUS_LABELS, runStatusOf } from "../../../model/experiments/experiment-list-row.ts";
import { ChangeChip } from "./change-chip.tsx";
import { PanelTable } from "./panel-table.tsx";

const RUNS_SHOWN = 8;

const labelOf = (run: ExperimentRun) =>
  run.workflowVersion
    ? `v${run.workflowVersion.version} · ${run.workflowVersion.commitMessage}`
    : run.runId;

/** Every run, newest first: start, the metric over all targets, the change, cost and state. */
export function ExperimentRunsTable({
  runs,
  metric,
}: {
  /** Oldest first, so the index is the run number. */
  runs: ExperimentRun[];
  metric: ListMetric;
}) {
  const nowMs = nowInstant().epochMilliseconds;
  const shown = runs
    .map((run, index) => ({ run, index }))
    .reverse()
    .slice(0, RUNS_SHOWN);
  return (
    <Box paddingY={2}>
      <Text textStyle="bodySm">
        <Text as="span" fontWeight="medium">
          Every run, newest first
        </Text>
        <Text as="span" color="fg.muted">
          {" · "}
          {metricNoun(metric)}, all targets of each run
        </Text>
      </Text>
      <PanelTable marginTop={1}>
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader width="6%">Run</Table.ColumnHeader>
            <Table.ColumnHeader width="16%">Started</Table.ColumnHeader>
            <Table.ColumnHeader width="22%">Version</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">{metric.label}</Table.ColumnHeader>
            <Table.ColumnHeader>vs the run before</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">Cost</Table.ColumnHeader>
            <Table.ColumnHeader>Status</Table.ColumnHeader>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {shown.map(({ run, index }) => {
            const value = pooledValue(run, metric);
            const change = changeOfRun({ runs, index, metric });
            const status = runStatusOf({
              runsSummary: { count: 1, latestRun: { timestamps: run.timestamps } },
              nowMs,
            });
            return (
              <Table.Row key={run.runId}>
                <Table.Cell color="fg.muted" fontVariantNumeric="tabular-nums">
                  #{index + 1}
                </Table.Cell>
                <Table.Cell whiteSpace="nowrap" color="fg.muted">
                  <FormattedDate value={readableDate(run.timestamps.createdAt).getTime()} />
                </Table.Cell>
                <Table.Cell color="fg.muted" maxWidth="0">
                  <Text lineClamp={1} fontFamily="mono" fontSize="xs" title={labelOf(run)}>
                    {labelOf(run)}
                  </Text>
                </Table.Cell>
                <Table.Cell textAlign="end" fontWeight="medium" fontVariantNumeric="tabular-nums">
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
                  ) : (
                    <Text color="fg.muted">
                      {index === 0 ? "first run" : `no ${metric.label} score`}
                    </Text>
                  )}
                </Table.Cell>
                <Table.Cell textAlign="end" color="fg.muted" fontVariantNumeric="tabular-nums">
                  {formatUsd(runCost(run) ?? null)}
                </Table.Cell>
                <Table.Cell color="fg.muted">
                  {status === "none" ? "" : RUN_STATUS_LABELS[status]}
                </Table.Cell>
              </Table.Row>
            );
          })}
        </Table.Body>
      </PanelTable>
      {runs.length > RUNS_SHOWN && (
        <Text textStyle="caption" color="fg.muted" marginTop={1}>
          Showing {RUNS_SHOWN} of {runs.length} runs; the experiment page has all of them.
        </Text>
      )}
    </Box>
  );
}
