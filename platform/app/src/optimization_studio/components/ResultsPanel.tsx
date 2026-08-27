import { HStack, type StackProps } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import {
  BatchEvaluationResultsTable,
  type BatchRunSummary,
  BatchRunsSidebar,
  BatchSummaryFooter,
  transformBatchEvaluationData,
} from "@langwatch/experiment-web";
import { ExternalImage } from "~/components/ExternalImage";
import { EvaluatorResultChip } from "~/components/shared/EvaluatorResultChip";
import { describeCellFailure } from "~/experiments-v3/utils/cellFailure";
import { TraceIdPeek } from "~/features/traces-v2/components/TraceIdPeek";
import { useDrawer } from "~/hooks/useDrawer";
import { useBatchEvaluationState } from "../../components/experiments/BatchEvaluationV2";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import { slugify } from "../../utils/slugify";
import { useRunEvalution } from "../hooks/useRunEvalution";
import {
  isExperimentQueryEnabled,
  useWorkflowSelectedEvaluationRun,
  useWorkflowStore,
  WorkflowEvaluationResultsLayout,
  WorkflowResultsPanel,
} from "@langwatch/workflow-web";
import type { Entry, StudioWorkflow } from "@langwatch/workflow-contract";
import { getWorkflowEntryOutputs } from "@langwatch/workflow-contract";
import { OpenFullResultsButton } from "./OpenFullResultsButton";
import { RunViaApiButton } from "./RunViaApiButton";

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

  const experiment = api.experiments.getExperimentBySlugOrId.useQuery(
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
      refetchInterval: keepFetching ? 1 : undefined,
    },
  );

  useEffect(() => {
    if (evaluationState?.status === "running" && !experiment.data) {
      setKeepFetching(true);
    } else {
      const stopFetchingTimeout = setTimeout(
        () => {
          setKeepFetching(false);
        },
        experiment.data ? 0 : 15_000,
      );
      return () => clearTimeout(stopFetchingTimeout);
    }
  }, [evaluationState?.status, experiment.data]);

  const { selectedRunId, setSelectedRunId } = useWorkflowSelectedEvaluationRun(
    evaluationState?.run_id,
  );

  const { stopEvaluation } = useRunEvalution();

  const { getWorkflow } = useWorkflowStore(({ getWorkflow }) => ({
    getWorkflow,
  }));

  const {
    selectedRun,
    isFinished,
    batchEvaluationRuns,
    selectedRunId: selectedRunId_,
  } = useBatchEvaluationState({
    project: project,
    experiment: experiment.data,
    selectedRunId,
    setSelectedRunId,
  });

  // Fetch selected run data for new table
  const runDataQuery = api.experiments.getExperimentBatchEvaluationRun.useQuery(
    {
      projectId: project?.id ?? "",
      experimentId: experiment.data?.id ?? "",
      runId: selectedRunId_ ?? "",
    },
    {
      enabled: !!project && !!experiment.data && !!selectedRunId_,
      refetchInterval: !isFinished ? 1000 : false,
    },
  );

  // Transform run data for new table
  const transformedData = runDataQuery.data
    ? transformBatchEvaluationData(runDataQuery.data)
    : null;

  // Transform runs for new sidebar
  const sidebarRuns: BatchRunSummary[] = (batchEvaluationRuns.data?.runs ?? []).map((run) => ({
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

  if (
    (experiment.isError && experiment.error.data?.httpStatus === 404) ||
    batchEvaluationRuns.data?.runs.length === 0 ||
    !experiment.data ||
    !project
  ) {
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
