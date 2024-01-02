import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  clusterTopicsForProject,
  clusterTopicsForTraces,
  type TopicClusteringParams,
} from "./topic_clustering";
import { getOpenAIEmbeddings } from "../server/embeddings";
import { TRACE_INDEX, esClient } from "../server/elasticsearch";
import type { Trace } from "../server/tracer/types";
import { CostType } from "@prisma/client";
import { prisma } from "../server/db";

describe("Topic Clustering Integration Test", () => {
  it("cluster tracers into topics", async () => {
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
    ];

    for (const trace of traces) {
      trace._source.input.openai_embeddings = await getOpenAIEmbeddings(
        trace._source.input.value
      );
    }

    const topics = await clusterTopicsForTraces({ topics: [], file: traces });

    expect(topics).toEqual({
      costs: {
        amount: expect.any(Number),
        currency: "USD",
      },
      message_clusters: {
        trace_1: expect.any(String),
        trace_2: expect.any(String),
        trace_3: "Repetition Requests",
        trace_4: "Repetition Requests",
      },
    });
  });

  describe("clustering project traces", () => {
    const testProjectId = "test-project-clustering";
    const testTraceData: Trace[] = [
      {
        id: "trace_1",
        project_id: testProjectId,
        input: { value: "How to learn Python?" },
        timestamps: { started_at: Date.now(), inserted_at: Date.now() },
        metrics: {},
        search_embeddings: {},
      },
      {
        id: "trace_2",
        project_id: testProjectId,
        input: { value: "Python learning resources" },
        timestamps: { started_at: Date.now(), inserted_at: Date.now() },
        metrics: {},
        search_embeddings: {},
      },
      // Add more test traces as needed
    ];

    beforeAll(async () => {
      for (const trace of testTraceData) {
        trace.input.openai_embeddings = await getOpenAIEmbeddings(
          trace.input.value
        );
      }

      // Create trace entries in Elasticsearch for the test project
      await esClient.bulk({
        index: TRACE_INDEX,
        body: testTraceData.flatMap((trace) => [
          { index: { _id: trace.id } },
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
        _source: ["id", "topics"],
      });

      const traces = result.hits.hits.map((hit) => hit._source);
      expect(traces).not.toBeNull();
      expect(traces.length).toBeGreaterThan(0);
      traces.forEach((trace) => {
        expect(trace).toHaveProperty("topics");
        expect(trace?.topics).not.toHaveLength(0);
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
