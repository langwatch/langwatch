import { useDrawer } from "@langwatch/browser-host/use-drawer";
import { useRouter } from "@langwatch/browser-host/use-router";
import { ExternalImage } from "@langwatch/design-system/external-image";
import { HStack, type StackProps } from "@langwatch/design-system/primitives";
import { slugify } from "@langwatch/design-system/slugify";
import type { ExperimentRun } from "@langwatch/experiment-contract";
import type { Entry, StudioWorkflow } from "@langwatch/workflow-contract";
import { getWorkflowEntryOutputs } from "@langwatch/workflow-contract";
import { useEffect, useState } from "react";

import { useBatchRunSelection } from "../../../behavior/experiment/use-batch-run-selection.ts";
import { TraceIdPeek } from "../../../behavior/lent-trace.tsx";
import { useOrganizationTeamProject } from "../../../behavior/studio-host/use-organization-team-project.ts";
import { useWorkflowStore } from "../../../behavior/use-workflow-store.ts";
import { workflowApi } from "../../../behavior/workflow-api.ts";
import { describeCellFailure } from "../../../model/experiment/cell-failure.ts";
import { isExperimentQueryEnabled } from "../../../model/studio-evaluation-query.ts";
import { EvaluatorResultChip } from "../../elements/evaluator/evaluator-result-chip.tsx";
import { OpenFullResultsButton } from "../../elements/optimization_studio/open-full-results-button.tsx";
import {
  useWorkflowSelectedEvaluationRun,
  WorkflowEvaluationResultsLayout,
  WorkflowResultsPanel,
} from "../../elements/workflow-results-panel.tsx";
import { transformBatchEvaluationData } from "../experiment/batch-evaluation-results.types.ts";
import { BatchEvaluationResultsTable } from "../experiment/batch-results/batch-evaluation-results-table.tsx";
import {
  type BatchRunSummary,
  BatchRunsSidebar,
} from "../experiment/batch-results/batch-runs-sidebar.tsx";
import { BatchSummaryFooter } from "../experiment/batch-results/batch-summary-footer.tsx";
import { RunViaApiButton } from "./run-via-api-button.tsx";
import { useRunEvalution } from "./use-run-evalution.ts";

export function ResultsPanel({
  isCollapsed,
  collapsePanel,
}: {
  isCollapsed: boolean;
  collapsePanel: (isCollapsed: boolean) => void;
}) {
  const { workflowId, experimentId, evaluationState } = useWorkflowStore(
    ({ workflow_id: workflowId, experiment_id: experimentId, state }) => ({
      workflowId,
      experimentId,
      evaluationState: state.evaluation,
    }),
  );

  return (
    <WorkflowResultsPanel isCollapsed={isCollapsed} onCollapse={() => collapsePanel(true)}>
      <EvaluationResults
        workflowId={workflowId}
        experimentId={experimentId}
        evaluationState={evaluationState}
      />
    </WorkflowResultsPanel>
  );
}

