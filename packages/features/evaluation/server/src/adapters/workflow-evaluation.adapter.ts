import {
  singleEvaluationResultSchema,
  type SingleEvaluationResult,
} from "@langwatch/evaluator-contract";
import type { ExecutionStatus, WorkflowService } from "@langwatch/workflow-contract";
import { z } from "zod";

const workflowExecutionResponseSchema = z.object({
  result: z.record(z.string(), z.unknown()).nullable().optional(),
  status: z.enum(["idle", "waiting", "running", "success", "error", "skipped"]),
});

/** Compatibility adapter from Workflow execution to Evaluation's result contract. */
export class WorkflowEvaluationAdapter {
  static create(workflows: WorkflowService): WorkflowEvaluationAdapter {
    return new WorkflowEvaluationAdapter(workflows);
  }

  private constructor(private readonly workflows: WorkflowService) {}

  async run(input: {
    workflowId: string;
    projectId: string;
    inputs: Record<string, unknown>;
    versionId?: string;
    causalityDepth?: number;
    parentTrace?: { traceId: string; parentSpanId: string };
  }): Promise<{ result: SingleEvaluationResult; status: ExecutionStatus }> {
    try {
      const response = await this.workflows.run({
        workflowId: input.workflowId,
        projectId: input.projectId,
        inputs: input.inputs,
        versionId: input.versionId,
        doNotTrace: false,
        runEvaluations: false,
        origin: "evaluation",
        causalityDepth: input.causalityDepth ?? 0,
        parentTrace: input.parentTrace,
      });

      return this.normalize(response);
    } catch (error) {
      return {
        status: "error",
        result: singleEvaluationResultSchema.parse({
          status: "error",
          details: error instanceof Error ? error.message : "Workflow execution failed",
          error_type: "WORKFLOW_ERROR",
          traceback: [error instanceof Error ? (error.stack ?? "") : ""],
        }),
      };
    }
  }

  private normalize(value: unknown): {
    result: SingleEvaluationResult;
    status: ExecutionStatus;
  } {
    const response = workflowExecutionResponseSchema.parse(value);
    if (!response.result) {
      throw new Error("Workflow execution returned an invalid result.");
    }

    const score = response.result.score;
    const passed = response.result.passed;
    const normalized: Record<string, unknown> = {
      ...response.result,
      ...(typeof score === "number" || typeof score === "string"
        ? { score: Number.parseFloat(String(score)) || 0 }
        : {}),
      ...(typeof passed === "boolean" || typeof passed === "string"
        ? { passed: passed === true || passed === "true" }
        : {}),
    };
    if (response.status === "success") {
      return {
        status: response.status,
        result: singleEvaluationResultSchema.parse({
          ...normalized,
          status: "processed",
        }),
      };
    }

    return {
      status: response.status,
      result: singleEvaluationResultSchema.parse({
        status: "error",
        details:
          typeof normalized.details === "string" ? normalized.details : "Workflow execution failed",
        error_type:
          typeof normalized.error_type === "string" ? normalized.error_type : "WORKFLOW_ERROR",
        traceback: Array.isArray(normalized.traceback)
          ? normalized.traceback.filter((entry): entry is string => typeof entry === "string")
          : [],
      }),
    };
  }
}
