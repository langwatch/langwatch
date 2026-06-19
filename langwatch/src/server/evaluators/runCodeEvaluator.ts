import { nanoid } from "nanoid";
import { addEnvs } from "~/optimization_studio/server/addEnvs";
import type { ExecutionStatus } from "~/optimization_studio/types/dsl";
import type { StudioClientEvent } from "~/optimization_studio/types/events";
import type { SingleEvaluationResult } from "~/server/evaluations/evaluators.generated";
import { nlpgoFetch } from "~/server/nlpgo/nlpgoFetch";
import { prisma } from "../db";
import {
  buildCodeEvaluatorDsl,
  codeEvaluatorConfigSchema,
} from "./codeEvaluator";

const coerceResultScalars = (result: Record<string, unknown>) => {
  if (
    "score" in result &&
    (typeof result.score === "number" || typeof result.score === "string")
  ) {
    const parsed = parseFloat(`${result.score}`);
    result.score = Number.isNaN(parsed) ? 0 : parsed;
  }
  if (
    "passed" in result &&
    (typeof result.passed === "boolean" || typeof result.passed === "string")
  ) {
    result.passed = result.passed === true || `${result.passed}` === "true";
  }
  return result;
};

/**
 * Runs a stored code evaluator against already-mapped data, mirroring
 * customEvaluation's contract: data keys matching the evaluator inputs flow
 * into the code, and the returned outputs become the evaluation result.
 */
export async function runCodeEvaluator({
  projectId,
  evaluatorId,
  data,
  traceId,
  parentCausalityDepth,
  parentTrace,
}: {
  projectId: string;
  evaluatorId: string;
  data: Record<string, unknown>;
  traceId?: string;
  parentCausalityDepth?: number;
  parentTrace?: { traceId: string; parentSpanId: string };
}): Promise<SingleEvaluationResult> {
  try {
    const evaluator = await prisma.evaluator.findFirst({
      where: { id: evaluatorId, projectId, archivedAt: null },
    });
    if (!evaluator || evaluator.type !== "code") {
      throw new Error(`Code evaluator not found: ${evaluatorId}`);
    }
    const config = codeEvaluatorConfigSchema.parse(evaluator.config);

    const inputs: Record<string, string> = Object.fromEntries(
      config.inputs.map(({ identifier }) => {
        const value = data[identifier];
        return [
          identifier,
          value === null || value === undefined
            ? ""
            : typeof value === "string"
              ? value
              : JSON.stringify(value),
        ];
      }),
    );

    const event: StudioClientEvent = {
      type: "execute_flow",
      payload: {
        trace_id: traceId ?? `trace_${nanoid()}`,
        workflow: buildCodeEvaluatorDsl({ name: evaluator.name, config }),
        inputs: [inputs],
        manual_execution_mode: false,
        do_not_trace: false,
        run_evaluations: false,
        origin: "evaluation",
      },
    };

    const eventWithEnvs = await addEnvs(event, projectId);

    const response = await nlpgoFetch<{
      result: Record<string, unknown>;
      status: ExecutionStatus;
      error?: { message?: string; traceback?: string };
    }>({
      projectId,
      path: "/studio/execute_sync",
      body: eventWithEnvs,
      origin: "evaluation",
      causalityDepth: parentCausalityDepth ?? 0,
      parentTrace,
    });

    if (!response.ok) {
      throw new Error(`Error running code evaluator: ${response.statusText}`);
    }

    const { result, status, error } = await response.json();

    if (status !== "success") {
      // The engine reports failures in the error envelope (the raised
      // exception's message and traceback), not in result.
      return {
        status: "error",
        details: error?.message ?? "Code evaluator execution failed",
        error_type: "CODE_EVALUATOR_ERROR",
        traceback: error?.traceback ? [error.traceback] : [],
      };
    }

    return {
      ...coerceResultScalars(result ?? {}),
      status: "processed",
    } as SingleEvaluationResult;
  } catch (error) {
    return {
      status: "error",
      details: (error as Error).message,
      error_type: "CODE_EVALUATOR_ERROR",
      traceback: [(error as Error).stack ?? ""],
    };
  }
}
