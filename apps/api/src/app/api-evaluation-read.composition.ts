/**
 * The Evaluation capability the trace read stack reads through. Every single-trace read
 * asks for the evaluations behind that trace, and the grid asks for the summaries behind
 * a page of them.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import type { DataRetentionService } from "@langwatch/data-retention-contract";
import type { EvaluationService } from "@langwatch/evaluation-contract";
import {
  EvaluationAdapter,
  EvaluationExecutionPort,
  type EvaluationClickHouseResolver,
} from "@langwatch/evaluation-server";
import { TraceRetentionFloorService } from "@langwatch/trace-server";
import type { WorkflowService } from "@langwatch/workflow-contract";

/** Names the refusal, so a stand-in says which process reached it. */
function refuse(processName: string, capability: string): Error {
  return new Error(`${processName} composes no ${capability}`);
}

class UnavailableEvaluationExecution extends EvaluationExecutionPort {
  constructor(private readonly processName: string) {
    super();
  }

  execute(): Promise<never> {
    return Promise.reject(refuse(this.processName, "evaluator runtime for an evaluation read"));
  }
}

/**
 * A stand-in whose every member refuses by name.
 */
function refusingWorkflows(processName: string): WorkflowService {
  return new Proxy(
    {},
    {
      get: (_target, property) => () => {
        throw refuse(processName, `workflow capability for ${String(property)}`);
      },
    },
  ) as WorkflowService;
}

/** Composes the Evaluation reads a trace read resolves its evaluations through. */
export function composeApiEvaluationReads(options: {
  resolveClickHouseClient: (tenantId: string) => Promise<ClickHouseClient>;
  /** The project cascade the evaluation floor is bounded by. */
  dataRetention: DataRetentionService;
  processName: string;
}): EvaluationService {
  return EvaluationAdapter.create({
    // The driver's own client, narrowed to the two calls Evaluation makes of
    // it. The package declares its own structural client so it depends on no
    // driver; this is the one place the two meet, and the worker's evaluation
    // reads join them the same way.
    resolveClickHouse: options.resolveClickHouseClient as unknown as EvaluationClickHouseResolver,
    retentionFloor: TraceRetentionFloorService.create(options.dataRetention),
    execution: new UnavailableEvaluationExecution(options.processName),
    workflows: refusingWorkflows(options.processName),
  });
}
