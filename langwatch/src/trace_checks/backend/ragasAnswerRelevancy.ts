import fetch from "node-fetch";
import type { Trace } from "../../server/tracer/types";
import type { TraceCheckResult, RagasResult } from "../types";
import { env } from "../../env.mjs";
import type { Money } from "../../utils/types";

export const ragasAnswerRelevancy = async (
  trace: Trace
): Promise<TraceCheckResult> => {
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
        model: "gpt-3.5-turbo-0613",
      }),
    }
  );

  if (!response.ok) {
    throw new Error(
      `Ragas answer relevancy check API returned an error: ${response.statusText}`
    );
  }

  const result = (await response.json()) as RagasResult;
  const relevancyScore = result.scores.answer_relevancy;
  const costs = result.costs;

  if (typeof relevancyScore === "undefined") {
    throw new Error(
      `Ragas answer relevancy check API did not return a score: ${JSON.stringify(
        result
      )}`
    );
  }

  return {
    raw_result: result,
    value: relevancyScore,
    status: relevancyScore > 0.5 ? "succeeded" : "failed",
    costs: [
      { amount: costs.amount, currency: costs.currency as Money["currency"] },
    ],
  };
};
