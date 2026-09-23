import {
  Badge,
  Box,
  HStack,
  Skeleton,
  Spacer,
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { isHandledByGlobalHandler } from "@langwatch/browser-host/errors";
import { Link } from "@langwatch/browser-host/link";
import { toaster } from "@langwatch/browser-host/toaster";
import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { useRouter } from "@langwatch/browser-host/use-router";
import { api } from "@langwatch/browser-trpc/workflow-api";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { ListTable } from "@langwatch/design-system/list-table";
import { Menu } from "@langwatch/design-system/menu";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { OverflownTextWithTooltip } from "@langwatch/design-system/overflown-text";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { readableDate } from "@langwatch/experiment-browser-kit";
import type { LEGACY_EXPERIMENT_TASK_TYPES } from "@langwatch/experiment-contract";
import { LangyContextTarget, experimentContextChip } from "@langwatch/langy-browser-kit";
import { nowInstant } from "@langwatch/time";
import type { TimeInput } from "@langwatch/time";
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

import { useCopyExperiment } from "../../../behavior/experiments/use-copy-experiment.ts";
import { useCreateExperiment } from "../../../behavior/experiments/use-create-experiment.ts";
import type { ExperimentType } from "../../../model/prisma-types.ts";
import { formatEvaluationSummary } from "../../../ui/elements/experiments/BatchEvaluationV2/batch-evaluation-summary.tsx";
import { CopyExperimentDialog } from "../../../ui/elements/experiments/copy-experiment-dialog.tsx";
import { CreateExperimentButton } from "../../../ui/elements/experiments/create-experiment-button.tsx";
import { NavigationFooter, useNavigationFooter } from "../../../ui/elements/navigation-footer.tsx";
import { FullWidthListPageContent } from "../../../ui/elements/ui/layouts/full-width-list-page-content.tsx";

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
        <LuCircleCheckBig size={14} color="var(--chakra-colors-green-500)" />
        <Text fontSize="sm">Completed</Text>
      </>
    );
  }
  if (timestamps?.stoppedAt) {
    return (
      <>
        <LuCircleX size={14} color="var(--chakra-colors-red-500)" />
        <Text fontSize="sm">Stopped</Text>
      </>
    );
  }
  const updatedAt = timestamps?.updatedAt;
  if (updatedAt && nowInstant().epochMilliseconds - updatedAt < RUNNING_WINDOW_MS) {
    return (
      <>
        <Spinner size="xs" />
        <Text fontSize="sm">Running</Text>
      </>
    );
  }
  if (runsSummary.count > 0) {
    return (
      <>
        <LuCircleCheckBig size={14} color="var(--chakra-colors-green-500)" />
        <Text fontSize="sm">Completed</Text>
      </>
    );
  }
  return (
    <Text fontSize="sm" color="fg.muted">
      -
    </Text>
  );
}

