import fetch from "node-fetch";
import { env } from "../../env.mjs";
import type { ElasticSearchSpan, Trace } from "../../server/tracer/types";
import type { Money } from "../../utils/types";
import type { RagasResult, TraceCheckResult } from "../types";
import { getRAGInfo } from "../../server/tracer/utils";

export const ragasFaithfulness = async (
  _trace: Trace,
  spans: ElasticSearchSpan[]
): Promise<TraceCheckResult> => {
  if (!env.LANGWATCH_GUARDRAILS_SERVICE) {
    throw new Error("LANGWATCH_GUARDRAILS_SERVICE not set");
  }

  const { input, output, contexts } = getRAGInfo(spans);

  const response = await fetch(
    `${env.LANGWATCH_GUARDRAILS_SERVICE}/ragas_eval`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        metrics: ["faithfulness"],
        question: input,
        answer: output,
        contexts: contexts,
        ground_truths: null,
        model: "gpt-3.5-turbo-1106",
      }),
    }
  );

  if (!response.ok) {
    throw new Error(
      `Ragas faithfulness check API returned an error: ${response.statusText}`
    );
  }

  const result = (await response.json()) as RagasResult;
  const faithfulnessScore = result.scores.faithfulness;
  const costs = result.costs;

  if (typeof faithfulnessScore === "undefined") {
    throw new Error(
      `Ragas answer relevancy check API did not return a score: ${JSON.stringify(
        result
      )}`
    );
  }

  return {
    raw_result: result,
    value: faithfulnessScore,
    status: faithfulnessScore > 0.3 ? "succeeded" : "failed",
    costs: [
      { amount: costs.amount, currency: costs.currency as Money["currency"] },
    ],
  };
};
