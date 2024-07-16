import { env } from "../../../env.mjs";
import {
  TRACE_INDEX,
  esClient,
  traceIndexId,
} from "../../../server/elasticsearch";
import type { Trace } from "../../../server/tracer/types";

type SatisfactionScoreResult = {
  score_normalized: number;
  score_raw: number;
  score_positive: number;
  score_negative: number;
  label: string;
};

export const scoreSatisfactionFromInput = async ({
  traceId,
  projectId,
  input,
}: {
  traceId: string;
  projectId: string;
  input: Trace["input"];
}): Promise<void> => {
  if (!env.LANGWATCH_NLP_SERVICE) {
    throw new Error("LANGWATCH_NLP_SERVICE not set");
  }

  if (!input?.embeddings) {
    console.warn(
      `Trace ID ${traceId} input does not have embeddings, skipping the job`
    );
    return;
  }

  const response = await fetch(
    `${env.LANGWATCH_NLP_SERVICE}/sentiment`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        vector: input.embeddings.embeddings,
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
    id: traceIndexId({ traceId: traceId, projectId: projectId }),
    body: {
      doc: {
        input: {
          satisfaction_score: result.score_normalized,
        },
      },
    },
  });
};
