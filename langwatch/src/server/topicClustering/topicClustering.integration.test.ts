import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  clusterTopicsForProject,
  clusterTopicsForTraces,
  type TopicClusteringParams,
} from "./topicClustering";
import { getOpenAIEmbeddings } from "../embeddings";
import { TRACE_INDEX, esClient } from "../elasticsearch";
import type { Trace } from "../tracer/types";
import { CostType } from "@prisma/client";
import { prisma } from "../db";

describe("Topic Clustering Integration Test", () => {
  it("cluster tracers into topics", async () => {
    // Many examples because we skip adding a topic name to small clusters
    const traces: TopicClusteringParams["file"] = [
      {
        _source: {
          id: "trace_1",
          input: { value: "hey there, how is it going?" },
        },
      },
      {
        _source: {
          id: "trace_2",
          input: { value: "hi, what is up?" },
        },
      },
      {
        _source: {
          id: "trace_3",
          input: { value: "please repeat" },
        },
      },
      {
        _source: {
          id: "trace_4",
          input: { value: "sorry, can you repeat?" },
        },
      },
      {
        _source: {
          id: "trace_5",
          input: { value: "hey there, how is it going??" },
        },
      },
      {
        _source: {
          id: "trace_6",
          input: { value: "hi, what is up??" },
        },
      },
      {
        _source: {
          id: "trace_7",
          input: { value: "please repeat!" },
        },
      },
      {
        _source: {
          id: "trace_8",
          input: { value: "sorry, can you repeat??" },
        },
      },
      {
        _source: {
          id: "trace_9",
          input: { value: "hey there, how is it going???" },
        },
      },
      {
        _source: {
          id: "trace_10",
          input: { value: "hi, what is up???" },
        },
      },
      {
        _source: {
          id: "trace_11",
          input: { value: "please repeat!!" },
        },
      },
      {
        _source: {
          id: "trace_12",
          input: { value: "sorry, can you repeat???" },
        },
      },
      {
        _source: {
          id: "trace_13",
          input: { value: "hey there, how is it going????" },
        },
      },
      {
        _source: {
          id: "trace_14",
          input: { value: "hi, what is up????" },
        },
      },
      {
        _source: {
          id: "trace_15",
          input: { value: "please repeat!!!" },
        },
      },
      {
        _source: {
          id: "trace_16",
          input: { value: "sorry, can you repeat????" },
        },
      },
      {
        _source: {
          id: "trace_17",
          input: { value: "hey there, how is it going?????" },
        },
      },
      {
        _source: {
          id: "trace_18",
          input: { value: "hi, what is up?????" },
        },
      },
      {
        _source: {
          id: "trace_19",
          input: { value: "please repeat!!!!" },
        },
      },
      {
        _source: {
          id: "trace_20",
          input: { value: "sorry, can you repeat?????" },
        },
      },
    ];

    for (const trace of traces) {
      trace._source.input.embeddings = await getOpenAIEmbeddings(
        trace._source.input.value
      );
    }

    const topics = await clusterTopicsForTraces("project_id", {
      topics: [],
      file: traces,
    });

    expect(topics?.costs).toEqual({
      amount: expect.any(Number),
      currency: "USD",
    });

    try {
      expect(topics?.message_clusters.trace_3).toEqual(
        "Request for repetition"
      );
      expect(topics?.message_clusters.trace_4).toEqual(
        "Request for repetition"
      );
    } catch {
      expect(topics?.message_clusters.trace_3).toEqual("Asking for repetition");
      expect(topics?.message_clusters.trace_4).toEqual("Asking for repetition");
    }
  });

  // Need to add way more examples
  describe.skip("clustering project traces", () => {
    const testProjectId = "test-project-clustering";
    const testTraceData: Trace[] = [
      {
        trace_id: "trace_1",
        project_id: testProjectId,
        input: { value: "How to learn Python?" },
        timestamps: { started_at: Date.now(), inserted_at: Date.now() },
        metrics: {},
        metadata: {},
      },
      {
        trace_id: "trace_2",
        project_id: testProjectId,
        input: { value: "Python learning resources" },
        timestamps: { started_at: Date.now(), inserted_at: Date.now() },
        metrics: {},
        metadata: {},
      },
      // Add more test traces as needed
    ];

    beforeAll(async () => {
      for (const trace of testTraceData) {
        trace.input.embeddings = await getOpenAIEmbeddings(
          trace.input.value
        );
      }

      // Create trace entries in Elasticsearch for the test project
      await esClient.bulk({
        index: TRACE_INDEX,
        body: testTraceData.flatMap((trace) => [
          { index: { _id: trace.trace_id } },
          trace,
        ]),
        refresh: true,
      });
    });

    afterAll(async () => {
      // Clean up the test data from Elasticsearch
      await esClient.deleteByQuery({
        index: TRACE_INDEX,
        body: {
          query: {
            term: { project_id: testProjectId },
          },
        },
        refresh: true,
      });
      // Clean up the cost entry from the database
      await prisma.cost.deleteMany({
        where: {
          projectId: testProjectId,
          costType: CostType.CLUSTERING,
        },
      });
    });

    it("assigns topics to traces for a project", async () => {
      // Run the clusterTopicsForProject function
      await clusterTopicsForProject(testProjectId);

      // Fetch the updated traces from Elasticsearch and verify topics were assigned
      const result = await esClient.search<Trace>({
        index: TRACE_INDEX,
        query: {
          term: { project_id: testProjectId },
        },
        _source: ["trace_id", "metadata.topics"],
      });

      const traces = result.hits.hits.map((hit) => hit._source);
      expect(traces).not.toBeNull();
      expect(traces.length).toBeGreaterThan(0);
      traces.forEach((trace) => {
        expect(trace).toHaveProperty("topics");
        expect(trace?.metadata.topics).not.toHaveLength(0);
      });

      // Verify that a cost entry was inserted into the database
      const costEntries = await prisma.cost.findMany({
        where: {
          projectId: testProjectId,
          costType: CostType.CLUSTERING,
        },
      });
      expect(costEntries).toHaveLength(1);
      const costEntry = costEntries[0];
      expect(costEntry).toHaveProperty("amount");
      expect(costEntry?.amount).toBeGreaterThan(0);
      expect(costEntry).toHaveProperty("currency", "USD");
    });
  });
});
