import { Link } from "@langwatch/browser-host/link";
import { EmptyValue } from "@langwatch/design-system/empty-value";
import { FormattedDate } from "@langwatch/design-system/formatted-date";
import { ListTable } from "@langwatch/design-system/list-table";
import {
  Badge,
  HStack,
  IconButton,
  Table,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { nowInstant, readableDate } from "@langwatch/time";
import { ChevronDown, ChevronRight } from "react-feather";

import {
  useExperimentListRuns,
  useRefetchWhenStale,
} from "../../../behavior/experiments/use-experiment-list-runs.ts";
import { usePrimaryMetricChoice } from "../../../behavior/experiments/use-primary-metric-choice.ts";
import { experimentContextChip } from "../../../behavior/langy/langy-context-chips.ts";
import {
  defaultMetric,
  headlineOf,
  leadMetric,
  metricsOfRuns,
  runsAreFresh,
  runsOldestFirst,
} from "../../../model/experiments/experiment-list-metrics.ts";
import {
  datasetOfRow,
  experimentPathOf,
  experimentTypeLabel,
  runStatusOf,
  type ExperimentListRow,
} from "../../../model/experiments/experiment-list-row.ts";
import {
  ExperimentActionsMenu,
  type ExperimentPermissions,
} from "../../blocks/experiments/experiment-actions-menu.tsx";
import { ExperimentResultCell } from "../../blocks/experiments/experiment-result-cell.tsx";
import { ExperimentRunStatus } from "../../blocks/experiments/experiment-run-status.tsx";
import { LangyContextTarget } from "../langy/langy-context-target.tsx";
import { ExperimentRowDetails, LIST_COLUMN_COUNT } from "./experiment-row-details.tsx";

export { LIST_COLUMN_COUNT };

/**
 * One experiment: a summary row that opens inline. The headline comes from the list query, open
 * or closed; opening fetches the runs for the targets, the picker and the change in words.
 */
export function ExperimentListRowSection({
  experiment,
  projectId,
  projectSlug,
  permissions,
  open,
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
  onToggle: () => void;
  onOpen: (path: string) => void;
  onReplicate: () => void;
  onDelete: () => void;
}) {
  const displayName = experiment.name ?? experiment.slug;
  const hasRuns = experiment.runsSummary.count > 0;
  const runsQuery = useExperimentListRuns({
    projectId,
    experimentId: experiment.id,
    enabled: open && hasRuns,
  });
  const runs = runsOldestFirst(runsQuery.data?.runs ?? []);
  const { runsSummary } = experiment;
  const fresh = runsAreFresh({ runs, runsSummary });
  useRefetchWhenStale({
    active: open && hasRuns && !!runsQuery.data && !fresh,
    stamp: `${runsSummary.count}:${runsSummary.latestRun?.timestamps?.createdAt ?? ""}`,
    refetch: runsQuery.refetch,
  });
  const listPrimary = runsSummary.primaryMetric;
  const metrics = metricsOfRuns(runs);
  const { chosenKey, choose } = usePrimaryMetricChoice({ projectId, experimentId: experiment.id });
  const fallback = defaultMetric(metrics, listPrimary);
  const metric = leadMetric(metrics, chosenKey, listPrimary);
  const chosen = !!metric && metric.key === chosenKey;
  const dataset = datasetOfRow(experiment);
  const status = runStatusOf({ runsSummary, nowMs: nowInstant().epochMilliseconds });
  // One headline for a closed and an open row: cached runs count only while they match the list.
  const headline = headlineOf({
    runs: fresh ? runs : [],
    metric: fresh ? metric : undefined,
    listPrimary,
  });

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
          <Table.Cell width="4%">
            <IconButton
              size="xs"
              variant="ghost"
              aria-expanded={open}
              aria-label={`${open ? "Close" : "Open"} ${displayName}`}
              onClick={(e) => {
                e.stopPropagation();
                onToggle();
              }}
            >
              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </IconButton>
          </Table.Cell>
          <Table.Cell width="30%">
            <VStack align="start" gap={1}>
              <Link
                href={experimentPathOf(projectSlug, experiment)}
                fontWeight="medium"
                lineClamp={2}
                wordBreak="break-word"
                onClick={(e) => e.stopPropagation()}
              >
                {displayName}
              </Link>
              <Badge size="sm" colorPalette="gray" variant="outline">
                {experimentTypeLabel(experiment)}
              </Badge>
              {dataset && (
                <HStack gap={1} textStyle="caption" color="fg.muted" minWidth={0}>
                  <Text as="span">Dataset</Text>
                  {dataset.datasetId ? (
                    <Link
                      href={`/${projectSlug}/datasets/${dataset.datasetId}`}
                      color="fg"
                      lineClamp={1}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {dataset.name}
                    </Link>
                  ) : (
                    <Text as="span" color="fg" lineClamp={1}>
                      {dataset.name}
                    </Text>
                  )}
                  {dataset.extra > 0 && <Text as="span">+{dataset.extra} more</Text>}
                </HStack>
              )}
            </VStack>
          </Table.Cell>
          <Table.Cell width="26%">
            <ExperimentResultCell headline={headline} />
          </Table.Cell>
          <Table.Cell width="6%">
            {experiment.runsSummary.count ?? <EmptyValue label="No runs" />}
          </Table.Cell>
          <Table.Cell width="12%">
            <ExperimentRunStatus status={status} />
          </Table.Cell>
          <Table.Cell width="14%" whiteSpace="nowrap">
            <FormattedDate value={readableDate(experiment.updatedAt).getTime()} />
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
          projectId={projectId}
          hasRuns={hasRuns}
          runsQuery={runsQuery}
          runs={runs}
          picker={{ metrics, metric, fallback, chosen, onChoose: choose }}
        />
      )}
    </>
  );
}
