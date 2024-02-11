import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TracesPivot } from "../../../analytics/types";
import { nanoid } from "nanoid";
import {
  esClient,
  traceIndexId,
  TRACES_PIVOT_INDEX,
} from "../../../elasticsearch";
import { getTestUser } from "../../../../utils/testUtils";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

describe("Timeseries Graph Integration Tests", () => {
  const pivotEntries: TracesPivot[] = [
    {
      trace: {
        trace_id: `test-trace-id-${nanoid()}`,
        project_id: "test-project-id",
        metadata: {
          user_id: "test-user-id",
          customer_id: "customer-id-1",
          labels: ["test-messages"],
          thread_id: "test-thread-id",
          topics: ["greetings"],
        },
        timestamps: {
          inserted_at: new Date().getTime(),
          started_at: new Date().getTime(),
          updated_at: new Date().getTime(),
        },
        metrics: {},
        input: {},
        has_error: false,
      },
      events: [
        {
          event_id: `test-event-id-${nanoid()}`,
          event_type: "thumbs_up_down",
          metrics: [
            {
              key: "vote",
              value: 1,
            },
          ],
          event_details: [],
          project_id: "test-project-id",
          timestamps: {
            inserted_at: new Date().getTime(),
            started_at: new Date().getTime(),
            updated_at: new Date().getTime(),
          },
        },
      ],
    },
    {
      trace: {
        trace_id: `test-trace-id-${nanoid()}`,
        project_id: "test-project-id",
        metadata: {
          user_id: "test-user-id-2",
          customer_id: "customer-id-1",
          labels: ["test-messages"],
          thread_id: "test-thread-id-2",
          topics: ["greetings"],
        },
        timestamps: {
          inserted_at: new Date().getTime(),
          started_at: new Date().getTime(),
          updated_at: new Date().getTime(),
        },
        metrics: {},
        input: {},
        has_error: false,
      },
      events: [
        {
          event_id: `test-event-id-${nanoid()}`,
          event_type: "thumbs_up_down",
          metrics: [
            {
              key: "vote",
              value: -1,
            },
          ],
          event_details: [],
          project_id: "test-project-id",
          timestamps: {
            inserted_at: new Date().getTime(),
            started_at: new Date().getTime(),
            updated_at: new Date().getTime(),
          },
        },
      ],
    },
    {
      trace: {
        trace_id: `test-trace-id-${nanoid()}`,
        project_id: "test-project-id",
        metadata: {
          user_id: "test-user-id-2",
          customer_id: "customer-id-1",
          labels: ["test-messages"],
          thread_id: "test-thread-id-3",
          topics: ["poems"],
        },
        timestamps: {
          inserted_at: new Date().getTime(),
          started_at: new Date().getTime(),
          updated_at: new Date().getTime(),
        },
        metrics: {},
        input: {},
        has_error: false,
      },
      events: [
        {
          event_id: `test-event-id-${nanoid()}`,
          event_type: "thumbs_up_down",
          metrics: [
            {
              key: "vote",
              value: 1,
            },
          ],
          event_details: [],
          project_id: "test-project-id",
          timestamps: {
            inserted_at: new Date().getTime(),
            started_at: new Date().getTime(),
            updated_at: new Date().getTime(),
          },
        },
      ],
    },
    // older message
    {
      trace: {
        trace_id: `test-trace-id-${nanoid()}`,
        project_id: "test-project-id",
        metadata: {
          user_id: "test-user-id",
          customer_id: "customer-id-1",
          labels: ["test-messages"],
          thread_id: "test-thread-id",
          topics: ["greetings"],
        },
        timestamps: {
          inserted_at: new Date().getTime() - 24 * 60 * 60 * 1000 * 2,
          started_at: new Date().getTime() - 24 * 60 * 60 * 1000 * 2,
          updated_at: new Date().getTime() - 24 * 60 * 60 * 1000 * 2,
        },
        metrics: {},
        input: {},
        has_error: false,
      },
    },
  ];

  beforeAll(async () => {
    await esClient.bulk({
      index: TRACES_PIVOT_INDEX,
      body: pivotEntries.flatMap((pivot) => [
        {
          index: {
            _id: traceIndexId({
              traceId: pivot.trace?.trace_id ?? "",
              projectId: pivot.trace?.project_id ?? "",
            }),
          },
        },
        pivot,
      ]),
      refresh: true,
    });
  });

  afterAll(async () => {
    await esClient.deleteByQuery({
      index: TRACES_PIVOT_INDEX,
      body: {
        query: {
          terms: {
            "trace.metadata.labels": ["test-messages"],
          },
        },
      },
    });
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
        metadata: {
          labels: ["test-messages"],
        },
      },
      series: [
        { metric: "volume.trace_id", aggregation: "cardinality" },
        {
          metric: "volume.trace_id",
          aggregation: "cardinality",
          pipeline: {
            field: "user_id",
            aggregation: "avg",
          },
        },
        { metric: "volume.thread_id", aggregation: "cardinality" },
        { metric: "sentiment.thumbs_up_down", aggregation: "cardinality" },
        { metric: "sentiment.thumbs_up_down", aggregation: "sum" },
        { metric: "sentiment.thumbs_up_down", aggregation: "min" },
      ],
    });

    expect(response.currentPeriod[1]).toEqual({
      date: expect.any(String),
      "volume.trace_id/cardinality": 3,
      "volume.trace_id/cardinality/user_id/avg": 1.5,
      "volume.thread_id/cardinality": 3,
      "sentiment.thumbs_up_down/cardinality": 3,
      "sentiment.thumbs_up_down/sum": 1,
      "sentiment.thumbs_up_down/min": -1,
    });
    expect((response.previousPeriod[1] as any)["volume.trace_id/cardinality"]).toBe(1);
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
        metadata: {
          labels: ["test-messages"],
        },
      },
      series: [
        { metric: "volume.trace_id", aggregation: "cardinality" },
        {
          metric: "volume.trace_id",
          aggregation: "cardinality",
          pipeline: {
            field: "user_id",
            aggregation: "avg",
          },
        },
        { metric: "volume.thread_id", aggregation: "cardinality" },
        { metric: "sentiment.thumbs_up_down", aggregation: "cardinality" },
        { metric: "sentiment.thumbs_up_down", aggregation: "sum" },
        { metric: "sentiment.thumbs_up_down", aggregation: "min" },
      ],
      groupBy: "topics.topics",
    });

    expect(response.currentPeriod[1]).toEqual({
      date: expect.any(String),
      "topics.topics": {
        greetings: {
          "volume.trace_id/cardinality": 2,
          "volume.trace_id/cardinality/user_id/avg": 1,
          "volume.thread_id/cardinality": 2,
          "sentiment.thumbs_up_down/cardinality": 2,
          "sentiment.thumbs_up_down/sum": 0,
          "sentiment.thumbs_up_down/min": -1,
        },
        poems: {
          "volume.trace_id/cardinality": 1,
          "volume.trace_id/cardinality/user_id/avg": 1,
          "volume.thread_id/cardinality": 1,
          "sentiment.thumbs_up_down/cardinality": 1,
          "sentiment.thumbs_up_down/sum": 1,
          "sentiment.thumbs_up_down/min": 1,
        },
      },
    });
  });
});
