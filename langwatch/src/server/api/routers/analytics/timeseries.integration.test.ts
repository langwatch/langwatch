import { nanoid } from "nanoid";
import { beforeAll, describe, expect, it } from "vitest";
import { getTestUser } from "../../../../utils/testUtils";
import { prisma } from "../../../db";
import { esClient } from "../../../elasticsearch";
import type { ElasticSearchTrace } from "../../../tracer/types";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

describe("Timeseries Graph Integration Tests", () => {
  const traceId = `test-trace-id-${nanoid()}`;
  const traceId2 = `test-trace-id-${nanoid()}`;
  const traceId3 = `test-trace-id-${nanoid()}`;

  beforeAll(async () => {
    await prisma.topic.createMany({
      data: [
        {
          id: "topic_id_greetings",
          name: "greetings",
          projectId: "test-project-id",
          embeddings_model: "test-embeddings-model",
          centroid: [],
          p95Distance: 0,
        },
        {
          id: "topic_id_poems",
          name: "poems",
          projectId: "test-project-id",
          embeddings_model: "test-embeddings-model",
          centroid: [],
          p95Distance: 0,
        },
      ],
      skipDuplicates: true,
    });

    const client = await esClient({ test: true });
  });

  it("should return the right data for metrics", async () => {
    const user = await getTestUser();

    const ctx = createInnerTRPCContext({
      session: {
        user: { id: user.id },
        expires: "1",
      },
    });
    const caller = appRouter.createCaller(ctx);

    const response = await caller.analytics.getTimeseries({
      projectId: "test-project-id",
      startDate: new Date().getTime() - 24 * 60 * 60 * 1000, // 1 day ago
      endDate: new Date().getTime(),
      filters: {
        "metadata.labels": [],
      },
      series: [
        { metric: "metadata.trace_id", aggregation: "cardinality" },
        {
          metric: "metadata.trace_id",
          aggregation: "cardinality",
          pipeline: {
            field: "user_id",
            aggregation: "avg",
          },
        },
        { metric: "metadata.thread_id", aggregation: "cardinality" },
        { metric: "sentiment.thumbs_up_down", aggregation: "cardinality" },
        { metric: "sentiment.thumbs_up_down", aggregation: "sum" },
        { metric: "sentiment.thumbs_up_down", aggregation: "min" },
      ],
      timeZone: "UTC",
    });

    expect(response.currentPeriod[1]).toEqual({
      date: expect.any(String),
      "metadata.trace_id/cardinality": 3,
      "metadata.trace_id/cardinality/user_id/avg": 1.5,
      "metadata.thread_id/cardinality": 3,
      "sentiment.thumbs_up_down/cardinality": 3,
      "sentiment.thumbs_up_down/sum": 1,
      "sentiment.thumbs_up_down/min": -1,
    });
    expect(
      (response.previousPeriod[1] as any)["metadata.trace_id/cardinality"]
    ).toBe(1);
  });

  it("should return grouped metrics correctly", async () => {
    const user = await getTestUser();

    const ctx = createInnerTRPCContext({
      session: {
        user: { id: user.id },
        expires: "1",
      },
    });
    const caller = appRouter.createCaller(ctx);

    const response = await caller.analytics.getTimeseries({
      projectId: "test-project-id",
      startDate: new Date().getTime() - 24 * 60 * 60 * 1000, // 1 day ago
      endDate: new Date().getTime(),
      filters: {
        "metadata.labels": [],
      },
      series: [
        { metric: "metadata.trace_id", aggregation: "cardinality" },
        {
          metric: "metadata.trace_id",
          aggregation: "cardinality",
          pipeline: {
            field: "user_id",
            aggregation: "avg",
          },
        },
        { metric: "metadata.thread_id", aggregation: "cardinality" },
        { metric: "sentiment.thumbs_up_down", aggregation: "cardinality" },
        { metric: "sentiment.thumbs_up_down", aggregation: "sum" },
        { metric: "sentiment.thumbs_up_down", aggregation: "min" },
      ],
      groupBy: "topics.topics",
      timeZone: "UTC",
    });

    expect(response.currentPeriod[1]).toEqual({
      date: expect.any(String),
      "topics.topics": {
        greetings: {
          "metadata.trace_id/cardinality": 2,
          "metadata.trace_id/cardinality/user_id/avg": 1,
          "metadata.thread_id/cardinality": 2,
          "sentiment.thumbs_up_down/cardinality": 2,
          "sentiment.thumbs_up_down/sum": 0,
          "sentiment.thumbs_up_down/min": -1,
        },
        poems: {
          "metadata.trace_id/cardinality": 1,
          "metadata.trace_id/cardinality/user_id/avg": 1,
          "metadata.thread_id/cardinality": 1,
          "sentiment.thumbs_up_down/cardinality": 1,
          "sentiment.thumbs_up_down/sum": 1,
          "sentiment.thumbs_up_down/min": 1,
        },
      },
    });
  });

  it("should return a single period for summary metrics", async () => {
    const user = await getTestUser();

    const ctx = createInnerTRPCContext({
      session: {
        user: { id: user.id },
        expires: "1",
      },
    });
    const caller = appRouter.createCaller(ctx);

    const response = await caller.analytics.getTimeseries({
      projectId: "test-project-id",
      startDate: new Date().getTime() - 24 * 60 * 60 * 1000, // 1 day ago
      endDate: new Date().getTime(),
      filters: {
        "metadata.labels": [],
      },
      series: [
        { metric: "metadata.trace_id", aggregation: "cardinality" },
        {
          metric: "metadata.trace_id",
          aggregation: "cardinality",
          pipeline: {
            field: "user_id",
            aggregation: "avg",
          },
        },
        { metric: "metadata.thread_id", aggregation: "cardinality" },
        { metric: "sentiment.thumbs_up_down", aggregation: "cardinality" },
        { metric: "sentiment.thumbs_up_down", aggregation: "sum" },
        { metric: "sentiment.thumbs_up_down", aggregation: "min" },
      ],
      groupBy: "topics.topics",
      timeScale: "full",
      timeZone: "UTC",
    });

    expect(response.currentPeriod).toEqual([
      {
        date: expect.any(String),
        "topics.topics": {
          greetings: {
            "metadata.trace_id/cardinality": 2,
            "metadata.trace_id/cardinality/user_id/avg": 1,
            "metadata.thread_id/cardinality": 2,
            "sentiment.thumbs_up_down/cardinality": 2,
            "sentiment.thumbs_up_down/sum": 0,
            "sentiment.thumbs_up_down/min": -1,
          },
          poems: {
            "metadata.trace_id/cardinality": 1,
            "metadata.trace_id/cardinality/user_id/avg": 1,
            "metadata.thread_id/cardinality": 1,
            "sentiment.thumbs_up_down/cardinality": 1,
            "sentiment.thumbs_up_down/sum": 1,
            "sentiment.thumbs_up_down/min": 1,
          },
        },
      },
    ]);
  });

  it("should return a 7 days period if requested even though start date is shorter", async () => {
    const user = await getTestUser();

    const ctx = createInnerTRPCContext({
      session: {
        user: { id: user.id },
        expires: "1",
      },
    });
    const caller = appRouter.createCaller(ctx);

    const response = await caller.analytics.getTimeseries({
      projectId: "test-project-id",
      startDate: new Date().getTime() - 24 * 60 * 60 * 1000 * 1, // 1 days ago
      endDate: new Date().getTime(),
      filters: {
        "metadata.labels": [],
      },
      series: [
        { metric: "metadata.trace_id", aggregation: "cardinality" },
        {
          metric: "metadata.trace_id",
          aggregation: "cardinality",
          pipeline: {
            field: "user_id",
            aggregation: "avg",
          },
        },
        { metric: "metadata.thread_id", aggregation: "cardinality" },
        { metric: "sentiment.thumbs_up_down", aggregation: "cardinality" },
        { metric: "sentiment.thumbs_up_down", aggregation: "sum" },
        { metric: "sentiment.thumbs_up_down", aggregation: "min" },
      ],
      groupBy: "topics.topics",
      timeScale: 7,
      timeZone: "UTC",
    });

    expect(response).toEqual({
      previousPeriod: [
        {
          date: expect.any(String),
          "topics.topics": {},
        },
      ],
      currentPeriod: [
        {
          date: expect.any(String),
          "topics.topics": {
            greetings: {
              "metadata.trace_id/cardinality": 2,
              "metadata.trace_id/cardinality/user_id/avg": 1,
              "metadata.thread_id/cardinality": 2,
              "sentiment.thumbs_up_down/cardinality": 2,
              "sentiment.thumbs_up_down/sum": 0,
              "sentiment.thumbs_up_down/min": -1,
            },
            poems: {
              "metadata.trace_id/cardinality": 1,
              "metadata.trace_id/cardinality/user_id/avg": 1,
              "metadata.thread_id/cardinality": 1,
              "sentiment.thumbs_up_down/cardinality": 1,
              "sentiment.thumbs_up_down/sum": 1,
              "sentiment.thumbs_up_down/min": 1,
            },
          },
        },
      ],
    });
  });
});
