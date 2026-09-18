/**
 * Builds MonitorAppInfrastructure. The performance trend read calls EvaluationApi
 * instead of private ClickHouse access.
 */
import { analyticsComparisonWindow } from "@langwatch/analytics-contract";
import type { EvaluationApi, MonitorPerformanceQuery } from "@langwatch/evaluation-contract";
import { newEvaluatorId, type EvaluatorApi } from "@langwatch/evaluator-contract";
import { generate } from "@langwatch/ksuid";
import { MonitorCapabilityUnavailableError } from "@langwatch/monitor-contract";
import { Temporal } from "@langwatch/time";

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
 * Deleting a workflow a copy created, on a process that composed no
 * replication of the graph behind it. Refuses by name — an orphaned workflow
 * left behind by a failed monitor insert cannot be cleaned up here.
 */
type MonitorWorkflowCleanup = Readonly<{
  deleteReplicatedWorkflow(
    input: Readonly<{ workflowId: string; projectId: string }>,
  ): Promise<void>;
}>;

function unreplicatedEvaluatorWorkflows(): MonitorWorkflowCleanup {
  return {
    deleteReplicatedWorkflow: () =>
      Promise.reject(
        new MonitorCapabilityUnavailableError(
          "evaluator workflow replication, so a monitor's copied workflow cannot be cleaned up",
        ),
      ),
  };
}

/**
 * The evaluator copy, over `EvaluatorApi.copy` — the SAME replication
 * `evaluators.copy` itself runs, so a monitor's copy and an evaluator's own
 * copy replicate a workflow evaluator's graph identically.
 */
class ProcessMonitorReplication implements MonitorReplicationReader {
  constructor(
    private readonly evaluators: EvaluatorApi,
    private readonly workflows: MonitorWorkflowCleanup,
  ) {}

  async copyEvaluatorToProject(input: {
    evaluatorId: string;
    sourceProjectId: string;
    targetProjectId: string;
    actor: { id: string };
  }) {
    const copied = await this.evaluators.copy({
      evaluatorId: input.evaluatorId,
      projectId: input.targetProjectId,
      sourceProjectId: input.sourceProjectId,
      newEvaluatorId: newEvaluatorId(),
      actorId: input.actor.id,
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
  const previousPeriodStartMs = ({ startMs, endMs }: { startMs: number; endMs: number }) =>
    analyticsComparisonWindow({
      start: Temporal.Instant.fromEpochMilliseconds(startMs),
      end: Temporal.Instant.fromEpochMilliseconds(endMs),
    }).previousPeriodStart.epochMilliseconds;

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
