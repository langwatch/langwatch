import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTestUser } from "../../../../utils/testUtils";
import { TRACE_INDEX, esClient } from "../../../elasticsearch";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";
import type { Trace } from "../../../tracer/types";

describe("Satisfaction Endpoint Integration Tests", () => {
  const sampleTraces: Partial<Trace>[] = [
    {
      trace_id: `test-trace-id-${nanoid()}`,
      project_id: "test-project-id",
      metadata: {
        user_id: "test-user-id",
        customer_id: "customer-id-1",
        labels: ["test-messages"],
        thread_id: "test-thread-id",
      },
      input: {
        value: "I am happy",
        satisfaction_score: 0.9,
      },
      timestamps: {
        inserted_at: new Date().getTime(),
        started_at: new Date().getTime(),
      },
    },
    {
      trace_id: `test-trace-id-${nanoid()}`,
      project_id: "test-project-id",
      metadata: {
        user_id: "test-user-id",
        customer_id: "customer-id-1",
        labels: ["test-messages"],
        thread_id: "test-thread-id",
      },
      input: {
        value: "I am neutral",
        satisfaction_score: 0.05,
      },
      timestamps: {
        inserted_at: new Date().getTime(),
        started_at: new Date().getTime(),
      },
    },
    {
      trace_id: `test-trace-id-${nanoid()}`,
      project_id: "test-project-id",
      metadata: {
        user_id: "test-user-id",
        customer_id: "customer-id-1",
        labels: ["test-messages"],
        thread_id: "test-thread-id",
      },
      input: {
        value: "I am sad",
        satisfaction_score: -0.9,
      },
      timestamps: {
        inserted_at: new Date().getTime(),
        started_at: new Date().getTime(),
      },
    },
  ];

  beforeAll(async () => {
    await esClient.bulk({
      index: TRACE_INDEX,
      body: sampleTraces.flatMap((trace) => [
        { index: { _id: trace.trace_id } },
        trace,
      ]),
      refresh: true,
    });
  });

  it("get satisfaction from previous vs current period", async () => {
    const user = await getTestUser();

    const ctx = createInnerTRPCContext({
      session: {
        user: { id: user.id },
        expires: "1",
      },
    });
    const caller = appRouter.createCaller(ctx);

    const response = await caller.analytics.satisfactionVsPreviousPeriod({
      projectId: "test-project-id",
      startDate: new Date().getTime() - 24 * 60 * 60 * 1000, // 1 day ago
      endDate: new Date().getTime(),
      labels: ["test-messages"],
    });

    expect(response).toEqual({
      previousPeriod: [
        {
          date: expect.any(String),
          positive: 0,
          negative: 0,
          neutral: 0,
        },
        {
          date: expect.any(String),
          positive: 0,
          negative: 0,
          neutral: 0,
        },
      ],
      currentPeriod: [
        {
          date: expect.any(String),
          positive: 0,
          negative: 0,
          neutral: 0,
        },
        {
          date: expect.any(String),
          positive: 1,
          negative: 1,
          neutral: 1,
        },
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
