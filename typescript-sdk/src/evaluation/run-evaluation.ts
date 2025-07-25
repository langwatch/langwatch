import { LangWatchApiError } from "../internal/api/errors";
import { canAutomaticallyCaptureInput, getApiKey, getEndpoint } from "../client";
import { Conversation } from "../internal/generated/types/evaluations";
import {
  Evaluators,
  EvaluatorTypes,
  SingleEvaluationResult,
} from "../internal/generated/types/evaluators.generated";
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
}

export interface SavedEvaluationDetails extends EvaluationDetailsBase {
  slug: string;
  settings?: Record<string, unknown>;
}

export interface LangEvalsEvaluationDetails<T extends EvaluatorTypes>
  extends EvaluationDetailsBase {
  evaluator: T;
  settings?: Evaluators[T]["settings"];
}

export type EvaluationDetails =
  | SavedEvaluationDetails
  | LangEvalsEvaluationDetails<EvaluatorTypes>;

export async function runEvaluation(
  details: EvaluationDetails,
): Promise<SingleEvaluationResult> {
  return await tracer.startActiveSpan("run evaluation", async (span) => {
    span.setType(details.asGuardrail ? "guardrail" : "evaluation");

    try {
      const evaluatorId =
        "slug" in details ? details.slug : details.evaluator;
      const request = {
        trace_id: span.spanContext().traceId,
        span_id: span.spanContext().spanId,
        data: details.data,
        name: details.name,
        settings: details.settings,
        as_guardrail: details.asGuardrail,
      };

      if (canAutomaticallyCaptureInput()) {
        span.setInput(request);
      }

      const url = new URL(
        "/api/evaluations/${evaluatorId}/evaluate",
        getEndpoint(),
      );

      const response = await fetch(url.toString(), {
        method: "POST",
        headers: {
          "X-Auth-Token": getApiKey(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      });
      if (!response.ok) {
        const err = new LangWatchApiError("Unable to run evaluation", response);
        await err.safeParseBody(response);

        throw err;
      }

      const result: EvaluationResultModel = await response.json();

      span.setMetrics({
        cost: result.cost?.amount,
      });

      span.setOutputEvaluation(details.asGuardrail ?? false, result);

      if (result.status === "processed") {
        return {
          status: "processed",
          passed: result.passed,
          score: result.score,
          details: result.details,
          label: result.label,
          cost: result.cost,
        } as SingleEvaluationResult;
      } else if (result.status === "skipped") {
        return {
          status: "skipped",
          details: result.details,
        } as SingleEvaluationResult;
      } else if (result.status === "error") {
        return {
          status: "error",
          error_type: (result as any).error_type || "Unknown",
          details: result.details || "Unknown error",
          traceback: (result as any).traceback || [],
        } as SingleEvaluationResult;
      } else {
        return {
          status: "error",
          error_type: "UnknownStatus",
          details: `Unknown evaluation status: ${result.status}`,
          traceback: [],
        } as SingleEvaluationResult;
      }
    } catch (error) {
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  });
}
