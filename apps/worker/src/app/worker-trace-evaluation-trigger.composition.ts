import type { ExecuteEvaluationCommandData } from "@langwatch/evaluation-contract";
import { ExecuteEvaluationCommand } from "@langwatch/evaluation-server";
import type { QueueSendOptions } from "@langwatch/eventing";
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import type { MonitorService } from "@langwatch/monitor-contract";
import {
  OtelTraceEvaluationLoopMetricsAdapter,
  TraceEvaluationDispatchPort,
  createEvaluationTriggerSubscriber,
  type TraceEvaluationLoopMetricsPort,
  type TraceEvaluationMonitorPort,
  type TraceSummarySubscriber,
} from "@langwatch/trace-server";
import { createWorkerTraceEvaluationMonitorPort } from "./worker-trace-narrow-ports.composition";

/**
 * The online evaluations this process would dispatch for an ingested trace.
 *
 * STAGED, NOT MOUNTED. Trace has not converted — the application still
 * registers `evaluationTrigger` on its own pipeline — so nothing in this
 * process evaluates anything yet. What has to be true today is that this
 * composition root CAN build the subscriber from what it already holds: a
 * monitor service, a feature-flag service, and the queue send the conversion
 * hands it.
 *
 *     TraceSummarySubscriber "evaluationTrigger"   (trace-server owns it)
 *       ├─ FeatureFlagService                      the loop-guard kill switch
 *       ├─ TraceEvaluationMonitorPort              the enabled on-message monitors
 *       │    └─ MonitorService                     narrowed to one listing
 *       ├─ TraceEvaluationLoopMetricsPort          the guard's own counter
 *       │    └─ OtelTraceEvaluationLoopMetricsAdapter
 *       └─ TraceEvaluationDispatchPort             one evaluation run
 *            ├─ ExecuteEvaluationCommand.makeJobId the dedup identity
 *            └─ the process's evaluation queue     the transport
 *
 * WHY THE DISPATCH IS A PORT AND NOT AN IMPORT. `architecture-lint`'s
 * `cross-feature` policy forbids a feature server from depending on another
 * feature's server package, and `ExecuteEvaluationCommand` lives in
 * `@langwatch/evaluation-server`. That is not a technicality here: the trace
 * subscriber needs exactly two things out of Evaluation — the payload type and
 * the dedup key — and taking the package would have brought the evaluator
 * engine, its ClickHouse writers and its intents with it. The composition root
 * is where the two features meet, which is this file.
 *
 * THE DEDUP KEY IS EVALUATION'S OWN. It is `makeJobId` and not a string built
 * here: the queue squashes a second dispatch against it, so a key spelled
 * differently on either side does not collide and the same evaluation runs
 * twice — a duplicate charge and a duplicate result row, with nothing to show
 * which of the two the customer is looking at.
 */
export function createWorkerTraceEvaluationTrigger(options: {
  monitors: MonitorService;
  featureFlags: FeatureFlagService;
  sendEvaluation: (
    data: ExecuteEvaluationCommandData,
    sendOptions?: QueueSendOptions<ExecuteEvaluationCommandData>,
  ) => Promise<void>;
  metrics?: TraceEvaluationLoopMetricsPort;
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
    readonly monitors: TraceEvaluationMonitorPort,
    readonly dispatch: TraceEvaluationDispatchPort,
    private readonly built: TraceSummarySubscriber,
  ) {}

  /** The named subscriber spec the trace pipeline registers. */
  subscriber(): TraceSummarySubscriber {
    return this.built;
  }
}

/**
 * Pairs the process's evaluation queue with Evaluation's own dedup identity.
 *
 * The two halves come from different places on purpose: the transport is this
 * process's, and the key is the evaluation command's, so both graphs squash
 * against the same string while both are ingesting.
 */
class WorkerTraceEvaluationDispatchAdapter extends TraceEvaluationDispatchPort {
  constructor(
    private readonly sendEvaluation: (
      data: ExecuteEvaluationCommandData,
      sendOptions?: QueueSendOptions<ExecuteEvaluationCommandData>,
    ) => Promise<void>,
  ) {
    super();
  }

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
