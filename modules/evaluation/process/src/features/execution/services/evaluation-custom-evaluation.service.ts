import type { EvaluatorApi, SingleEvaluationResult } from "@langwatch/evaluator-contract";
import { getCodeEvaluatorId, isCodeEvaluatorCheckType } from "@langwatch/evaluator-contract";
import { EvaluatorConfigError } from "@langwatch/model-provider-contract";
import type { Trace } from "@langwatch/trace-contract";

import { extractParentTraceForNlpgo } from "../../../rules/evaluation-causality.rules.ts";
import type { WorkflowEvaluationService } from "../../evaluators/services/workflow-evaluation.service.ts";

export type EvaluationCustomEvaluationDeps = Readonly<{
  evaluators: Pick<EvaluatorApi, "executeCode">;
  workflowExecutor: Pick<WorkflowEvaluationService, "run">;
}>;

type CustomEvaluationParams = {
  projectId: string;
  evaluatorType: string;
  data: Record<string, unknown>;
  trace?: Trace;
  workflowId?: string | null;
  parentCausalityDepth?: number;
};

/** A custom evaluator: a code evaluator answers in-process; anything else is a workflow run. */
export class EvaluationCustomEvaluationService {
  static create(deps: EvaluationCustomEvaluationDeps): EvaluationCustomEvaluationService {
    return new EvaluationCustomEvaluationService(deps);
  }

  private constructor(private readonly deps: EvaluationCustomEvaluationDeps) {}

  async run(params: CustomEvaluationParams): Promise<SingleEvaluationResult> {
    const { projectId, evaluatorType, data, trace, parentCausalityDepth } = params;
    if (isCodeEvaluatorCheckType(evaluatorType)) {
      return this.deps.evaluators.executeCode({
        projectId,
        evaluatorId: getCodeEvaluatorId(evaluatorType),
        data,
        traceId: trace?.trace_id,
        parentCausalityDepth,
        parentTrace: extractParentTraceForNlpgo(trace),
      });
    }

    return this.runWorkflow(params);
  }

  private async runWorkflow({
    projectId,
    evaluatorType,
    data,
    trace,
    workflowId,
    parentCausalityDepth,
  }: CustomEvaluationParams): Promise<SingleEvaluationResult> {
    const resolvedWorkflowId = workflowId ?? evaluatorType.split("/")[1];

    if (!resolvedWorkflowId) {
      throw new EvaluatorConfigError("Workflow ID is required");
    }

    const requestBody: Record<string, unknown> = {
      trace_id: trace?.trace_id,
      do_not_trace: true,
      ...data,
    };

    // W3C trace context: link the eval workflow's spans to the parent
    // trace's root span so Studio's waterfall renders them as a child
    // sub-tree (not a separate orphan trace, which is the 2026-05-14
    // bug rchaves caught in prod).
    const parentTrace = extractParentTraceForNlpgo(trace);

    const response = await this.deps.workflowExecutor.run({
      workflowId: resolvedWorkflowId,
      projectId,
      inputs: requestBody as Record<string, string>,
      causalityDepth: parentCausalityDepth,
      ...(parentTrace === undefined ? {} : { parentTrace }),
    });

    if (response.status !== "success") {
      return { ...response.result, status: "error" } as SingleEvaluationResult;
    }

    return { ...response.result, status: "processed" };
  }
}