export function EvaluationResults({
  workflowId,
  experimentId,
  evaluationState,
  sidebarProps,
}: {
  workflowId?: string;
  experimentId?: string;
  evaluationState: StudioWorkflow["state"]["evaluation"];
  sidebarProps?: StackProps;
}) {
  const { project } = useOrganizationTeamProject();
  const { openDrawer } = useDrawer();
  const [keepFetching, setKeepFetching] = useState(false);

  const experiment = workflowApi.experiments.getExperimentBySlugOrId.useQuery(
    {
      projectId: project?.id ?? "",
      experimentId: experimentId,
      experimentSlug: experimentId ? undefined : slugify(workflowId ?? ""),
    },
    {
      enabled: isExperimentQueryEnabled({
        hasProject: !!project,
        workflowId,
      }),
      refetchOnWindowFocus: false,
      // needs a read hint: workflow experiment created by the running evaluation
    },
  );

  useEffect(() => {
    if (evaluationState?.status === "running" && !experiment.data) {
      setKeepFetching(true);
      // `apps/ui` compiles this package under `noImplicitReturns`: an effect
      // with a cleanup on one branch has to say so on the other.
      return undefined;
    }
    const stopFetchingTimeout = setTimeout(
      () => {
        setKeepFetching(false);
      },
      experiment.data ? 0 : 15_000,
    );
    return () => clearTimeout(stopFetchingTimeout);
  }, [evaluationState?.status, experiment.data]);

  const { selectedRunId, setSelectedRunId } = useWorkflowSelectedEvaluationRun(
    evaluationState?.run_id,
  );

  const { stopEvaluation } = useRunEvalution();

  const { getWorkflow } = useWorkflowStore(({ getWorkflow }) => ({
    getWorkflow,
  }));

  const batchEvaluationRuns = workflowApi.experiments.getExperimentBatchEvaluationRuns.useQuery(
    { projectId: project?.id ?? "", experimentId: experiment.data?.id ?? "" },
    {
      enabled: !!project && !!experiment.data,
      // needs a read hint: batch evaluation run started or finished
    },
  );
  const router = useRouter();
  const runs: ExperimentRun[] | undefined = batchEvaluationRuns.data?.runs;
  const { selectedRun, selectedRunId: selectedRunId_ } = useBatchRunSelection({
    runs,
    selectedRunId,
    routerRunId: typeof router.query.runId === "string" ? router.query.runId : undefined,
    selectRun: setSelectedRunId,
  });

  // Fetch selected run data for new table
  const runDataQuery = workflowApi.experiments.getExperimentBatchEvaluationRun.useQuery(
    {
      projectId: project?.id ?? "",
      experimentId: experiment.data?.id ?? "",
      runId: selectedRunId_ ?? "",
    },
    {
      enabled: !!project && !!experiment.data && !!selectedRunId_,
      // needs a read hint: batch evaluation run result recorded
    },
  );

  // Transform run data for new table
  const transformedData = runDataQuery.data
    ? transformBatchEvaluationData(runDataQuery.data)
    : null;

  // Transform runs for new sidebar
  const sidebarRuns: BatchRunSummary[] = (runs ?? []).map((run) => ({
    runId: run.runId,
    workflowVersion: run.workflowVersion,
    timestamps: run.timestamps,
    progress: run.progress,
    total: run.total,
    summary: {
      datasetCost: run.summary.datasetCost,
      evaluationsCost: run.summary.evaluationsCost,
      evaluations: Object.fromEntries(
        Object.entries(run.summary.evaluations).map(([id, ev]) => [
          id,
          {
            name: ev.name,
            averageScore: ev.averageScore,
            averagePassed: ev.averagePassed,
          },
        ]),
      ),
    },
  }));

  const sidebarSelectedRun = sidebarRuns.find((r) => r.runId === selectedRunId_);

  const hasNothingToShow =
    (experiment.isError && experiment.error.data?.httpStatus === 404) ||
    runs?.length === 0 ||
    !experiment.data ||
    !project;
  if (hasNothingToShow) {
    if (keepFetching) {
      return <WorkflowEvaluationResultsLayout status="loading" />;
    }
    return <WorkflowEvaluationResultsLayout status="waiting" />;
  }

  if (experiment.isError) {
    return <WorkflowEvaluationResultsLayout status="error" />;
  }

  const evaluationStateRunId = evaluationState?.run_id;

  const workflow = getWorkflow();
  const entryFields = getWorkflowEntryOutputs(workflow);
  const entryDataset = (
    workflow.nodes.find((node) => node.type === "entry")?.data as Entry | undefined
  )?.dataset;
  const datasetColumns = entryDataset?.inline?.columnTypes.map((column) => column.name) ?? [];

  return (
    <WorkflowEvaluationResultsLayout
      status="ready"
      sidebar={
        <BatchRunsSidebar
          runs={sidebarRuns}
          selectedRunId={selectedRunId_}
          onSelectRun={setSelectedRunId}
          isLoading={batchEvaluationRuns.isLoading}
          size="sm"
          {...sidebarProps}
        />
      }
      table={
        <BatchEvaluationResultsTable
          data={transformedData}
          isLoading={runDataQuery.isLoading}
          describeFailure={describeCellFailure}
          renderEvaluatorResult={({ result }) => (
            <EvaluatorResultChip
              name={result.evaluatorName}
              result={{
                status: result.status,
                score: result.score,
                passed: result.passed,
                label: result.label,
                details: result.details,
              }}
              inputs={result.inputs}
            />
          )}
          renderTracePeek={({ traceId }) => <TraceIdPeek traceId={traceId} />}
          onOpenTrace={(traceId) => openDrawer("traceV2Details", { traceId })}
          renderDatasetImage={({ src }) => (
            <ExternalImage
              src={src}
              minWidth="24px"
              minHeight="24px"
              maxHeight="80px"
              maxWidth="100%"
              expandable
            />
          )}
        />
      }
      footer={
        sidebarSelectedRun ? (
          <BatchSummaryFooter
            run={sidebarSelectedRun}
            showProgress={
              (!selectedRun || selectedRun.runId === evaluationStateRunId) &&
              !!evaluationStateRunId &&
              evaluationState?.status === "running"
            }
            onStop={() =>
              stopEvaluation({
                run_id: evaluationStateRunId ?? "",
              })
            }
            actions={
              <HStack gap={2}>
                {workflowId && (
                  <RunViaApiButton
                    workflowId={workflowId}
                    entryFields={entryFields}
                    datasetColumns={datasetColumns}
                    datasetName={entryDataset?.name}
                    projectSlug={project.slug}
                  />
                )}
                {selectedRunId_ && (
                  <OpenFullResultsButton
                    projectSlug={project.slug}
                    experimentSlug={experiment.data.slug}
                    runId={selectedRunId_}
                  />
                )}
              </HStack>
            }
          />
        ) : null
      }
    />
  );
}
