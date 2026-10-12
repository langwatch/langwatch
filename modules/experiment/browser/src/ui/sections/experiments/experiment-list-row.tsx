import { FormattedDate } from "@langwatch/design-system/formatted-date";
import { ListTable } from "@langwatch/design-system/list-table";
import { IconButton, Skeleton, Table, Text } from "@langwatch/design-system/primitives";
import type { ExperimentRun } from "@langwatch/experiment-contract";
import { nowInstant, readableDate } from "@langwatch/time";
import { useMemo, useRef } from "react";
import { ChevronDown, ChevronRight } from "react-feather";

import type { RunSlotQueue } from "../../../behavior/experiments/run-slot-queue.ts";
import {
  useExperimentListRuns,
  useRefetchWhenStale,
} from "../../../behavior/experiments/use-experiment-list-runs.ts";
import { usePrimaryMetricChoice } from "../../../behavior/experiments/use-primary-metric-choice.ts";
import { experimentContextChip } from "../../../behavior/langy/langy-context-chips.ts";
import {
  formatUsd,
  listStampOf,
  metricReason,
} from "../../../model/experiments/experiment-list-metrics.ts";
import { rowViewOf, type RowView } from "../../../model/experiments/experiment-list-row-view.ts";
import {
  datasetOfRow,
  experimentPathOf,
  experimentTypeLabel,
  lastRunStartedOf,
  shortDay,
  type ExperimentListRow,
} from "../../../model/experiments/experiment-list-row.ts";
import {
  ExperimentActionsMenu,
  type ExperimentPermissions,
} from "../../blocks/experiments/experiment-actions-menu.tsx";
import { ExperimentNameCell } from "../../blocks/experiments/experiment-name-cell.tsx";
import { ExperimentResultCell } from "../../blocks/experiments/experiment-result-cell.tsx";
import { ExperimentRunStatus } from "../../blocks/experiments/experiment-run-status.tsx";
import { ExperimentRunsCell } from "../../blocks/experiments/experiment-runs-cell.tsx";
import {
  PrimaryMetricControl,
  PrimaryMetricLabel,
} from "../../blocks/experiments/primary-metric-control.tsx";
import { LangyContextTarget } from "../langy/langy-context-target.tsx";
import { ExperimentRowDetails, LIST_COLUMN_COUNT } from "./experiment-row-details.tsx";

export { LIST_COLUMN_COUNT };

/** Even, compact rows: a little tighter than the list table's default. */
const CELL = { paddingY: 3 } as const;

const MINUTE_MS = 60_000;
const NO_RUNS: ExperimentRun[] = [];

/** The metric control once the runs name the choices; until then the list's own metric in words. */
function RowMetricControl({
  view,
  onChoose,
}: {
  view: RowView;
  onChoose: (key: string | undefined) => void;
}) {
  const metric = view.fresh ? view.metric : undefined;
  if (metric && view.metrics.length > 0) {
    return (
      <PrimaryMetricControl
        metrics={view.metrics}
        metric={metric}
        defaultKey={view.fallback?.key}
        reason={metricReason({ metric, fallback: view.fallback, chosen: view.chosen })}
        onChoose={onChoose}
      />
    );
  }
  return view.headline ? <PrimaryMetricLabel name={view.headline.metric.label} /> : null;
}

function CostCell({ cost, waiting }: { cost: number | undefined; waiting: boolean }) {
  if (cost === undefined && waiting)
    return <Skeleton height="12px" width="40px" marginLeft="auto" />;
  return (
    <Text
      textStyle="bodySm"
      color={cost === undefined ? "fg.muted" : "fg"}
      fontVariantNumeric="tabular-nums"
    >
      {formatUsd(cost)}
    </Text>
  );
}

/**
 * One experiment: a summary row that opens inline. It first draws from the list query, then the
 * row's runs (one call, a few at a time) add the metric choices, history, cost and progress.
 * Opening the row loads the latest run's items for the targets.
 */
