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
import { keepPreviousData } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { LuSquareCheckBig } from "react-icons/lu";

import { experimentApi } from "../../../behavior/experiment-api.ts";
import {
  createRunSlotQueue,
  RUNS_IN_FLIGHT,
} from "../../../behavior/experiments/run-slot-queue.ts";
import { useCopyExperiment } from "../../../behavior/experiments/use-copy-experiment.ts";
import { useCreateExperiment } from "../../../behavior/experiments/use-create-experiment.ts";
import {
  EVERY_EXPERIMENT,
  useExperimentListControls,
  useVisibleExperiments,
} from "../../../behavior/experiments/use-experiment-list-view.ts";
import { kindOptions } from "../../../model/experiments/experiment-list-filter.ts";
import { type ExperimentListRow } from "../../../model/experiments/experiment-list-row.ts";
import type { ExperimentType } from "../../../model/prisma-types.ts";
import { useWorkflowHost } from "../../../model/workflow/workflow-host.ts";
import { CopyExperimentDialog } from "../../../ui/elements/experiments/copy-experiment-dialog.tsx";
import { CreateExperimentButton } from "../../../ui/elements/experiments/create-experiment-button.tsx";
import { PAGE_SIZE_OPTIONS, useNavigationFooter } from "../../../ui/elements/navigation-footer.tsx";
import { FullWidthListPageContent } from "../../../ui/elements/ui/layouts/full-width-list-page-content.tsx";
import { ExperimentListToolbar } from "../../blocks/experiments/experiment-list-toolbar.tsx";
import { ExperimentListRowSection, LIST_COLUMN_COUNT } from "./experiment-list-row.tsx";
import {
  ExperimentListBody,
  ExperimentListHeader,
  FilteredPagination,
} from "./experiment-list-table.tsx";

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
  const navigationFooter = useNavigationFooter();
  const controls = useExperimentListControls({
    pageSize: navigationFooter.pageSize,
    onPageSizeChange: navigationFooter.changePageSize,
  });
  const runSlots = useMemo(() => createRunSlotQueue(RUNS_IN_FLIGHT), []);
  const { narrowed } = controls;
  const [experimentToDelete, setExperimentToDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const { createNewExperiment, isCreating } = useCreateExperiment({
    projectId: project?.id,
    projectSlug: project?.slug,
  });
  const { copyExperimentTo, isCopying } = useCopyExperiment();

  /**
   * One page of the project's experiments; every field is one the table renders. The endpoint has
   * no search, so an active search or filter loads them all in one call and narrows them here.
   */
  const experiments = experimentApi.experiments.getAllForEvaluationsList.useQuery(
    {
      projectId: project?.id ?? "",
      pageOffset: narrowed ? 0 : navigationFooter.pageOffset,
      pageSize: narrowed ? EVERY_EXPERIMENT : navigationFooter.pageSize,
    },
    {
      enabled: !!project && router.isReady,
      placeholderData: keepPreviousData,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    },
  ) as ExperimentsListQuery;

  navigationFooter.useUpdateTotalHits(experiments);

  const loaded = experiments.data?.experiments;
  const { matching, shown, groups, page } = useVisibleExperiments({ rows: loaded, controls });

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

  const permissions = {
    canEdit: workflowHost.hasPermission("workflows:create"),
    canReplicate: workflowHost.hasPermission("evaluations:manage"),
    canDelete: workflowHost.hasPermission("workflows:delete"),
  };
  const toggleOpen = (id: string) =>
    setOpenIds((ids) => (ids.includes(id) ? ids.filter((entry) => entry !== id) : [...ids, id]));

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
            Each row is an experiment&apos;s latest run: its score, cost and status. Open a row to
            load every target&apos;s numbers.
          </Text>
          {pageState === "error" && narrowed && (
            <ExperimentListToolbar
              filters={controls.filters}
              onFilters={controls.changeFilters}
              kinds={kindOptions(loaded ?? [])}
              grouping={controls.grouping}
              onGrouping={controls.setGrouping}
            />
          )}
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
          {(pageState === "loading" || pageState === "list") && (
            <>
              <ExperimentListToolbar
                filters={controls.filters}
                onFilters={controls.changeFilters}
                kinds={kindOptions(loaded ?? [])}
                grouping={controls.grouping}
                onGrouping={controls.setGrouping}
              />
              <ListTable width="full" loading={pageState === "loading"}>
                <ExperimentListHeader />
                <Table.Body>
                  {experiments.isFetching ? (
                    <ListTable.LoadingRows rows={5} columns={LIST_COLUMN_COUNT} />
                  ) : (
                    <ExperimentListBody
                      groups={groups}
                      matching={matching}
                      grouped={controls.grouping === "kind"}
                      collapsed={controls.collapsed}
                      onToggleGroup={controls.toggleGroup}
                      renderRow={(experiment) => (
                        <ExperimentListRowSection
                          key={experiment.id}
                          experiment={experiment}
                          projectId={project.id}
                          projectSlug={project.slug}
                          runSlots={runSlots}
                          permissions={permissions}
                          open={openIds.includes(experiment.id)}
                          onToggle={() => toggleOpen(experiment.id)}
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
                            handleDeleteExperiment(
                              experiment.id,
                              experiment.name ?? experiment.slug,
                            )
                          }
                        />
                      )}
                    />
                  )}
                </Table.Body>
              </ListTable>
              {narrowed ? (
                <FilteredPagination
                  controls={controls}
                  page={page}
                  total={matching.length}
                  visible={shown.length}
                  isLoading={experiments.isFetching}
                />
              ) : (
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
              )}
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
