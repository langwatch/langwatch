/**
 * The Evaluation capability the trace read stack reads through.
 *
 * Every single-trace read asks for the evaluations behind that trace, and the
 * grid asks for the summaries behind a page of them. Both go through
 * `EvaluationService`, so a process that serves either has to compose one —
 * left absent, the single-trace read threw a plain `Error` and answered a 500
 * to a route that was working (finding F3 of
 * `dev/docs/plans/e2e-walk-2026-09-04.md`).
 *
 * What this composes is the READ half and says so. `executeForTrace` needs an
 * evaluator runtime and a workflow capability the read path never reaches, and
 * this process's evaluation execution arrives by a different door, so both
 * refuse by name rather than being synthesised.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import type { DataRetentionService } from "@langwatch/data-retention-contract";
import type { EvaluationService } from "@langwatch/evaluation-contract";
import {
  EvaluationAdapter,
  EvaluationExecutionPort,
  type EvaluationClickHouseResolver,
} from "@langwatch/evaluation-server";
import { createRetentionFloorService } from "@langwatch/trace-server";
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
 *
 * A proxy rather than an object literal because this is a collaborator
 * interface another package declares: writing out each member would be a
 * second declaration of somebody else's interface, and the copy is what goes
 * stale when the real one grows a method.
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
    retentionFloor: createRetentionFloorService(options.dataRetention),
    execution: new UnavailableEvaluationExecution(options.processName),
    workflows: refusingWorkflows(options.processName),
  });
}
