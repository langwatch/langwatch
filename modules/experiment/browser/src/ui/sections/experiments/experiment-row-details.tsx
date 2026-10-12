import { Banner, BannerAction } from "@langwatch/design-system/banner";
import { ListTable } from "@langwatch/design-system/list-table";
import { Button, Box, Flex, Text } from "@langwatch/design-system/primitives";
import { SkeletonRows } from "@langwatch/design-system/skeletons";
import type { ExperimentRun } from "@langwatch/experiment-contract";
import { explainAnyError } from "@langwatch/handled-error/presentation";
import { ChevronUp } from "lucide-react";
import { useMemo } from "react";

import { useExperimentRunItems } from "../../../behavior/experiments/use-experiment-list-runs.ts";
import {
  noMetricNote,
  type ListMetric,
} from "../../../model/experiments/experiment-list-metrics.ts";
import {
  targetResultsOf,
  type TargetResult,
} from "../../../model/experiments/experiment-list-targets.ts";
import { testedOnOf } from "../../../model/experiments/experiment-list-tested-on.ts";
import { ExperimentRunsTable } from "../../blocks/experiments/experiment-runs-table.tsx";
import { ExperimentTargetsTable } from "../../blocks/experiments/experiment-targets-table.tsx";
import { ExperimentTestedOn } from "../../blocks/experiments/experiment-tested-on.tsx";

export const LIST_COLUMN_COUNT = 8;

const NO_TARGETS: TargetResult[] = [];

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

/**
 * What an opened row shows, on one left edge: what the latest run was tested on, every target of
 * that run, and the run history. The metric it reads is the one the row leads with.
 */
export function ExperimentRowDetails({
  experimentId,
  displayName,
  datasetName,
  projectId,
  hasRuns,
  runsQuery,
  runs,
  metric,
  onClose,
}: {
  experimentId: string;
  displayName: string;
  datasetName: string | undefined;
  projectId: string;
  hasRuns: boolean;
  runsQuery: RunsQueryState;
  /** Oldest first. */
  runs: ExperimentRun[];
  metric: ListMetric | undefined;
  onClose: () => void;
}) {
  const items = useExperimentRunItems({
    projectId,
    experimentId,
    runId: runs.at(-1)?.runId,
    enabled: true,
  });
  const run = items.data;
  const targets = useMemo(() => (run ? targetResultsOf(run) : NO_TARGETS), [run]);
  const testedOn = useMemo(() => (run ? testedOnOf(run) : undefined), [run]);
  const scoredTargets = !!metric && targets.some((target) => target.evaluators[metric.evaluatorId]);

  return (
    <ListTable.SpanRow
      columns={LIST_COLUMN_COUNT}
      data-testid={`experiment-details-${experimentId}`}
    >
      <Box
        bg="bg.subtle"
        borderLeftWidth="2px"
        borderLeftColor="orange.solid"
        borderTopWidth="1px"
        borderTopColor="border.muted"
        paddingLeft="54px"
        paddingRight={4}
        paddingY={2}
        onClick={(e) => e.stopPropagation()}
      >
        {!hasRuns && (
          <Text textStyle="bodySm" color="fg.muted" paddingY={2}>
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
          <Text textStyle="bodySm" color="fg.muted" paddingY={2}>
            {noMetricNote(runs)}
          </Text>
        )}
        {items.data && metric && scoredTargets && testedOn && (
          <ExperimentTestedOn testedOn={testedOn} datasetName={datasetName} />
        )}
        {items.data && metric && scoredTargets && (
          <ExperimentTargetsTable targets={targets} metric={metric} runNumber={runs.length} />
        )}
        {items.data && metric && !scoredTargets && (
          <Text textStyle="bodySm" color="fg.muted" paddingY={2}>
            No targets scored yet.
          </Text>
        )}
        {metric && runs.length > 1 && <ExperimentRunsTable runs={runs} metric={metric} />}
        <Flex justify="flex-end" paddingBottom={1}>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Close details of ${displayName}`}
            onClick={onClose}
          >
            <ChevronUp size={14} /> Close
          </Button>
        </Flex>
      </Box>
    </ListTable.SpanRow>
  );
}
