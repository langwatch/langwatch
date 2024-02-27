import fetch from "node-fetch";
import { env } from "../../env.mjs";
import type { ElasticSearchSpan, Trace } from "../../server/tracer/types";
import type { Money } from "../../utils/types";
import type { RagasResult, TraceCheckResult } from "../types";
import { getRAGInfo } from "../../server/tracer/utils";

export const ragasContextPrecision = async (
  trace: Trace,
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
        metrics: ["context_precision"],
        question: input,
        answer: output,
        contexts: contexts,
        ground_truth: null,
        model: "gpt-3.5-turbo-1106",
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(
      `Ragas context precision check API returned an error: ${error} for trace ${trace.trace_id}`
    );
  }

  const result = (await response.json()) as RagasResult;
  const contextPrecisionScore = result.scores.context_precision;
  const costs = result.costs;

  if (typeof contextPrecisionScore === "undefined") {
    throw new Error(
      `Ragas context precision check API did not return a score: ${JSON.stringify(
        result
      )}`
    );
  }

  return {
    raw_result: result,
    value: contextPrecisionScore,
    status: contextPrecisionScore > 0.3 ? "succeeded" : "failed",
    costs: [
      { amount: costs.amount, currency: costs.currency as Money["currency"] },
    ],
  };
};
