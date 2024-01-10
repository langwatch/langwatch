import { env } from "../../../env.mjs";
import { TRACE_INDEX, esClient } from "../../../server/elasticsearch";
import type { Trace } from "../../../server/tracer/types";

type SatisfactionScoreResult = {
  score_normalized: number;
  score_raw: number;
  score_positive: number;
  score_negative: number;
  label: string;
};

export const scoreSatisfactionFromInput = async (
  trace_id: string,
  input: Trace["input"]
): Promise<void> => {
  if (!env.LANGWATCH_GUARDRAILS_SERVICE) {
    throw new Error("LANGWATCH_GUARDRAILS_SERVICE not set");
  }

  if (!input.openai_embeddings) {
    console.warn(`Trace ID ${trace_id} input does not have embeddings, skipping the job`);
    return;
  }

  const response = await fetch(
    `${env.LANGWATCH_GUARDRAILS_SERVICE}/sentiment`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        vector: input.openai_embeddings,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(
      `Inconsistency check API returned an error: ${response.statusText}`
    );
  }

  const result = (await response.json()) as SatisfactionScoreResult;

  await esClient.update({
    index: TRACE_INDEX,
    id: trace_id,
    body: {
      doc: {
        input: {
          satisfaction_score: result.score_normalized,
        },
      },
    },
  });
};
