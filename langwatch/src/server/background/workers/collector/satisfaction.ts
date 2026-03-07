import { prepareLitellmParams } from "~/server/api/routers/modelProviders";
import { getProjectEmbeddingsModel } from "~/server/embeddings";
import { env } from "../../../../env.mjs";
import { OPENAI_EMBEDDING_DIMENSION } from "../../../../utils/constants";
import { lambdaFetch } from "../../../../utils/lambdaFetch";
import { createLogger } from "../../../../utils/logger/server";
import { esClient, TRACE_INDEX, traceIndexId } from "../../../elasticsearch";
import type { Trace } from "../../../tracer/types";

const logger = createLogger("langwatch:workers:collector:satisfaction");

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

  if (!input?.value) {
    // "observedTraceId" = customer trace being processed, vs "traceId" = system OTEL context
    logger.debug(
      { observedTraceId: traceId },
      "trace input is empty, skipping satisfaction score",
    );
    return;
  }

  const embeddingsModel = await getProjectEmbeddingsModel(projectId);
  const response = await lambdaFetch<SatisfactionScoreResult>(
    process.env.LANGWATCH_NLP_SERVICE!,
    "/sentiment",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        project_id: projectId,
        text: input.value,
        embeddings_litellm_params: {
          ...(await prepareLitellmParams({
            model: embeddingsModel.model,
            modelProvider: embeddingsModel.modelProvider,
            projectId,
          })),
          dimensions: OPENAI_EMBEDDING_DIMENSION,
        },
      }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Score satisfaction check API returned an error: ${await response.text()}`,
    );
  }

  const result = (await response.json()) as SatisfactionScoreResult;

  const client = await esClient({ projectId });
  await client.update({
    index: TRACE_INDEX.alias,
    id: traceIndexId({ traceId: traceId, projectId: projectId }),
    retry_on_conflict: 10,
    body: {
      doc: {
        input: {
          satisfaction_score: result.score_normalized,
        },
      },
    },
  });
};
