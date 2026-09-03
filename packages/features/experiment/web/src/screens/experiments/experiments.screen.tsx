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
import { CreateExperimentButton } from "../../ui/elements/experiments/create-experiment-button";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { NoDataInfoBlock } from "@langwatch/workflow-web/ui/elements/no-data-info-block";
import { ListTable } from "@langwatch/design-system/list-table";
import { FullWidthListPageContent } from "../../ui/elements/ui/layouts/full-width-list-page-content";
import { Link } from "@langwatch/workflow-web/studio-host/link";
import { LangyContextTarget } from "@langwatch/langy-web";
import { experimentContextChip } from "@langwatch/langy-web";
import type { ExperimentType } from "../../model/prisma-types";
import { useRouter } from "@langwatch/workflow-web/studio-host/next-router";
import { formatEvaluationSummary } from "../../ui/elements/experiments/BatchEvaluationV2/batch-evaluation-summary";
import { CopyExperimentDialog } from "../../ui/elements/experiments/copy-experiment-dialog";
import { NavigationFooter, useNavigationFooter } from "../../ui/elements/navigation-footer";
import { OverflownTextWithTooltip } from "@langwatch/workflow-web/components/OverflownText";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Menu } from "@langwatch/design-system/menu";
import { toaster } from "@langwatch/workflow-web/studio-host/toaster";
import { useOrganizationTeamProject } from "@langwatch/workflow-web/studio-host/use-organization-team-project";
import type { LEGACY_EXPERIMENT_TASK_TYPES } from "@langwatch/experiment-contract";
import { api } from "@langwatch/workflow-web/studio-host/api";
import { isHandledByGlobalHandler } from "@langwatch/trace-web/utils/trpcError";

/** One row of the experiments list, as this table renders it. */
type ExperimentListRow = {
  id: string;
  slug: string;
  name: string | null;
  type: ExperimentType;
  createdAt: string | Date;
  updatedAt: string | Date;
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

  /**
   * One page of the project's experiments.
   *
   * `platform/app` typed this off the mounted `AppRouter`; the borrowed entry
   * in the workflow family's procedure map declares the PATH — the half the
   * React Query cache key is made of — and leaves the row to the caller, so the
   * row is stated here. Every field is one the table renders.
   */
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

  const taskTypeToLabel: Record<
    keyof typeof LEGACY_EXPERIMENT_TASK_TYPES,
    string
  > = {
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

  return (
    <Box width="full">
      <PageLayout.Header>
        <PageLayout.Heading>Experiments</PageLayout.Heading>
        <Spacer />
        <HStack gap={2}>
          <CreateExperimentButton />
        </HStack>
      </PageLayout.Header>
      {experiments.isLoading ? (
        <Box display="flex" justifyContent="center" py={8}>
          <Spinner />
        </Box>
      ) : experiments.isError ? (
        <Box padding={6}>
          <Text color="red.500">Error loading experiments</Text>
        </Box>
      ) : experiments.data?.experiments.length === 0 ? (
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
                <CreateExperimentButton />
              </HStack>
            </NoDataInfoBlock>
          </PageLayout.Content>
        </PageLayout.Container>
      ) : (
        <FullWidthListPageContent>
          <VStack width="full" gap={4} align="stretch">
            <Text color="fg.muted">
              Compare configurations and analyze batch test results
            </Text>
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
                    : experiments.data
                      ? experiments.data.experiments.map((experiment) => (
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
                                <OverflownTextWithTooltip
                                  lineClamp={1}
                                  wordBreak="break-word"
                                >
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
                                <OverflownTextWithTooltip
                                  lineClamp={1}
                                  wordBreak="break-word"
                                >
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
                              <Table.Cell>
                                {experiment.runsSummary.count ?? "-"}
                              </Table.Cell>
                              <Table.Cell>
                                <HStack gap={1}>
                                  {experiment.runsSummary.latestRun?.timestamps
                                    ?.finishedAt ? (
                                    <>
                                      <LuCircleCheckBig
                                        size={14}
                                        color="var(--chakra-colors-green-500)"
                                      />
                                      <Text fontSize="sm">Completed</Text>
                                    </>
                                  ) : experiment.runsSummary.latestRun?.timestamps
                                      ?.stoppedAt ? (
                                    <>
                                      <LuCircleX
                                        size={14}
                                        color="var(--chakra-colors-red-500)"
                                      />
                                      <Text fontSize="sm">Stopped</Text>
                                    </>
                                  ) : experiment.runsSummary.latestRun?.timestamps
                                      ?.updatedAt &&
                                    Date.now() -
                                      experiment.runsSummary.latestRun.timestamps
                                        .updatedAt <
                                      5 * 60 * 1000 ? (
                                    <>
                                      <Spinner size="xs" />
                                      <Text fontSize="sm">Running</Text>
                                    </>
                                  ) : experiment.runsSummary.count > 0 ? (
                                    <>
                                      <LuCircleCheckBig
                                        size={14}
                                        color="var(--chakra-colors-green-500)"
                                      />
                                      <Text fontSize="sm">Completed</Text>
                                    </>
                                  ) : (
                                    <Text fontSize="sm" color="fg.muted">
                                      -
                                    </Text>
                                  )}
                                </HStack>
                              </Table.Cell>
                              <Table.Cell whiteSpace="nowrap">
                                {new Date(experiment.updatedAt).toLocaleString()}
                              </Table.Cell>
                              <Table.Cell>
                                <Box
                                  width="full"
                                  height="full"
                                  display="flex"
                                  justifyContent="end"
                                >
                                  <Menu.Root>
                                    <Menu.Trigger
                                      aria-label={`Actions for ${
                                        experiment.name ?? experiment.slug
                                      }`}
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
                                              experimentName:
                                                experiment.name ?? experiment.slug,
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
                        ))
                      : null}
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
          experimentId={copyDialogState.experimentId}
          experimentName={copyDialogState.experimentName}
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

/**
 * The grant the address carries, stated where the screen is rather than wrapped
 * around it.
 *
 * `platform/app` wrapped this page in `withPermissionGuard("experiments:view",
 * { layoutComponent: DashboardLayout })`. Both halves belong to the route now:
 * the composing application puts `withUiPageGuard` in front of the loader with
 * this permission, and the chrome is the layout route the screen is a child of.
 * The named export the page key used to resolve is gone with the wrapper — the
 * key names this module's default now.
 */
export const EXPERIMENTS_PAGE_PERMISSION = "experiments:view";

export default ExperimentsPage;
