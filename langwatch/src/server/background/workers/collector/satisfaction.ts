import { getProjectEmbeddingsModel } from "~/server/embeddings";
import { env } from "../../../../env.mjs";
import { TRACE_INDEX, esClient, traceIndexId } from "../../../elasticsearch";
import type { Trace } from "../../../tracer/types";
import { prepareLitellmParams } from "~/server/api/routers/modelProviders";

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

  const embeddingsModel = await getProjectEmbeddingsModel(projectId);
  const response = await fetch(`${env.LANGWATCH_NLP_SERVICE}/sentiment`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      vector: input.embeddings.embeddings,
      embeddings_litellm_params: prepareLitellmParams(
        embeddingsModel.model,
        embeddingsModel.modelProvider
      ),
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Score satisfaction check API returned an error: ${await response.text()}`
    );
  }

  const result = (await response.json()) as SatisfactionScoreResult;

  await esClient.update({
    index: TRACE_INDEX.alias,
    id: traceIndexId({ traceId: traceId, projectId: projectId }),
    retry_on_conflict: 5,
    body: {
      doc: {
        input: {
          satisfaction_score: result.score_normalized,
        },
      },
    },
  });
};
