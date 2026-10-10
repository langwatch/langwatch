import { isHandledByGlobalHandler } from "@langwatch/browser-host/errors";
import { toaster } from "@langwatch/browser-host/toaster";
import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { useRouter } from "@langwatch/browser-host/use-router";
import { Banner, BannerAction } from "@langwatch/design-system/banner";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { ListTable } from "@langwatch/design-system/list-table";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Pagination } from "@langwatch/design-system/pagination";
import { Box, Table, Text, VStack } from "@langwatch/design-system/primitives";
import { SkeletonRows } from "@langwatch/design-system/skeletons";
import { keepPreviousData } from "@tanstack/react-query";
import { useState } from "react";
import { LuSquareCheckBig } from "react-icons/lu";

import { experimentApi } from "../../../behavior/experiment-api.ts";
import { useCopyExperiment } from "../../../behavior/experiments/use-copy-experiment.ts";
import { useCreateExperiment } from "../../../behavior/experiments/use-create-experiment.ts";
import { type ExperimentListRow } from "../../../model/experiments/experiment-list-row.ts";
import type { ExperimentType } from "../../../model/prisma-types.ts";
import { useWorkflowHost } from "../../../model/workflow/workflow-host.ts";
import { CopyExperimentDialog } from "../../../ui/elements/experiments/copy-experiment-dialog.tsx";
import { CreateExperimentButton } from "../../../ui/elements/experiments/create-experiment-button.tsx";
import { PAGE_SIZE_OPTIONS, useNavigationFooter } from "../../../ui/elements/navigation-footer.tsx";
import { FullWidthListPageContent } from "../../../ui/elements/ui/layouts/full-width-list-page-content.tsx";
import { ExperimentListRowSection, LIST_COLUMN_COUNT } from "./experiment-list-row.tsx";

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
  const [openIds, setOpenIds] = useState<string[]>([]);
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
            />
          )}
          {pageState === "list" && (
            <>
              <ListTable width="full">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader width="4%" aria-label="Open or close the row" />
                    <Table.ColumnHeader width="30%">Experiment</Table.ColumnHeader>
                    <Table.ColumnHeader width="26%">Result, latest run</Table.ColumnHeader>
                    <Table.ColumnHeader width="6%">Runs</Table.ColumnHeader>
                    <Table.ColumnHeader width="12%">Status</Table.ColumnHeader>
                    <Table.ColumnHeader width="14%">Last updated</Table.ColumnHeader>
                    <ListTable.ActionHeader />
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {experiments.isFetching ? (
                    <ListTable.LoadingRows rows={3} columns={LIST_COLUMN_COUNT} />
                  ) : (
                    experiments.data?.experiments.map((experiment) => (
                      <ExperimentListRowSection
                        key={experiment.id}
                        experiment={experiment}
                        projectId={project.id}
                        projectSlug={project.slug}
                        permissions={{
                          canEdit: workflowHost.hasPermission("workflows:create"),
                          canReplicate: workflowHost.hasPermission("evaluations:manage"),
                          canDelete: workflowHost.hasPermission("workflows:delete"),
                        }}
                        open={openIds.includes(experiment.id)}
                        onToggle={() =>
                          setOpenIds((ids) =>
                            ids.includes(experiment.id)
                              ? ids.filter((id) => id !== experiment.id)
                              : [...ids, experiment.id],
                          )
                        }
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
