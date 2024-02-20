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

describe("Data For Filter Integration Tests", () => {
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
          topic_id: "greetings",
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
      trace_checks: [
        {
          trace_id: `test-trace-id-${nanoid()}`,
          project_id: "test-project-id",
          check_id: `test-check-id-faithfulness`,
          check_type: "faithfulness",
          check_name: "Faithfulness",
          status: "succeeded",
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
          topic_id: "greetings",
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
      trace_checks: [
        {
          trace_id: `test-trace-id-${nanoid()}`,
          project_id: "test-project-id",
          check_id: `test-check-id-faithfulness`,
          check_type: "faithfulness",
          check_name: "Faithfulness2",
          status: "succeeded",
          timestamps: {
            inserted_at: new Date().getTime(),
            started_at: new Date().getTime(),
            updated_at: new Date().getTime(),
          },
        },
        {
          trace_id: `test-trace-id-${nanoid()}`,
          project_id: "test-project-id",
          check_id: `test-check-id-consistency`,
          check_type: "consistency",
          check_name: "Consistency",
          status: "succeeded",
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
          topic_id: "poems",
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
      field: "trace_checks.check_id",
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
      field: "trace_checks.check_id",
      query: "faith",
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
      query: "Pr"
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
