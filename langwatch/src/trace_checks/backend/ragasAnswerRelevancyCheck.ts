import fetch from "node-fetch";
import type { Trace } from "../../server/tracer/types";
import type {
  TraceCheckResult,
  TraceCheckBackendDefinition,
  RagasResult,
} from "../types";
import { env } from "../../env.mjs";
import type { Money } from "../../utils/types";

const execute = async (trace: Trace): Promise<TraceCheckResult> => {
  if (!env.LANGWATCH_GUARDRAILS_SERVICE) {
    throw new Error("LANGWATCH_GUARDRAILS_SERVICE not set");
  }

  const response = await fetch(
    `${env.LANGWATCH_GUARDRAILS_SERVICE}/ragas_eval`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        metrics: ["answer_relevancy"],
        question: trace.input.value,
        answer: trace.output?.value ?? "",
        contexts: null,
        ground_truths: null,
        model: "gpt-3.5-turbo-1106",
      }),
    }
  );

  if (!response.ok) {
    throw new Error(
      `RAGAS answer relevancy check API returned an error: ${response.statusText}`
    );
  }

  const result = (await response.json()) as RagasResult;
  const relevancyScore = result.scores.answer_relevancy ?? 0;
  const costs = result.costs;

  return {
    raw_result: result,
    value: relevancyScore,
    status: relevancyScore > 0.5 ? "succeeded" : "failed",
    costs: [
      { amount: costs.amount, currency: costs.currency as Money["currency"] },
    ],
  };
};

export const RagasAnswerRelevancyCheck: TraceCheckBackendDefinition<"ragas_answer_relevancy"> =
  {
    execute,
  };
