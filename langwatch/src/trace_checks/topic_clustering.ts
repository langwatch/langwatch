import { env } from "../env.mjs";
import type { Trace } from "../server/tracer/types";
import { esClient } from "../server/elasticsearch";
import { TRACE_INDEX } from "../server/api/routers/traces";
import { getDebugger } from "../utils/logger";

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
  const topics = await clusterTopicsForTraces({
    topics: traces.flatMap((trace) => trace.topics ?? []),
    file: traces.map((trace) => ({
      _source: {
        id: trace.id,
        input: trace.input,
      },
    })),
  });

  console.log("topics", topics);

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

  debug("Done! Project", projectId);
};

export type TopicClusteringParams = {
  topics: string[];
  file: { _source: { id: string; input: Trace["input"] } }[];
};

export const clusterTopicsForTraces = async (
  params: TopicClusteringParams
): Promise<Record<string, string>> => {
  if (!env.TOPIC_CLUSTERING_SERVICE_URL) {
    console.warn(
      "TopicClustering service URL not set, skipping topicClustering"
    );
    return {};
  }

  const formData = new FormData();
  formData.append("categories", params.topics.join(",") || " ");

  const file = new File(
    [params.file.map((line) => JSON.stringify(line)).join("\n")],
    "traces.jsonl",
    { type: "application/jsonl" }
  );
  formData.append("file", file);

  const response = await fetch(env.TOPIC_CLUSTERING_SERVICE_URL, {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    throw new Error(
      `TopicClustering service returned error: ${await response.text()}`
    );
  }
  const topics: Record<string, string> = await response.json();

  return topics;
};
