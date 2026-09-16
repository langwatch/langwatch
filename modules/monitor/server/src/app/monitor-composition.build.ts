/**
 * Builds MonitorAppInfrastructure. The performance trend read calls EvaluationApi
 * instead of private ClickHouse access.
 */
import { createAnalyticsComparisonWindow } from "@langwatch/analytics-server";
import type { EvaluationApi, MonitorPerformanceQuery } from "@langwatch/evaluation-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import { EvaluatorReplicationService } from "@langwatch/evaluator-server";
import { MonitorCapabilityUnavailableError } from "@langwatch/monitor-contract";
import { generate } from "@langwatch/ksuid";

import type {
  MonitorAppInfrastructure,
  MonitorEvaluator,
  MonitorPerformance,
  MonitorReplicationReader,
} from "./monitor.app.ts";

/** The one evaluator service on this process, as the monitor reads it. */
class ProcessMonitorEvaluators implements MonitorEvaluator {
  constructor(private readonly evaluators: EvaluatorApi) {}

  getById(input: { id: string; projectId: string }) {
    return this.evaluators.getById(input);
  }

  archive(input: { id: string; projectId: string }) {
    return this.evaluators.archive(input);
  }
}

/**
 * Copying an evaluator's workflow, on a process that composed no replication
 * of the graph behind it. Both members refuse by name — a silent copy without
 * its workflow would be structurally broken. Ported from b383462d96^.
 */
type MonitorWorkflowReplication = Readonly<{
  replicateEvaluatorWorkflow(
    input: Readonly<{
      workflowId: string;
      sourceProjectId: string;
      targetProjectId: string;
      actor: Readonly<{ id: string }>;
    }>,
  ): Promise<string>;
  deleteReplicatedWorkflow(input: Readonly<{ workflowId: string; projectId: string }>): Promise<void>;
}>;

function unreplicatedEvaluatorWorkflows(): MonitorWorkflowReplication {
  const refuse = (): Promise<never> =>
    Promise.reject(
      new MonitorCapabilityUnavailableError(
        "evaluator workflow replication, so a monitor cannot be copied to another project",
      ),
    );

  return { replicateEvaluatorWorkflow: refuse, deleteReplicatedWorkflow: refuse };
}

/** The evaluator copy, over the process's own (absent) replication of the graph behind it. */
class ProcessMonitorReplication implements MonitorReplicationReader {
  constructor(
    private readonly evaluators: EvaluatorApi,
    private readonly workflows: MonitorWorkflowReplication,
  ) {}

  async copyEvaluatorToProject(input: {
    evaluatorId: string;
    sourceProjectId: string;
    targetProjectId: string;
    actor: { id: string };
  }) {
    const copied = await EvaluatorReplicationService.create({
      replicateEvaluatorWorkflow: (replication) =>
        this.workflows.replicateEvaluatorWorkflow({ ...replication, actor: input.actor }),
      deleteReplicatedWorkflow: (replication) => this.workflows.deleteReplicatedWorkflow(replication),
    }).copyToProject({
      evaluators: {
        findById: (lookup) => this.evaluators.findById(lookup),
        create: (created) => this.evaluators.create(created),
      },
      evaluatorId: input.evaluatorId,
      sourceProjectId: input.sourceProjectId,
      targetProjectId: input.targetProjectId,
    });

    return { id: copied.id, workflowId: copied.workflowId };
  }

  deleteReplicatedWorkflow(input: { workflowId: string; projectId: string }) {
    return this.workflows.deleteReplicatedWorkflow(input);
  }
}

/**
 * The seven-day trend, over the SAME Evaluation application the analytics
 * page reads: `getMonitorPerformance` owns the ClickHouse read and the fold
 * into a guardrail's pass rate or evaluator's mean score, over the same window.
 */
function composeMonitorPerformance(
  evaluation: Pick<EvaluationApi, "getMonitorPerformance">,
): MonitorPerformance {
  const window = createAnalyticsComparisonWindow();
  const previousPeriodStartMs = ({ startMs, endMs }: { startMs: number; endMs: number }) =>
    window.currentVsPrevious({ startDate: startMs, endDate: endMs }).previousPeriodStartDate.getTime();

  return new EvaluationApiMonitorPerformance(evaluation, previousPeriodStartMs);
}

class EvaluationApiMonitorPerformance implements MonitorPerformance {
  constructor(
    private readonly evaluation: Pick<EvaluationApi, "getMonitorPerformance">,
    private readonly window: (range: { startMs: number; endMs: number }) => number,
  ) {}

  getMonitorPerformance(query: MonitorPerformanceQuery) {
    return this.evaluation.getMonitorPerformance(query);
  }

  previousPeriodStartMs(range: { projectId: string; startMs: number; endMs: number }): number {
    return this.window(range);
  }
}

/** The app's KSUID resource for a monitor row (`KSUID_RESOURCES.MONITOR`). */
const MONITOR_KSUID_RESOURCE = "monitor";

/** What this process hands `MonitorApp` at boot, built from its own peers. */
export function buildMonitorInfrastructure(input: {
  evaluators: EvaluatorApi;
  evaluation: Pick<EvaluationApi, "getMonitorPerformance">;
}): MonitorAppInfrastructure {
  const { evaluators, evaluation } = input;

  return {
    evaluators: new ProcessMonitorEvaluators(evaluators),
    performance: composeMonitorPerformance(evaluation),
    replication: new ProcessMonitorReplication(evaluators, unreplicatedEvaluatorWorkflows()),
    generateId: () => generate(MONITOR_KSUID_RESOURCE).toString(),
  };
}
