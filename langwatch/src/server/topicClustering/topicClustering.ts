import { env } from "../../env.mjs";
import type { ElasticSearchTrace, Trace } from "../tracer/types";
import { TRACE_INDEX, esClient, traceIndexId } from "../elasticsearch";
import { getDebugger } from "../../utils/logger";
import type { Money } from "../../utils/types";
import http2 from "http2";
import FormData from "form-data";
import { prisma } from "../db";
import { nanoid } from "nanoid";
import { CostReferenceType, CostType } from "@prisma/client";
import { scheduleTopicClusteringNextPage } from "../background/queues/topicClusteringQueue";

const debug = getDebugger("langwatch:topicClustering");

export const clusterTopicsForProject = async (
  projectId: string,
  searchAfter?: [number, string],
  scheduleNextPage = true
): Promise<void> => {
  const tracesCount = await esClient.count({
    index: TRACE_INDEX,
    body: {
      query: {
        term: {
          project_id: projectId,
        },
      },
    },
  });

  // We do not re-cluster the messages unless there is less than 1k because that would be very little to settle on clusters
  let presenceCondition = {};
  if (tracesCount.count > 1000) {
    presenceCondition = {
      must_not: {
        exists: {
          field: "metadata.topics",
        },
      },
    };
  }

  // Fetch last 1000 traces that were not classified in last 3 months, sorted and paginated, with only id, input fields and their topics
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
          ...presenceCondition,
        },
      },
      _source: ["trace_id", "input"],
      sort: [{ "timestamps.inserted_at": "asc" }, { trace_id: "asc" }],
      ...(searchAfter ? { search_after: searchAfter } : {}),
      size: 1000,
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

  await clusterTraces(projectId, traces);

  // If results are not close to empty, schedule the seek for next page
  if (result.hits.hits.length > 10) {
    const lastTraceSort = result.hits.hits.reverse()[0]?.sort as
      | [number, string]
      | undefined;
    if (lastTraceSort) {
      debug(
        "Scheduling the next page for clustering for project",
        projectId,
        "next page",
        lastTraceSort
      );
      if (scheduleNextPage) {
        await scheduleTopicClusteringNextPage(projectId, lastTraceSort);
      } else {
        debug("Skipping scheduling next page for project", projectId, "which would be", lastTraceSort);
      }
    }
  }

  debug("Done! Project", projectId);
};

export const clusterTraces = async (projectId: string, traces: Trace[]) => {
  const topicsAgg = await esClient.search({
    index: TRACE_INDEX,
    body: {
      size: 0, // We don't need the actual documents, just the aggregation
      query: {
        term: {
          project_id: projectId,
        },
      },
      aggs: {
        unique_topics: {
          terms: {
            field: "metadata.topics",
            size: 10000,
          },
        },
      },
    },
  });

  const existingTopics = (
    topicsAgg.aggregations?.unique_topics as any
  )?.buckets.map((bucket: any) => bucket.key);

  debug("Clustering topics for", traces.length, "traces on project", projectId);
  const clusteringResult = await clusterTopicsForTraces(projectId, {
    topics: existingTopics,
    file: traces
      .map((trace) => ({
        _source: {
          id: trace.trace_id,
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
    Object.keys(topics).length > 0
      ? "- Updating ElasticSearch"
      : "- Skipping ElasticSearch update"
  );
  const body = Object.entries(topics).flatMap(([traceId, topic]) => [
    { update: { _id: traceIndexId({ traceId, projectId }) } },
    {
      doc: {
        metadata: { topics: [topic] },
        timestamps: { updated_at: Date.now() },
      } as Partial<ElasticSearchTrace>,
    },
  ]);

  if (body.length > 0) {
    await esClient.bulk({
      index: TRACE_INDEX,
      refresh: true,
      body,
    });
  }

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
  projectId: string,
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

  const fileContent = params.file
    .map((line) => JSON.stringify(line))
    .join("\n");
  debug(
    "Uploading",
    fileContent.length / 125000,
    "mb of traces data for project",
    projectId
  );

  const buffer = Buffer.from(fileContent);
  formData.append("file", buffer, {
    filename: "traces.jsonl",
    contentType: "application/jsonl",
  });

  const headers = Object.assign({}, formData.getHeaders(), {
    ":method": "POST",
    ":path": "/topics",
  });

  // HTTP/2 on Google Cloud Run has no payload limit, where HTTP/1.1 has a 32mb limit
  // which we cannot increase, so here we have to force HTTP/2 to be used
  // Create an HTTP/2 client
  const client = http2.connect(env.LANGWATCH_GUARDRAILS_SERVICE);

  // Convert FormData to a readable stream
  const formBuffer = formData.getBuffer();
  const req = client.request(headers);
  req.end(formBuffer);

  return await new Promise((resolve, reject) => {
    let status: string | undefined;
    req.on("response", (headers, _flags) => {
      status = headers[":status"]?.toString();
    });

    req.setEncoding("utf8");
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });

    req.on("error", (err) => {
      reject(err);
    });

    req.on("end", () => {
      client.close();
      if (
        status &&
        (parseInt(status, 10) < 200 || parseInt(status, 10) > 299)
      ) {
        reject(
          new Error(`TopicClustering service returned error: ${status} ${data}`)
        );
        return;
      }

      try {
        const result: ClusteringResult = JSON.parse(data);
        resolve(result);
      } catch (err) {
        reject(err);
      }
    });
  });
};
