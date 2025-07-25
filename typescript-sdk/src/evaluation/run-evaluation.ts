import { Conversation } from "../internal/generated/types/evaluations";
import { Evaluators, EvaluatorTypes, SingleEvaluationResult } from "../internal/generated/types/evaluators.generated";
import { RAGChunk } from "../internal/generated/types/tracer";
import { tracer } from "./tracer";
import { EvaluationError, EvaluationResultModel } from "./types";

export interface BasicEvaluationData {
  input?: string;
  output?: string;
  expected_output?: unknown;
  contexts?: RAGChunk[] | string[];
  expected_contexts?: RAGChunk[] | string[];
  conversation?: Conversation;
}

export interface EvaluationDetailsBase {
  name?: string;
  data: BasicEvaluationData | Record<string, unknown>;
  contexts?: RAGChunk[] | string[];
  conversation?: Conversation;
  asGuardrail?: boolean;
};

export interface SavedEvaluationDetails extends EvaluationDetailsBase {
  slug: string;
  settings?: Record<string, unknown>;
};

export interface LangEvalsEvaluationDetails<T extends EvaluatorTypes> extends EvaluationDetailsBase {
  evaluator: T;
  settings?: Evaluators[T]["settings"];
};

export type EvaluationDetails =
  | SavedEvaluationDetails
  | LangEvalsEvaluationDetails<EvaluatorTypes>;

export async function runEvaluation(details: EvaluationDetails): Promise<SingleEvaluationResult> {
  return await new Promise((resolve, reject) => {
    tracer.startActiveSpan("run_evaluation", async (span) => {
      span.setType(details.asGuardrail ? "guardrail" : "evaluation");

      try {
        const evaluatorId = "slug" in details ? details.slug : details.evaluator;
        const request = {
          trace_id: span.spanContext().traceId,
          span_id: span.spanContext().spanId,
          data: details.data,
          name: details.name,
          settings: details.settings,
          as_guardrail: details.asGuardrail,
        };

        span.setInput(request);

        const response = await fetch(
          `${process.env.LANGWATCH_ENDPOINT}/api/evaluations/${evaluatorId}/evaluate`,
          {
            method: "POST",
            headers: {
              "X-Auth-Token": process.env.LANGWATCH_API_KEY ?? "",
              "Content-Type": "application/json",
            },
            body: JSON.stringify(request),
          }
        );
        if (!response.ok) {
          throw new EvaluationError("Unable to run evaluation", response.status, await safeBodyReadAttempt(response));
        }

        const result: EvaluationResultModel = await response.json();

        span.setMetrics({
          cost: result.cost?.amount,
        });

        span.setOutputEvaluation(details.asGuardrail ?? false, result);

        if (result.status === "processed") {
          resolve({
            status: "processed",
            passed: result.passed,
            score: result.score,
            details: result.details,
            label: result.label,
            cost: result.cost,
          });
        } else if (result.status === "skipped") {
          resolve({
            status: "skipped",
            details: result.details,
          });
        } else if (result.status === "error") {
          resolve({
            status: "error",
            error_type: (result as any).error_type || "Unknown",
            details: result.details || "Unknown error",
            traceback: (result as any).traceback || [],
          });
        } else {
          resolve({
            status: "error",
            error_type: "UnknownStatus",
            details: `Unknown evaluation status: ${result.status}`,
            traceback: [],
          });
        }
      } catch(error) {
        reject(error);
        span.recordException(error as Error);
      } finally {
        span.end();
      }
    });
  });
}

async function safeBodyReadAttempt(response: Response): Promise<unknown | null> {
  try {
    if (response.headers.get("Content-Type")?.includes("application/json")) {
      return await response.json();
    }

    return await response.text();
  } catch {
    return null;
  }
}
