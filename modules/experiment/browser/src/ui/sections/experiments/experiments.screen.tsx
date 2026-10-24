import { isHandledByGlobalHandler } from "@langwatch/browser-host/errors";
import { toaster } from "@langwatch/browser-host/toaster";
import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { useRouter } from "@langwatch/browser-host/use-router";
import { Banner, BannerAction } from "@langwatch/design-system/banner";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { EmptyValue } from "@langwatch/design-system/empty-value";
import { FormattedDate } from "@langwatch/design-system/formatted-date";
import { ListTable } from "@langwatch/design-system/list-table";
import { Menu } from "@langwatch/design-system/menu";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { OverflownTextWithTooltip } from "@langwatch/design-system/overflown-text";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Pagination } from "@langwatch/design-system/pagination";
import {
  Badge,
  Box,
  HStack,
  Spinner,
  Table,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { SkeletonRows } from "@langwatch/design-system/skeletons";
import type { LEGACY_EXPERIMENT_TASK_TYPES } from "@langwatch/experiment-contract";
import { nowInstant, readableDate } from "@langwatch/time";
import type { TimeInput } from "@langwatch/time";
import { SetupWithAgentButton } from "@langwatch/trace-client";
import { keepPreviousData } from "@tanstack/react-query";
import { useState } from "react";
import { Copy, MoreVertical } from "react-feather";
import {
  LuCircleCheckBig,
  LuCircleX,
  LuEye,
  LuPencil,
  LuSquareCheckBig,
  LuTrash,
} from "react-icons/lu";

import { experimentApi } from "../../../behavior/experiment-api.ts";
import { useCopyExperiment } from "../../../behavior/experiments/use-copy-experiment.ts";
import { useCreateExperiment } from "../../../behavior/experiments/use-create-experiment.ts";
import { experimentContextChip } from "../../../behavior/langy/langy-context-chips.ts";
import type { ExperimentType } from "../../../model/prisma-types.ts";
import { useWorkflowHost } from "../../../model/workflow/workflow-host.ts";
import { formatEvaluationSummary } from "../../../ui/elements/experiments/BatchEvaluationV2/batch-evaluation-summary.tsx";
import { CopyExperimentDialog } from "../../../ui/elements/experiments/copy-experiment-dialog.tsx";
import { CreateExperimentButton } from "../../../ui/elements/experiments/create-experiment-button.tsx";
import { PAGE_SIZE_OPTIONS, useNavigationFooter } from "../../../ui/elements/navigation-footer.tsx";
import { FullWidthListPageContent } from "../../../ui/elements/ui/layouts/full-width-list-page-content.tsx";
import { LangyContextTarget } from "../langy/langy-context-target.tsx";

/** One row of the experiments list, as this table renders it. */
type ExperimentListRow = {
  id: string;
  slug: string;
  name: string | null;
  type: ExperimentType;
  createdAt: TimeInput;
  updatedAt: TimeInput;
  workflowId: string | null;
  workbenchState?: { task?: keyof typeof LEGACY_EXPERIMENT_TASK_TYPES } | null;
  dataset?: { name: string } | null;
  runsSummary: {
    count: number;
    primaryMetric?: { name: string; averageScore: number | null; averagePassed?: number } | null;
    latestRun?: {
      timestamps?: {
        finishedAt?: number | null;
        stoppedAt?: number | null;
        updatedAt?: number | null;
      } | null;
    } | null;
  };
};

type ExperimentsListQuery = {
  data?: { experiments: ExperimentListRow[]; totalHits?: number };
  isFetched?: boolean;
  isLoading: boolean;
  isFetching: boolean;
  isError?: boolean;
  refetch: () => unknown;
};

function experimentsPageState(
  experiments: ExperimentsListQuery,
): "loading" | "error" | "empty" | "list" {
  if (experiments.isLoading) return "loading";
  if (experiments.isError) return "error";
  if (experiments.data?.experiments.length === 0) return "empty";
  return "list";
}

const RUNNING_WINDOW_MS = 5 * 60 * 1000;

function ExperimentRunStatus({ runsSummary }: { runsSummary: ExperimentListRow["runsSummary"] }) {
  const timestamps = runsSummary.latestRun?.timestamps;
  if (timestamps?.finishedAt) {
    return (
      <>
        <LuCircleCheckBig size={14} color="var(--chakra-colors-green-fg)" />
        <Text textStyle="bodySm">Completed</Text>
      </>
    );
  }
  if (timestamps?.stoppedAt) {
    return (
      <>
        <LuCircleX size={14} color="var(--chakra-colors-red-fg)" />
        <Text textStyle="bodySm">Stopped</Text>
      </>
    );
  }
  const updatedAt = timestamps?.updatedAt;
  if (updatedAt && nowInstant().epochMilliseconds - updatedAt < RUNNING_WINDOW_MS) {
    return (
      <>
        <Spinner size="xs" />
        <Text textStyle="bodySm">Running</Text>
      </>
    );
  }
  if (runsSummary.count > 0) {
    return (
      <>
        <LuCircleCheckBig size={14} color="var(--chakra-colors-green-fg)" />
        <Text textStyle="bodySm">Completed</Text>
      </>
    );
  }
  return <EmptyValue label="Never run" />;
}

const TASK_TYPE_LABELS: Record<keyof typeof LEGACY_EXPERIMENT_TASK_TYPES, string> = {
  real_time: "Legacy live workflow",
  llm_app: "LLM app experiment",
  prompt_creation: "Prompt experiment",
  custom_evaluator: "Evaluator experiment",
  scan: "Vulnerability scan",
};

const EXPERIMENT_TYPE_LABELS: Record<ExperimentType, string> = {
  BATCH_EVALUATION_V2: "SDK",
  BATCH_EVALUATION: "Batch experiment",
  DSPY: "DSPy optimization",
  EVALUATIONS_V3: "Workbench",
};

const workbenchPathOf = (projectSlug: string, experiment: ExperimentListRow) =>
  `/${projectSlug}/experiments/workbench/${experiment.slug}`;

const resultsPathOf = (projectSlug: string, experiment: ExperimentListRow) =>
  `/${projectSlug}/experiments/${experiment.slug}`;

/** Workbench-backed experiments (current and legacy wizard) open in the workbench. */
const opensInWorkbench = (experiment: ExperimentListRow) =>
  experiment.type === "EVALUATIONS_V3" || !!experiment.workbenchState;

/** The SDK's experiments have no workbench to edit in. */
const isEditable = (experiment: ExperimentListRow) =>
  experiment.type === "EVALUATIONS_V3" ||
  (experiment.type !== "BATCH_EVALUATION_V2" && !!experiment.workbenchState);

type ExperimentPermissions = { canEdit: boolean; canReplicate: boolean; canDelete: boolean };

const ExperimentActionsMenu = ({
  experiment,
  projectSlug,
  permissions,
  onOpen,
  onReplicate,
  onDelete,
}: {
  experiment: ExperimentListRow;
  projectSlug: string;
  permissions: ExperimentPermissions;
  onOpen: (path: string) => void;
  onReplicate: () => void;
  onDelete: () => void;
}) => (
  <Menu.Root>
    <Menu.Trigger
      aria-label={`Actions for ${experiment.name ?? experiment.slug}`}
      onClick={(e) => e.stopPropagation()}
    >
      <MoreVertical size={16} />
    </Menu.Trigger>
    <Menu.Content>
      {permissions.canEdit && isEditable(experiment) && (
        <Menu.Item
          value="edit"
          onClick={(e) => {
            e.stopPropagation();
            onOpen(workbenchPathOf(projectSlug, experiment));
          }}
        >
          <LuPencil size={16} />
          Edit
        </Menu.Item>
      )}
      <Menu.Item
        value="view-results"
        onClick={(e) => {
          e.stopPropagation();
          onOpen(resultsPathOf(projectSlug, experiment));
        }}
      >
        <LuEye size={16} />
        View results
      </Menu.Item>
      {permissions.canReplicate && (
        <Menu.Item
          value="replicate"
          onClick={(e) => {
            e.stopPropagation();
            onReplicate();
          }}
        >
          <Copy size={16} />
          Replicate to another project
        </Menu.Item>
      )}
      {permissions.canDelete && (
        <Menu.Item
          value="delete"
          color="red.fg"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <LuTrash size={16} />
          Delete
        </Menu.Item>
      )}
    </Menu.Content>
  </Menu.Root>
);

const PrimaryMetric = ({
  metric,
}: {
  metric: ExperimentListRow["runsSummary"]["primaryMetric"];
}) =>
  metric ? (
    <>
      <Text as="span" textStyle="caption" color="fg.muted">
        {metric.name}: &nbsp;
      </Text>
      <Text as="span" fontWeight="semibold">
        {formatEvaluationSummary(metric, true)}
      </Text>
    </>
  ) : (
    <EmptyValue label="No primary metric" />
  );

/**
 * One experiment, pointable by Langy with the same chip id the `/experiments/<slug>` route
 * derives, so pointing at a row and then opening it yields one chip, not two.
 */
const ExperimentRow = ({
  experiment,
  projectSlug,
  permissions,
  onOpen,
  onReplicate,
  onDelete,
}: {
  experiment: ExperimentListRow;
  projectSlug: string;
  permissions: ExperimentPermissions;
  onOpen: (path: string) => void;
  onReplicate: () => void;
  onDelete: () => void;
}) => (
  <LangyContextTarget
    target={experimentContextChip({ slug: experiment.slug, name: experiment.name })}
  >
    <Table.Row
      cursor="pointer"
      data-testid={`experiment-row-${experiment.id}`}
      onClick={() =>
        onOpen(
          opensInWorkbench(experiment)
            ? workbenchPathOf(projectSlug, experiment)
            : resultsPathOf(projectSlug, experiment),
        )
      }
    >
      <Table.Cell>
        <OverflownTextWithTooltip lineClamp={1} wordBreak="break-word">
          {experiment.name ?? experiment.slug}
        </OverflownTextWithTooltip>
      </Table.Cell>
      <Table.Cell whiteSpace="nowrap">
        <Badge colorPalette="gray" variant="outline">
          {experiment.workbenchState?.task
            ? TASK_TYPE_LABELS[experiment.workbenchState.task]
            : EXPERIMENT_TYPE_LABELS[experiment.type]}
        </Badge>
      </Table.Cell>
      <Table.Cell>
        {experiment.dataset?.name ? (
          <OverflownTextWithTooltip lineClamp={1} wordBreak="break-word">
            {experiment.dataset.name}
          </OverflownTextWithTooltip>
        ) : (
          <EmptyValue label="No dataset" />
        )}
      </Table.Cell>
      <Table.Cell>
        <PrimaryMetric metric={experiment.runsSummary.primaryMetric} />
      </Table.Cell>
      <Table.Cell>{experiment.runsSummary.count ?? <EmptyValue label="No runs" />}</Table.Cell>
      <Table.Cell>
        <HStack gap={1}>
          <ExperimentRunStatus runsSummary={experiment.runsSummary} />
        </HStack>
      </Table.Cell>
      <Table.Cell whiteSpace="nowrap">
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
);

export function ExperimentsPage() {
  const { project } = useOrganizationTeamProject();
  const workflowHost = useWorkflowHost();
  const router = useRouter();
  const [copyDialogState, setCopyDialogState] = useState<{
    open: boolean;
    experimentId: string;
    experimentName: string;
    experimentType: ExperimentType;
  } | null>(null);
  const [experimentToDelete, setExperimentToDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const navigationFooter = useNavigationFooter();
  const { createNewExperiment, isCreating } = useCreateExperiment({
    projectId: project?.id,
    projectSlug: project?.slug,
  });
  const { copyExperimentTo, isCopying } = useCopyExperiment();

  /** One page of the project's experiments; every field is one the table renders. */
  const experiments = experimentApi.experiments.getAllForEvaluationsList.useQuery(
    {
      projectId: project?.id ?? "",
      pageOffset: navigationFooter.pageOffset,
      pageSize: navigationFooter.pageSize,
    },
    {
      enabled: !!project && router.isReady,
      placeholderData: keepPreviousData,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    },
  ) as ExperimentsListQuery;

  navigationFooter.useUpdateTotalHits(experiments);

  const deleteExperimentMutation = experimentApi.experiments.deleteExperiment.useMutation({
    onSuccess: () => {
      void experiments.refetch();
      toaster.create({
        title: "Experiment deleted",
        type: "success",
      });
    },
    onError: (error) => {
      if (isHandledByGlobalHandler(error)) return;
      toaster.create({
        title: "Error deleting experiment",
        description: "Please try again. If the problem persists, contact support.",
        type: "error",
      });
    },
  });

  const handleDeleteExperiment = (experimentId: string, experimentName: string) => {
    setExperimentToDelete({ id: experimentId, name: experimentName });
  };

  if (!project) return null;

  const pageState = experimentsPageState(experiments);

  return (
    <Box width="full">
      <PageLayout.Header
        actions={<CreateExperimentButton isCreating={isCreating} onCreate={createNewExperiment} />}
      >
        <PageLayout.Heading>Experiments</PageLayout.Heading>
      </PageLayout.Header>
      <FullWidthListPageContent>
        <VStack width="full" gap={4} align="stretch">
          <Text color="fg.muted">
            Compare prompts, models and agents against a dataset, and analyse the results.
          </Text>
          {pageState === "loading" && <SkeletonRows rows={5} label="Loading experiments" />}
          {pageState === "error" && (
            <Banner
              status="error"
              placement="inline"
              title="Couldn't load experiments"
              action={
                <BannerAction onClick={() => void experiments.refetch()}>Try again</BannerAction>
              }
            >
              Check your connection and try again. If it keeps failing, contact support.
            </Banner>
          )}
          {pageState === "empty" && (
            <NoDataInfoBlock
              title="No experiments yet"
              description="Test prompts, models and agents against a dataset before shipping changes."
              icon={<LuSquareCheckBig size={24} />}
              docsHref="https://langwatch.ai/docs/evaluations/experiments/overview"
              secondaryAction={<SetupWithAgentButton surface="experiments" />}
            />
          )}
          {pageState === "list" && (
            <>
              <ListTable width="full">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader width="20%">Experiment</Table.ColumnHeader>
                    <Table.ColumnHeader width="15%">Type</Table.ColumnHeader>
                    <Table.ColumnHeader width="10%">Dataset</Table.ColumnHeader>
                    <Table.ColumnHeader width="20%">Primary metric</Table.ColumnHeader>
                    <Table.ColumnHeader width="10%">Runs</Table.ColumnHeader>
                    <Table.ColumnHeader width="10%">Status</Table.ColumnHeader>
                    <Table.ColumnHeader width="10%">Last updated</Table.ColumnHeader>
                    <ListTable.ActionHeader />
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {experiments.isFetching ? (
                    <ListTable.LoadingRows rows={3} columns={8} />
                  ) : (
                    experiments.data?.experiments.map((experiment) => (
                      <ExperimentRow
                        key={experiment.id}
                        experiment={experiment}
                        projectSlug={project.slug}
                        permissions={{
                          canEdit: workflowHost.hasPermission("workflows:create"),
                          canReplicate: workflowHost.hasPermission("evaluations:manage"),
                          canDelete: workflowHost.hasPermission("workflows:delete"),
                        }}
                        onOpen={(path) => void router.push(path)}
                        onReplicate={() =>
                          setCopyDialogState({
                            open: true,
                            experimentId: experiment.id,
                            experimentName: experiment.name ?? experiment.slug,
                            experimentType: experiment.type,
                          })
                        }
                        onDelete={() =>
                          handleDeleteExperiment(experiment.id, experiment.name ?? experiment.slug)
                        }
                      />
                    ))
                  )}
                </Table.Body>
              </ListTable>
              <Pagination
                page={Math.floor(navigationFooter.pageOffset / navigationFooter.pageSize) + 1}
                pageSize={navigationFooter.pageSize}
                totalCount={navigationFooter.totalHits}
                visibleCount={experiments.data?.experiments.length}
                unitLabel="experiments"
                pageSizeOptions={PAGE_SIZE_OPTIONS}
                isLoading={experiments.isFetching}
                onPageChange={(page) => navigationFooter.goToPage(page)}
                onPageSizeChange={navigationFooter.changePageSize}
              />
            </>
          )}
        </VStack>
      </FullWidthListPageContent>
      {copyDialogState && (
        <CopyExperimentDialog
          open={copyDialogState.open}
          onClose={() => setCopyDialogState(null)}
          experimentType={copyDialogState.experimentType}
          isCopying={isCopying}
          onCopy={({ targetProjectId, targetProjectName, copyDatasets }) => {
            void copyExperimentTo({
              experimentId: copyDialogState.experimentId,
              experimentName: copyDialogState.experimentName,
              sourceProjectId: project?.id ?? "",
              targetProjectId,
              targetProjectName,
              copyDatasets,
              onSuccess: () => setCopyDialogState(null),
            });
          }}
        />
      )}
      <ConfirmDialog
        open={!!experimentToDelete}
        onOpenChange={(isOpen) => {
          if (!isOpen) setExperimentToDelete(null);
        }}
        title="Delete experiment"
        message={`Are you sure you want to delete the experiment "${
          experimentToDelete?.name ?? ""
        }"? This will also delete the workflow, monitor, and prompts associated with it. Datasets will be kept.`}
        confirmLabel="Delete"
        tone="danger"
        loading={deleteExperimentMutation.isPending}
        onConfirm={() => {
          if (!experimentToDelete) return;
          deleteExperimentMutation.mutate(
            {
              projectId: project?.id ?? "",
              experimentId: experimentToDelete.id,
            },
            { onSettled: () => setExperimentToDelete(null) },
          );
        }}
      />
    </Box>
  );
}

export default ExperimentsPage;
