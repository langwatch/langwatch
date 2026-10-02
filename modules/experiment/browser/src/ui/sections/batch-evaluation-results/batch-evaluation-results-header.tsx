import { Link } from "@langwatch/browser-host/link";
import type { UiHostProject } from "@langwatch/browser-host/use-organization-team-project";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { HStack, Skeleton, Spacer, Text } from "@langwatch/design-system/primitives";
import type React from "react";
import { BarChart2, Download, ExternalLink } from "react-feather";

import type { ExperimentRow } from "../../../model/experiment-api-map.ts";
import type { BatchEvaluationData } from "../batch-evaluation-results.types.ts";

type BatchEvaluationResultsHeaderProps = {
  project?: UiHostProject;
  experiment?: ExperimentRow;
  shownRunId?: string;
  data: BatchEvaluationData | null;
  charts: { available: boolean; visible: boolean; onChange: (visible: boolean) => void };
  displayControls: React.ReactNode;
  columnControls: React.ReactNode;
  onDownloadCsv: () => void;
};

const ExperimentTitle = ({
  experiment,
  shownRunId,
}: {
  experiment?: ExperimentRow;
  shownRunId?: string;
}) => (
  <HStack gap={1} minWidth={0} overflow="hidden" flexShrink={1}>
    <PageLayout.Heading whiteSpace="nowrap" flexShrink={0}>
      {experiment ? (experiment.name ?? experiment.slug) : <Skeleton width="200px" height="28px" />}
    </PageLayout.Heading>
    {experiment && shownRunId && (
      <Text
        textStyle={"xs"}
        color={"fg.muted"}
        whiteSpace="nowrap"
        overflow="hidden"
        textOverflow="ellipsis"
        flexShrink={1}
        minWidth={0}
      >
        {"// "}
        {shownRunId}
      </Text>
    )}
  </HStack>
);

const ExperimentLinks = ({
  project,
  experiment,
}: {
  project?: UiHostProject;
  experiment?: ExperimentRow;
}) => (
  <>
    {experiment?.workflowId && (
      <Link target="_blank" href={`/${project?.slug}/studio/${experiment.workflowId}`} asChild>
        <PageLayout.HeaderButton textDecoration="none">
          <ExternalLink size={16} /> Open Workflow
        </PageLayout.HeaderButton>
      </Link>
    )}
    {experiment?.type === "EVALUATIONS_V3" && (
      <Link href={`/${project?.slug}/experiments/workbench/${experiment.slug}`} asChild>
        <PageLayout.HeaderButton textDecoration="none">
          <ExternalLink size={16} /> Open Experiment
        </PageLayout.HeaderButton>
      </Link>
    )}
  </>
);

/** The results page header: the experiment's name, the run shown, and the page's actions. */
export const BatchEvaluationResultsHeader = ({
  project,
  experiment,
  shownRunId,
  data,
  charts,
  displayControls,
  columnControls,
  onDownloadCsv,
}: BatchEvaluationResultsHeaderProps) => {
  // The lite-member CSV-export guard did not travel: the host port carries
  // permissions, not organization role, so the button is offered to everyone
  // who can open the page and the server still refuses the download.
  const isLiteMember = false;
  const hasRows = !!data && data.rows.length > 0;

  return (
    <PageLayout.Header paddingX={2} withBorder={false} flexShrink={0}>
      <ExperimentTitle experiment={experiment} shownRunId={shownRunId} />
      <Spacer />
      {charts.available && (
        <PageLayout.HeaderButton
          variant={charts.visible ? "solid" : "outline"}
          onClick={() => charts.onChange(!charts.visible)}
          data-testid="toggle-charts-button"
        >
          <BarChart2 size={16} />
          Charts
        </PageLayout.HeaderButton>
      )}
      {data && data.targetColumns.length > 0 && displayControls}
      {data && data.datasetColumns.length > 0 && columnControls}
      {!isLiteMember && (
        <PageLayout.HeaderButton onClick={onDownloadCsv} disabled={!hasRows}>
          <Download size={16} /> Export to CSV
        </PageLayout.HeaderButton>
      )}
      <ExperimentLinks project={project} experiment={experiment} />
    </PageLayout.Header>
  );
};
