import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTestUser } from "../../../../utils/testUtils";
import { esClient } from "../../../elasticsearch";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";
import { TRACE_INDEX } from "../traces";
import type { Trace } from "../../../tracer/types";

describe("Analytics Endpoint Integration Tests", () => {
  const sampleTraces: Partial<Trace>[] = [
    {
      id: `test-trace-id-${nanoid()}`,
      project_id: "test-project-id",
      timestamps: {
        inserted_at: new Date().getTime(),
        started_at: new Date().getTime(),
      },
      customer_id: "customer-id-1",
      labels: ["test-messages"],
    },
    {
      id: `test-trace-id-${nanoid()}`,
      project_id: "test-project-id",
      timestamps: {
        inserted_at: new Date().getTime(),
        started_at: new Date().getTime(),
      },
      customer_id: "customer-id-2",
      labels: ["test-messages"],
    },
  ];

  beforeAll(async () => {
    await esClient.bulk({
      index: TRACE_INDEX,
      body: sampleTraces.flatMap((trace) => [
        { index: { _id: trace.id } },
        trace,
      ]),
      refresh: true,
    });
  });

  it("get messages from previous vs current period", async () => {
    const user = await getTestUser();

    const ctx = createInnerTRPCContext({
      session: {
        user: { id: user.id },
        expires: "1",
      },
    });
    const caller = appRouter.createCaller(ctx);

    const response = await caller.analytics.messagesCountVsPreviousPeriod({
      projectId: "test-project-id",
      startDate: new Date().getTime() - 24 * 60 * 60 * 1000, // 1 day ago
      endDate: new Date().getTime(),
      labels: ["test-messages"],
    });

    expect(response).toEqual({
      previousPeriod: [
        { date: expect.any(String), messages_count: 0 },
        { date: expect.any(String), messages_count: 0 },
      ],
      currentPeriod: [
        { date: expect.any(String), messages_count: 0 },
        { date: expect.any(String), messages_count: 2 },
      ],
    });
  });

  it("get messages aggregated by customer_id", async () => {
    const user = await getTestUser();

    const ctx = createInnerTRPCContext({
      session: {
        user: { id: user.id },
        expires: "1",
      },
    });
    const caller = appRouter.createCaller(ctx);

    const response = await caller.analytics.messagesCountAggregated({
      projectId: "test-project-id",
      startDate: new Date().getTime() - 24 * 60 * 60 * 1000, // 1 day ago
      endDate: new Date().getTime(),
      labels: ["test-messages"],
      customer_ids: ["customer-id-1", "customer-id-2"],
      aggregations: ["customer_id"],
    });

    expect(response).toEqual({
      "customer-id-1": [
        { date: expect.any(String), messages_count: 0 },
        { date: expect.any(String), messages_count: 1 },
      ],
      "customer-id-2": [
        { date: expect.any(String), messages_count: 0 },
        { date: expect.any(String), messages_count: 1 },
      ],
    });
  });

  afterAll(async () => {
    await esClient.deleteByQuery({
      index: TRACE_INDEX,
      body: {
        query: {
          terms: {
            labels: ["test-messages"],
          },
        },
      },
    });
  });
});
