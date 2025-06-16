import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { esClient, TRACE_INDEX, traceIndexId } from "../../../elasticsearch";
import { getTestUser } from "../../../../utils/testUtils";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";
import type { ElasticSearchTrace } from "../../../tracer/types";

describe("Data For Filter Integration Tests", () => {
  const traceId = `test-trace-id-${nanoid()}`;
  const traceId2 = `test-trace-id-${nanoid()}`;
  const traceId3 = `test-trace-id-${nanoid()}`;

  const traceEntries: ElasticSearchTrace[] = [
    {
      trace_id: traceId,
      project_id: "test-project-id",
      metadata: {
        user_id: "test-user-id",
        customer_id: "customer-id-1",
        labels: ["test-messages"],
        thread_id: "test-thread-id",
        topic_id: "greetings",
        all_keys: ["user_id", "customer_id", "labels", "thread_id", "topic_id"],
      },
      timestamps: {
        inserted_at: new Date().getTime(),
        started_at: new Date().getTime(),
        updated_at: new Date().getTime(),
      },
      metrics: {},
      input: {
        value: "",
      },
      spans: [],
      events: [
        {
          trace_id: traceId,
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
      evaluations: [
        {
          evaluation_id: nanoid(),
          evaluator_id: `test-check-id-faithfulness`,
          type: "faithfulness",
          name: "Faithfulness",
          is_guardrail: false,
          status: "processed",
          timestamps: {
            inserted_at: new Date().getTime(),
            started_at: new Date().getTime(),
            updated_at: new Date().getTime(),
          },
        },
      ],
    },
    {
      trace_id: traceId2,
      project_id: "test-project-id",
      metadata: {
        user_id: "test-user-id-2",
        customer_id: "customer-id-1",
        labels: ["test-messages"],
        thread_id: "test-thread-id-2",
        topic_id: "greetings",
        all_keys: ["user_id", "customer_id", "labels", "thread_id", "topic_id"],
      },
      timestamps: {
        inserted_at: new Date().getTime(),
        started_at: new Date().getTime(),
        updated_at: new Date().getTime(),
      },
      metrics: {},
      spans: [],
      events: [
        {
          trace_id: traceId2,
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
      evaluations: [
        {
          evaluation_id: nanoid(),
          evaluator_id: `test-check-id-faithfulness`,
          type: "faithfulness",
          name: "Faithfulness2",
          is_guardrail: false,
          status: "processed",
          timestamps: {
            inserted_at: new Date().getTime(),
            started_at: new Date().getTime(),
            updated_at: new Date().getTime(),
          },
        },
        {
          evaluation_id: nanoid(),
          evaluator_id: `test-check-id-consistency`,
          type: "consistency",
          name: "Consistency",
          is_guardrail: false,
          status: "processed",
          timestamps: {
            inserted_at: new Date().getTime(),
            started_at: new Date().getTime(),
            updated_at: new Date().getTime(),
          },
        },
      ],
    },
    {
      trace_id: traceId3,
      project_id: "test-project-id",
      metadata: {
        user_id: "test-user-id-2",
        customer_id: "customer-id-1",
        labels: ["test-messages"],
        thread_id: "test-thread-id-3",
        topic_id: "poems",
        all_keys: ["user_id", "customer_id", "labels", "thread_id", "topic_id"],
      },
      timestamps: {
        inserted_at: new Date().getTime(),
        started_at: new Date().getTime(),
        updated_at: new Date().getTime(),
      },
      metrics: {},
      spans: [],
      events: [
        {
          trace_id: traceId3,
          event_id: `test-event-id-${nanoid()}`,
          event_type: "add_to_cart",
          metrics: [
            {
              key: "quantity",
              value: 2,
            },
            {
              key: "price",
              value: 10.5,
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
  ];

  beforeAll(async () => {
    const client = await esClient({ test: true });
    await client.bulk({
      index: TRACE_INDEX.alias,
      body: traceEntries.flatMap((trace) => [
        {
          index: {
            _id: traceIndexId({
              traceId: trace.trace_id,
              projectId: trace.project_id,
            }),
          },
        },
        trace,
      ]),
      refresh: true,
    });
  });

  it("should return the right data for trace check id filter", async () => {
    const user = await getTestUser();

    const ctx = createInnerTRPCContext({
      session: {
        user: { id: user.id },
        expires: "1",
      },
    });
    const caller = appRouter.createCaller(ctx);

    let response = await caller.analytics.dataForFilter({
      projectId: "test-project-id",
      field: "evaluations.evaluator_id",
      startDate: new Date().getTime() - 1000 * 60 * 60 * 24 * 7,
      endDate: new Date().getTime(),
      filters: {},
    });

    expect(response).toEqual({
      options: [
        {
          field: "test-check-id-consistency",
          label: "Consistency",
          count: 1,
        },
        {
          field: "test-check-id-faithfulness",
          label: "Faithfulness",
          count: 2,
        },
      ],
    });

    response = await caller.analytics.dataForFilter({
      projectId: "test-project-id",
      field: "evaluations.evaluator_id",
      query: "faith",
      startDate: new Date().getTime() - 1000 * 60 * 60 * 24 * 7,
      endDate: new Date().getTime(),
      filters: {},
    });

    expect(response).toEqual({
      options: [
        {
          field: "test-check-id-faithfulness",
          label: "Faithfulness",
          count: 2,
        },
      ],
    });
  });

  it("should return the right data for event type filter", async () => {
    const user = await getTestUser();

    const ctx = createInnerTRPCContext({
      session: {
        user: { id: user.id },
        expires: "1",
      },
    });
    const caller = appRouter.createCaller(ctx);

    let response = await caller.analytics.dataForFilter({
      projectId: "test-project-id",
      field: "events.event_type",
      startDate: new Date().getTime() - 1000 * 60 * 60 * 24 * 7,
      endDate: new Date().getTime(),
      filters: {},
    });

    expect(response).toEqual({
      options: [
        {
          field: "add_to_cart",
          label: "add_to_cart",
          count: 1,
        },
        {
          field: "thumbs_up_down",
          label: "thumbs_up_down",
          count: 2,
        },
      ],
    });

    response = await caller.analytics.dataForFilter({
      projectId: "test-project-id",
      field: "events.event_type",
      query: "add_to",
      startDate: new Date().getTime() - 1000 * 60 * 60 * 24 * 7,
      endDate: new Date().getTime(),
      filters: {},
    });

    expect(response).toEqual({
      options: [
        {
          field: "add_to_cart",
          label: "add_to_cart",
          count: 1,
        },
      ],
    });
  });

  it.only("should return the right data for event metric filter", async () => {
    const user = await getTestUser();

    const ctx = createInnerTRPCContext({
      session: {
        user: { id: user.id },
        expires: "1",
      },
    });
    const caller = appRouter.createCaller(ctx);

    let response = await caller.analytics.dataForFilter({
      projectId: "test-project-id",
      field: "events.metrics.key",
      key: "add_to_cart",
      startDate: new Date().getTime() - 1000 * 60 * 60 * 24 * 7,
      endDate: new Date().getTime(),
      filters: {},
    });

    expect(response).toEqual({
      options: [
        {
          field: "price",
          label: "price",
          count: 1,
        },
        {
          field: "quantity",
          label: "quantity",
          count: 1,
        },
      ],
    });

    response = await caller.analytics.dataForFilter({
      projectId: "test-project-id",
      field: "events.metrics.key",
      key: "add_to_cart",
      query: "Pr",
      startDate: new Date().getTime() - 1000 * 60 * 60 * 24 * 7,
      endDate: new Date().getTime(),
      filters: {},
    });

    expect(response).toEqual({
      options: [
        {
          field: "price",
          label: "price",
          count: 1,
        },
      ],
    });
  });
});