export function ExperimentsPage() {
  const { project, hasPermission } = useOrganizationTeamProject();
  const router = useRouter();
  const [copyDialogState, setCopyDialogState] = useState<{
    open: boolean;
    experimentId: string;
    experimentName: string;
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
  const experiments = api.experiments.getAllForEvaluationsList.useQuery(
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

  const deleteExperimentMutation = api.experiments.deleteExperiment.useMutation({
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

  const taskTypeToLabel: Record<keyof typeof LEGACY_EXPERIMENT_TASK_TYPES, string> = {
    real_time: "Legacy live workflow",
    llm_app: "LLM App Experiment",
    prompt_creation: "Prompt Experiment",
    custom_evaluator: "Evaluator Experiment",
    scan: "Vulnerability Scan",
  };

  const experimentTypeToLabel: Record<ExperimentType, string> = {
    BATCH_EVALUATION_V2: "Experiment (SDK)",
    BATCH_EVALUATION: "Batch Experiment",
    DSPY: "DSPy Optimization",
    EVALUATIONS_V3: "Experiment (UI)",
  };

  const pageState = experimentsPageState(experiments);

  return (
    <Box width="full">
      <PageLayout.Header>
        <PageLayout.Heading>Experiments</PageLayout.Heading>
        <Spacer />
        <HStack gap={2}>
          <CreateExperimentButton isCreating={isCreating} onCreate={createNewExperiment} />
        </HStack>
      </PageLayout.Header>
      {pageState === "loading" && (
        <Box display="flex" justifyContent="center" py={8}>
          <Spinner />
        </Box>
      )}
      {pageState === "error" && (
        <Box padding={6}>
          <Text color="red.500">Error loading experiments</Text>
        </Box>
      )}
      {pageState === "empty" && (
        <PageLayout.Container>
          <PageLayout.Content>
            <NoDataInfoBlock
              title="No experiments yet"
              description="Test prompts, models, and agents against a dataset before shipping changes."
              icon={<LuSquareCheckBig size={24} />}
              color="green.500"
              docsInfo={
                <Text>
                  To learn more about experiments, visit the{" "}
                  <Link
                    color="inherit"
                    textDecoration="underline"
                    href="https://langwatch.ai/docs/evaluations/experiments/overview"
                    isExternal
                  >
                    experiments documentation
                  </Link>
                  .
                </Text>
              }
            >
              <HStack marginTop={4} gap={2}>
                <CreateExperimentButton isCreating={isCreating} onCreate={createNewExperiment} />
              </HStack>
            </NoDataInfoBlock>
          </PageLayout.Content>
        </PageLayout.Container>
      )}
      {pageState === "list" && (
        <FullWidthListPageContent>
          <VStack width="full" gap={4} align="stretch">
            <Text color="fg.muted">Compare configurations and analyze batch test results</Text>
            <>
              <ListTable width="full">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader width="20%">Experiment</Table.ColumnHeader>
                    <Table.ColumnHeader width="15%">Type</Table.ColumnHeader>
                    <Table.ColumnHeader width="10%">Dataset</Table.ColumnHeader>
                    <Table.ColumnHeader width="20%">Primary Metric</Table.ColumnHeader>
                    <Table.ColumnHeader width="10%">Runs</Table.ColumnHeader>
                    <Table.ColumnHeader width="10%">Status</Table.ColumnHeader>
                    <Table.ColumnHeader width="10%">Last Updated</Table.ColumnHeader>
                    <Table.ColumnHeader width="5%"></Table.ColumnHeader>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {experiments.isLoading || experiments.isFetching
                    ? Array.from({ length: 3 }).map((_, i) => (
                        <Table.Row key={i}>
                          <Table.Cell>
                            <Skeleton height="20px" />
                          </Table.Cell>
                          <Table.Cell>
                            <Skeleton height="20px" />
                          </Table.Cell>
                          <Table.Cell>
                            <Skeleton height="20px" />
                          </Table.Cell>
                          <Table.Cell>
                            <Skeleton height="20px" />
                          </Table.Cell>
                          <Table.Cell>
                            <Skeleton height="20px" />
                          </Table.Cell>
                          <Table.Cell>
                            <Skeleton height="20px" />
                          </Table.Cell>
                          <Table.Cell>
                            <Skeleton height="20px" />
                          </Table.Cell>
                          <Table.Cell>
                            <Skeleton height="20px" />
                          </Table.Cell>
                        </Table.Row>
                      ))
                    : experiments.data?.experiments.map((experiment) => (
                        // Point Langy at an experiment. Same chip id the
                        // `/experiments/<slug>` route derives, so pointing
                        // at a row and then opening it yields one chip, not
                        // two. Closed, this is the plain clickable row.
                        <LangyContextTarget
                          key={experiment.id}
                          target={experimentContextChip({
                            slug: experiment.slug,
                            name: experiment.name,
                          })}
                        >
                          <Table.Row
                            cursor="pointer"
                            onClick={() => {
                              // Workbench-backed experiments (current and
                              // legacy wizard) open in the workbench;
                              // everything else in the experiment view.
                              if (
                                experiment.type === "EVALUATIONS_V3" ||
                                experiment.workbenchState
                              ) {
                                void router.push({
                                  pathname: `/${project?.slug}/experiments/workbench/${experiment.slug}`,
                                });
                              } else {
                                void router.push({
                                  pathname: `/${project?.slug}/experiments/${experiment.slug}`,
                                });
                              }
                            }}
                          >
                            <Table.Cell>
                              <OverflownTextWithTooltip lineClamp={1} wordBreak="break-word">
                                {experiment.name ?? experiment.slug}
                              </OverflownTextWithTooltip>
                            </Table.Cell>
                            <Table.Cell whiteSpace="nowrap">
                              <Badge colorPalette="gray" variant="outline">
                                {experiment.workbenchState?.task
                                  ? taskTypeToLabel[experiment.workbenchState.task]
                                  : experimentTypeToLabel[experiment.type]}
                              </Badge>
                            </Table.Cell>
                            <Table.Cell>
                              <OverflownTextWithTooltip lineClamp={1} wordBreak="break-word">
                                {experiment.dataset?.name ?? "-"}
                              </OverflownTextWithTooltip>
                            </Table.Cell>
                            <Table.Cell>
                              {experiment.runsSummary.primaryMetric ? (
                                <>
                                  <Text as="span" fontSize="xs" color="fg.muted">
                                    {experiment.runsSummary.primaryMetric.name}: &nbsp;
                                  </Text>
                                  <Text as="span" fontWeight="semibold">
                                    {formatEvaluationSummary(
                                      experiment.runsSummary.primaryMetric,
                                      true,
                                    )}
                                  </Text>
                                </>
                              ) : (
                                "-"
                              )}
                            </Table.Cell>
                            <Table.Cell>{experiment.runsSummary.count ?? "-"}</Table.Cell>
                            <Table.Cell>
                              <HStack gap={1}>
                                <ExperimentRunStatus runsSummary={experiment.runsSummary} />
                              </HStack>
                            </Table.Cell>
                            <Table.Cell whiteSpace="nowrap">
                              {readableDate(experiment.updatedAt).toLocaleString()}
                            </Table.Cell>
                            <Table.Cell>
                              <Box width="full" height="full" display="flex" justifyContent="end">
                                <Menu.Root>
                                  <Menu.Trigger
                                    aria-label={`Actions for ${experiment.name ?? experiment.slug}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                    }}
                                  >
                                    <MoreVertical size={16} />
                                  </Menu.Trigger>
                                  <Menu.Content>
                                    {hasPermission("workflows:create") &&
                                      experiment.type === "EVALUATIONS_V3" && (
                                        <Menu.Item
                                          value="edit"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            void router.push(
                                              `/${project?.slug}/experiments/workbench/${experiment.slug}`,
                                            );
                                          }}
                                        >
                                          <LuPencil size={16} />
                                          Edit
                                        </Menu.Item>
                                      )}
                                    {hasPermission("workflows:create") &&
                                      experiment.type !== "EVALUATIONS_V3" &&
                                      experiment.type !== "BATCH_EVALUATION_V2" &&
                                      experiment.workbenchState && (
                                        <Menu.Item
                                          value="edit"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            void router.push(
                                              `/${project?.slug}/experiments/workbench/${experiment.slug}`,
                                            );
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
                                        void router.push(
                                          `/${project?.slug}/experiments/${experiment.slug}`,
                                        );
                                      }}
                                    >
                                      <LuEye size={16} />
                                      View Results
                                    </Menu.Item>
                                    {hasPermission("evaluations:manage") && (
                                      <Menu.Item
                                        value="replicate"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setCopyDialogState({
                                            open: true,
                                            experimentId: experiment.id,
                                            experimentName: experiment.name ?? experiment.slug,
                                          });
                                        }}
                                      >
                                        <Copy size={16} />
                                        Replicate to another project
                                      </Menu.Item>
                                    )}
                                    {hasPermission("workflows:delete") && (
                                      <Menu.Item
                                        value="delete"
                                        color="red.500"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleDeleteExperiment(
                                            experiment.id,
                                            experiment.name ?? experiment.slug,
                                          );
                                        }}
                                      >
                                        <LuTrash size={16} />
                                        Delete
                                      </Menu.Item>
                                    )}
                                  </Menu.Content>
                                </Menu.Root>
                              </Box>
                            </Table.Cell>
                          </Table.Row>
                        </LangyContextTarget>
                      ))}
                </Table.Body>
              </ListTable>
              {experiments.data && experiments.data.experiments.length > 0 && (
                <NavigationFooter {...navigationFooter} />
              )}
            </>
          </VStack>
        </FullWidthListPageContent>
      )}
      {copyDialogState && (
        <CopyExperimentDialog
          open={copyDialogState.open}
          onClose={() => setCopyDialogState(null)}
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
