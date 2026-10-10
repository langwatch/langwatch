import { Banner, BannerAction } from "@langwatch/design-system/banner";
import { HStack, Table, Text } from "@langwatch/design-system/primitives";
import { SkeletonRows } from "@langwatch/design-system/skeletons";
import type { ExperimentRun } from "@langwatch/experiment-contract";
import { explainAnyError } from "@langwatch/handled-error/presentation";

import { useExperimentRunItems } from "../../../behavior/experiments/use-experiment-list-runs.ts";
import {
  describeChange,
  metricReason,
  noMetricNote,
  summarizeResult,
  type ListMetric,
} from "../../../model/experiments/experiment-list-metrics.ts";
import { targetResultsOf } from "../../../model/experiments/experiment-list-targets.ts";
import { ChangeChip } from "../../blocks/experiments/change-chip.tsx";
import { ExperimentRunsTable } from "../../blocks/experiments/experiment-runs-table.tsx";
import { ExperimentTargetsTable } from "../../blocks/experiments/experiment-targets-table.tsx";
import { PrimaryMetricMenu } from "../../blocks/experiments/primary-metric-menu.tsx";

export const LIST_COLUMN_COUNT = 7;

type RunsQueryState = {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  data: unknown;
  refetch: () => unknown;
};

function LoadErrorBanner({
  error,
  title,
  onRetry,
}: {
  error: unknown;
  title: string;
  onRetry: () => void;
}) {
  return (
    <Banner
      status="error"
      placement="inline"
      title={title}
      action={<BannerAction onClick={onRetry}>Try again</BannerAction>}
    >
      {explainAnyError(error).description}
    </Banner>
  );
}

/** What an opened row shows: the metric picker, the latest run's targets and the run history. */
export function ExperimentRowDetails({
  experimentId,
  projectId,
  hasRuns,
  runsQuery,
  runs,
  picker,
}: {
  experimentId: string;
  projectId: string;
  hasRuns: boolean;
  runsQuery: RunsQueryState;
  /** Oldest first. */
  runs: ExperimentRun[];
  picker: {
    metrics: ListMetric[];
    metric: ListMetric | undefined;
    fallback: ListMetric | undefined;
    chosen: boolean;
    onChoose: (key: string | undefined) => void;
  };
}) {
  const { metrics, metric, fallback, chosen, onChoose } = picker;
  const items = useExperimentRunItems({
    projectId,
    experimentId,
    runId: runs.at(-1)?.runId,
    enabled: true,
  });
  const targets = items.data ? targetResultsOf(items.data) : [];
  const change = metric ? summarizeResult({ runs, metric })?.change : undefined;
  const scoredTargets = !!metric && targets.some((target) => target.evaluators[metric.evaluatorId]);

  return (
    <Table.Row data-testid={`experiment-details-${experimentId}`} bg="bg.subtle">
      <Table.Cell colSpan={LIST_COLUMN_COUNT} paddingLeft={12}>
        {!hasRuns && (
          <Text textStyle="bodySm" color="fg.muted">
            No runs yet.
          </Text>
        )}
        {(runsQuery.isLoading || items.isLoading) && (
          <SkeletonRows rows={2} label="Loading targets" />
        )}
        {runsQuery.isError && (
          <LoadErrorBanner
            error={runsQuery.error}
            title="Couldn't load the runs of this experiment"
            onRetry={() => void runsQuery.refetch()}
          />
        )}
        {!runsQuery.isError && items.isError && (
          <LoadErrorBanner
            error={items.error}
            title="Couldn't load the results of this run"
            onRetry={() => void items.refetch()}
          />
        )}
        {!!runsQuery.data && !metric && (
          <Text textStyle="bodySm" color="fg.muted">
            {noMetricNote(runs)}
          </Text>
        )}
        {metric && (
          <HStack gap={3} wrap="wrap">
            <PrimaryMetricMenu
              metrics={metrics}
              metric={metric}
              defaultKey={fallback?.key}
              reason={metricReason({ metric, fallback, chosen })}
              onChoose={onChoose}
            />
            {change && (
              <ChangeChip
                change={describeChange({
                  delta: change.delta,
                  kind: metric.kind,
                  against: change.againstRunNumber,
                })}
              />
            )}
          </HStack>
        )}
        {items.data && metric && scoredTargets && (
          <ExperimentTargetsTable targets={targets} metric={metric} runNumber={runs.length} />
        )}
        {items.data && metric && !scoredTargets && (
          <Text textStyle="bodySm" color="fg.muted">
            No targets scored yet.
          </Text>
        )}
        {metric && runs.length > 1 && <ExperimentRunsTable runs={runs} metric={metric} />}
      </Table.Cell>
    </Table.Row>
  );
}