export function ExperimentListRowSection({
  experiment,
  projectId,
  projectSlug,
  permissions,
  open,
  runSlots,
  onToggle,
  onOpen,
  onReplicate,
  onDelete,
}: {
  experiment: ExperimentListRow;
  projectId: string;
  projectSlug: string;
  permissions: ExperimentPermissions;
  open: boolean;
  runSlots: RunSlotQueue;
  onToggle: () => void;
  onOpen: (path: string) => void;
  onReplicate: () => void;
  onDelete: () => void;
}) {
  const displayName = experiment.name ?? experiment.slug;
  const { runsSummary } = experiment;
  const hasRuns = runsSummary.count > 0;
  const toggleRef = useRef<HTMLButtonElement>(null);
  const runsQuery = useExperimentListRuns({
    projectId,
    experimentId: experiment.id,
    enabled: hasRuns,
    urgent: open,
    slots: runSlots,
  });
  const { chosenKey, choose } = usePrimaryMetricChoice({ projectId, experimentId: experiment.id });
  const fetchedRuns = runsQuery.data?.runs;
  const waiting = hasRuns && !fetchedRuns && !runsQuery.isError;
  const minute = Math.floor(nowInstant().epochMilliseconds / MINUTE_MS);
  const view = useMemo(
    () =>
      rowViewOf({
        experiment,
        runs: fetchedRuns ?? NO_RUNS,
        chosenKey,
        loading: runsQuery.isFetching || waiting,
        nowMs: minute * MINUTE_MS,
      }),
    [experiment, fetchedRuns, chosenKey, runsQuery.isFetching, waiting, minute],
  );
  useRefetchWhenStale({
    active: hasRuns && !!fetchedRuns && !view.fresh,
    stamp: listStampOf(runsSummary),
    open,
    refetch: runsQuery.refetch,
    requeue: runsQuery.requeue,
  });
  const dataset = datasetOfRow(experiment);
  const startedMs = readableDate(lastRunStartedOf(experiment)).getTime();
  const close = () => {
    onToggle();
    toggleRef.current?.focus();
  };

  return (
    <>
      <LangyContextTarget
        target={experimentContextChip({ slug: experiment.slug, name: experiment.name })}
      >
        <Table.Row
          cursor="pointer"
          data-testid={`experiment-row-${experiment.id}`}
          onClick={onToggle}
        >
          <Table.Cell width="48px" {...CELL}>
            <IconButton
              ref={toggleRef}
              size="xs"
              variant="ghost"
              aria-expanded={open}
              aria-label={`Details of ${displayName}`}
              onClick={(e) => {
                e.stopPropagation();
                onToggle();
              }}
            >
              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </IconButton>
          </Table.Cell>
          <Table.Cell width="25%" {...CELL}>
            <ExperimentNameCell
              name={displayName}
              href={experimentPathOf(projectSlug, experiment)}
              kind={experimentTypeLabel(experiment)}
              dataset={dataset}
              datasetHref={
                dataset?.datasetId ? `/${projectSlug}/datasets/${dataset.datasetId}` : undefined
              }
            />
          </Table.Cell>
          <Table.Cell width="29%" {...CELL}>
            <ExperimentResultCell
              headline={view.headline}
              control={<RowMetricControl view={view} onChoose={choose} />}
              change={view.change}
              targets={view.targets}
              sparkline={view.sparkline}
              state={view.state}
            />
          </Table.Cell>
          <Table.Cell width="10%" {...CELL}>
            <ExperimentRunsCell
              runs={runsSummary.count}
              items={view.items}
              targets={view.targetCount}
            />
          </Table.Cell>
          <Table.Cell width="9%" textAlign="end" {...CELL}>
            <CostCell cost={view.cost} waiting={view.state === "loading"} />
          </Table.Cell>
          <Table.Cell width="12%" {...CELL}>
            <ExperimentRunStatus status={view.status} progress={view.progress} />
          </Table.Cell>
          <Table.Cell width="10%" whiteSpace="nowrap" {...CELL}>
            <FormattedDate value={startedMs}>
              {shortDay({ epochMs: startedMs, nowMs: nowInstant().epochMilliseconds })}
            </FormattedDate>
          </Table.Cell>
          <ListTable.ActionCell>
            <ExperimentActionsMenu
              experiment={experiment}
              projectSlug={projectSlug}
              permissions={permissions}
              onOpen={onOpen}
              onReplicate={onReplicate}
              onDelete={onDelete}
            />
          </ListTable.ActionCell>
        </Table.Row>
      </LangyContextTarget>
      {open && (
        <ExperimentRowDetails
          experimentId={experiment.id}
          displayName={displayName}
          datasetName={dataset?.name}
          projectId={projectId}
          hasRuns={hasRuns}
          runsQuery={runsQuery}
          runs={view.runs}
          metric={view.metric}
          onClose={close}
        />
      )}
    </>
  );
}
