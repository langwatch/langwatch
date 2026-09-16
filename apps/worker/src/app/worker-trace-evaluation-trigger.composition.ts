import type { ExecuteEvaluationCommandData } from "@langwatch/evaluation-contract";
import { ExecuteEvaluationCommand } from "@langwatch/evaluation-server";
import type { QueueSendOptions } from "@langwatch/eventing";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import {
  OtelTraceEvaluationLoopMetricsAdapter,
  type TraceEvaluationDispatch,
  createEvaluationTriggerSubscriber,
  type TraceEvaluationLoopMetrics,
  type TraceEvaluationMonitor,
  type TraceSummarySubscriber,
} from "@langwatch/trace-server";
import {
  createWorkerTraceEvaluationMonitorPort,
  type TraceEvaluationMonitorReader,
} from "./worker-trace-narrow-ports.composition.ts";

/**
 * Staged but not mounted; builds the evaluation-trigger from monitor, flags,
 * and queue.
 */
export function createWorkerTraceEvaluationTrigger(options: {
  /**
   * The one monitor listing this path reads, not the whole `MonitorService`:
   * creating and replicating a monitor is what puts an `EvaluatorApi` behind
   * it. `MonitorService` satisfies this, and so does the catalogue-only service.
   */
  monitors: TraceEvaluationMonitorReader;
  featureFlags: FeatureFlagApi;
  sendEvaluation: (
    data: ExecuteEvaluationCommandData,
    sendOptions?: QueueSendOptions<ExecuteEvaluationCommandData>,
  ) => Promise<void>;
  metrics?: TraceEvaluationLoopMetrics;
}): WorkerTraceEvaluationTrigger {
  const monitors = createWorkerTraceEvaluationMonitorPort(options.monitors);
  const dispatch = new WorkerTraceEvaluationDispatchAdapter(options.sendEvaluation);
  return new WorkerTraceEvaluationTrigger(
    monitors,
    dispatch,
    createEvaluationTriggerSubscriber({
      featureFlags: options.featureFlags,
      monitors,
      evaluation: dispatch,
      metrics: options.metrics ?? OtelTraceEvaluationLoopMetricsAdapter.create(),
    }),
  );
}

/** One process-owned evaluation-trigger graph. */
export class WorkerTraceEvaluationTrigger {
  constructor(
    readonly monitors: TraceEvaluationMonitor,
    readonly dispatch: TraceEvaluationDispatch,
    private readonly built: TraceSummarySubscriber,
  ) {}

  /** The named subscriber spec the trace pipeline registers. */
  subscriber(): TraceSummarySubscriber {
    return this.built;
  }
}

/**
 * Pairs the process's evaluation queue with Evaluation's own dedup identity.
 * The two halves come from different places on purpose: the transport is
 * this process's, the key is the command's, so both graphs squash on the same string.
 */
class WorkerTraceEvaluationDispatchAdapter implements TraceEvaluationDispatch {
  constructor(
    private readonly sendEvaluation: (
      data: ExecuteEvaluationCommandData,
      sendOptions?: QueueSendOptions<ExecuteEvaluationCommandData>,
    ) => Promise<void>,
  ) {}

  makeDedupId(data: ExecuteEvaluationCommandData): string {
    return ExecuteEvaluationCommand.makeJobId(data);
  }

  async send(
    data: ExecuteEvaluationCommandData,
    sendOptions?: QueueSendOptions<ExecuteEvaluationCommandData>,
  ): Promise<void> {
    await this.sendEvaluation(data, sendOptions);
  }
}
