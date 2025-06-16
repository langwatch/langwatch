import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  clusterTopicsForProject,
  fetchTopicsBatchClustering,
} from "./topicClustering";
import { TRACE_INDEX, esClient, traceIndexId } from "../elasticsearch";
import type { Trace } from "../tracer/types";
import { CostType } from "@prisma/client";
import { prisma } from "../db";
import type { TopicClusteringTrace } from "./types";
import { getTestProject } from "../../utils/testUtils";

describe.skip("Topic Clustering Integration Test", () => {
  let testProjectId: string;
  const traces: Partial<TopicClusteringTrace>[] = [
    {
      trace_id: "trace_1",
      input: "hey there, how is it going?",
    },
    {
      trace_id: "trace_2",
      input: "hi, what is up?",
    },
    {
      trace_id: "trace_3",
      input: "please repeat",
    },
    {
      trace_id: "trace_4",
      input: "sorry, can you repeat?",
    },
    {
      trace_id: "trace_5",
      input: "hey there, how is it going??",
    },
    {
      trace_id: "trace_6",
      input: "hi, what is up??",
    },
    {
      trace_id: "trace_7",
      input: "please repeat!",
    },
    {
      trace_id: "trace_8",
      input: "sorry, can you repeat??",
    },
    {
      trace_id: "trace_9",
      input: "hey there, how is it going???",
    },
    {
      trace_id: "trace_10",
      input: "hi, what is up???",
    },
    {
      trace_id: "trace_11",
      input: "please repeat!!",
    },
    {
      trace_id: "trace_12",
      input: "sorry, can you repeat???",
    },
    {
      trace_id: "trace_13",
      input: "hey there, how is it going????",
    },
    {
      trace_id: "trace_14",
      input: "hi, what is up????",
    },
    {
      trace_id: "trace_15",
      input: "please repeat!!!",
    },
    {
      trace_id: "trace_16",
      input: "sorry, can you repeat????",
    },
    {
      trace_id: "trace_17",
      input: "hey there, how is it going?????",
    },
    {
      trace_id: "trace_18",
      input: "hi, what is up?????",
    },
    {
      trace_id: "trace_19",
      input: "please repeat!!!!",
    },
    {
      trace_id: "trace_20",
      input: "sorry, can you repeat?????",
    },
  ];

  beforeAll(async () => {
    const project = await getTestProject("clustering");
    testProjectId = project.id;
    traces.forEach((trace, i) => {
      trace.topic_id = null;
      trace.subtopic_id = null;
    });

    const client = await esClient({ test: true });
    await client.bulk({
      index: TRACE_INDEX.alias,
      body: traces.flatMap((trace) => [
        {
          index: {
            _id: traceIndexId({
              traceId: trace.trace_id!,
              projectId: testProjectId,
            }),
          },
        },
        {
          trace_id: trace.trace_id,
          project_id: testProjectId,
          input: {
            value: trace.input,
          },
          timestamps: {
            started_at: Date.now(),
            inserted_at: Date.now(),
          },
          metrics: {},
          metadata: {
            labels: ["test-messages"],
          },
        } as Trace,
      ]),
    });
  });

  afterAll(async () => {
    const client = await esClient({ test: true });
    await client.deleteByQuery({
      index: TRACE_INDEX.alias,
      body: {
        query: {
          terms: {
            "metadata.labels": ["test-messages"],
          },
        },
      },
    });
  });

  it("cluster tracers into topics", async () => {
    const result = await fetchTopicsBatchClustering("project_id", {
      litellm_params: {
        model: "openai/gpt-4o-mini",
        api_key: process.env.OPENAI_API_KEY!,
      },
      embeddings_litellm_params: {
        model: "openai/text-embedding-3-small",
        api_key: process.env.OPENAI_API_KEY!,
      },
      traces: traces as Required<TopicClusteringTrace>[],
    });

    expect(result?.cost).toEqual({
      amount: expect.any(Number),
      currency: "USD",
    });

    expect(result?.topics.length).toBeGreaterThan(0);
    expect(result?.topics[0]?.name.length).toBeGreaterThan(0);
    expect(result?.subtopics.length).toBeGreaterThan(0);
    expect(result?.traces.length).toBe(traces.length);
  });

  describe("clustering project traces", () => {
    it("assigns topics to traces for a project", async () => {
      // Run the clusterTopicsForProject function
      await clusterTopicsForProject(testProjectId);

      // Fetch the updated traces from Elasticsearch and verify topics were assigned
      const client = await esClient({ test: true });
      const result = await client.search<Trace>({
        index: TRACE_INDEX.alias,
        query: {
          term: { project_id: testProjectId },
        },
        _source: [
          "trace_id",
          "metadata.topic_id",
          "metadata.subtopic_id",
          "metadata.labels",
        ],
      });

      const traces = result.hits.hits.map((hit) => hit._source);
      expect(traces).not.toBeNull();
      expect(traces.length).toBeGreaterThan(0);
      traces.forEach((trace) => {
        expect(trace?.metadata).toHaveProperty("topic_id");
        expect(trace?.metadata).toHaveProperty("subtopic_id");
        expect(trace?.metadata.topic_id).toBeDefined();
      });

      // Verify that topics were added to the database
      const topics = await prisma.topic.findMany({
        where: {
          projectId: testProjectId,
        },
      });
      expect(topics.length).toBeGreaterThan(1);

      // Verify that a cost entry was inserted into the database
      const costEntries = await prisma.cost.findMany({
        where: {
          projectId: testProjectId,
          costType: CostType.CLUSTERING,
        },
      });
      expect(costEntries.length).toBeGreaterThan(1);
      const costEntry = costEntries[0];
      expect(costEntry).toHaveProperty("amount");
      expect(costEntry?.amount).toBeGreaterThan(0);
      expect(costEntry).toHaveProperty("currency", "USD");
    });
  });

  it.todo("assign topics to new traces incrementally", async () => {
    // TODO: write this test
  });
});
