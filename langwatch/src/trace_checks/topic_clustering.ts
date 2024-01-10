import { env } from "../env.mjs";
import type { Trace } from "../server/tracer/types";
import { TRACE_INDEX, esClient } from "../server/elasticsearch";
import { getDebugger } from "../utils/logger";
import type { Money } from "../utils/types";
import { prisma } from "../server/db";
import { nanoid } from "nanoid";
import { CostReferenceType, CostType } from "@prisma/client";

const debug = getDebugger("langwatch:topicClustering");

export const clusterTopicsForProject = async (
  projectId: string
): Promise<void> => {
  // Fetch last 10k traces for the project in last 3 months, with only id, input fields and their topics
  const result = await esClient.search<Trace>({
    index: TRACE_INDEX,
    body: {
      query: {
        //@ts-ignore
        bool: {
          must: [
            {
              term: { project_id: projectId },
            },
            {
              range: {
                "timestamps.inserted_at": {
                  gte: "now-3M",
                  lt: "now",
                },
              },
            },
          ],
        },
      },
      _source: ["id", "input", "topics"],
      size: 10000,
    },
  });

  const traces = result.hits.hits
    .map((hit) => hit._source!)
    .filter((hit) => hit);

  if (traces.length === 0) {
    debug(
      "No traces found for project",
      projectId,
      "skipping topic clustering"
    );
    return;
  }

  debug("Clustering topics for", traces.length, "traces on project", projectId);
  const clusteringResult = await clusterTopicsForTraces({
    topics: traces.flatMap((trace) => trace.topics ?? []),
    file: traces
      .map((trace) => ({
        _source: {
          id: trace.id,
          input: trace.input,
        },
      }))
      .filter(
        (trace) =>
          !!trace._source.input.openai_embeddings && !!trace._source.input.value
      ),
  });

  const topics = clusteringResult?.message_clusters ?? {};
  const cost = clusteringResult?.costs;

  debug(
    "Found topics for",
    Object.keys(topics).length,
    "traces for project",
    projectId,
    "- Updating ElasticSearch"
  );
  const body = Object.entries(topics).flatMap(([traceId, topic]) => [
    { update: { _id: traceId } },
    { doc: { topics: [topic] } },
  ]);

  await esClient.bulk({
    index: TRACE_INDEX,
    refresh: true,
    body,
  });

  if (cost) {
    await prisma.cost.create({
      data: {
        id: `cost_${nanoid()}`,
        projectId: projectId,
        costType: CostType.CLUSTERING,
        costName: "Topics Clustering",
        referenceType: CostReferenceType.PROJECT,
        referenceId: projectId,
        amount: cost.amount,
        currency: cost.currency,
        extraInfo: {
          traces_count: traces.length,
          topics_count: Object.keys(topics).length,
        },
      },
    });
  }

  debug("Done! Project", projectId);
};

export type TopicClusteringParams = {
  topics: string[];
  file: { _source: { id: string; input: Trace["input"] } }[];
};

type ClusteringResult = {
  message_clusters: Record<string, string>;
  costs: Money;
};

export const clusterTopicsForTraces = async (
  params: TopicClusteringParams
): Promise<ClusteringResult | undefined> => {
  if (!env.LANGWATCH_GUARDRAILS_SERVICE) {
    console.warn(
      "Topic clustering service URL not set, skipping topic clustering"
    );
    return;
  }

  const formData = new FormData();
  formData.append("categories", params.topics.join(",") || " ");

  const file = new File(
    [params.file.map((line) => JSON.stringify(line)).join("\n")],
    "traces.jsonl",
    { type: "application/jsonl" }
  );
  formData.append("file", file);

  const response = await fetch(`${env.LANGWATCH_GUARDRAILS_SERVICE}/topics`, {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    throw new Error(
      `TopicClustering service returned error: ${await response.text()}`
    );
  }
  const result: ClusteringResult = await response.json();

  return result;
};
