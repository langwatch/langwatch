import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTestUser } from "../../../../utils/testUtils";
import { TRACE_INDEX, esClient } from "../../../elasticsearch";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";
import type { Trace } from "../../../tracer/types";

describe("Sessions Endpoint Integration Tests", () => {
  const sampleTraces: Partial<Trace>[] = [
    // Two messages on the same session
    {
      id: `test-trace-id-${nanoid()}`,
      project_id: "test-project-id",
      user_id: "test-user-id",
      timestamps: {
        inserted_at: new Date().getTime(),
        started_at: new Date().getTime(),
      },
      customer_id: "customer-id-1",
      labels: ["test-messages"],
      thread_id: "test-thread-id",
    },
    {
      id: `test-trace-id-${nanoid()}`,
      project_id: "test-project-id",
      user_id: "test-user-id",
      timestamps: {
        inserted_at: new Date().getTime(),
        started_at: new Date().getTime() - 1 * 2 * 60 * 1000, // 2 minutes ago
      },
      customer_id: "customer-id-1",
      labels: ["test-messages"],
      thread_id: "test-thread-id",
    },
    // One message on another session
    {
      id: `test-trace-id-${nanoid()}`,
      project_id: "test-project-id",
      user_id: "test-user-id",
      timestamps: {
        inserted_at: new Date().getTime(),
        started_at: new Date().getTime() - 1 * 61 * 60 * 1000, // 1 hour and a minute ago,
      },
      customer_id: "customer-id-2",
      labels: ["test-messages"],
      thread_id: "test-thread-id-2",
      metrics: {
        total_time_ms: 2000,
      },
    },
    // One message on yet another session
    {
      id: `test-trace-id-${nanoid()}`,
      project_id: "test-project-id",
      user_id: "test-user-id",
      timestamps: {
        inserted_at: new Date().getTime(),
        started_at: new Date().getTime() - 2 * 61 * 60 * 1000, // 2 hours and a minute ago,
      },
      customer_id: "customer-id-2",
      labels: ["test-messages"],
      thread_id: "test-thread-id-2",
    },
    // Different user
    {
      id: `test-trace-id-${nanoid()}`,
      project_id: "test-project-id",
      user_id: "test-user-id-2",
      timestamps: {
        inserted_at: new Date().getTime(),
        started_at: new Date().getTime(),
      },
      customer_id: "customer-id-2",
      labels: ["test-messages"],
      thread_id: "test-thread-id-2",
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

  it("get sessions per user from previous vs current period", async () => {
    const user = await getTestUser();

    const ctx = createInnerTRPCContext({
      session: {
        user: { id: user.id },
        expires: "1",
      },
    });
    const caller = appRouter.createCaller(ctx);

    const response = await caller.analytics.sessionsVsPreviousPeriod({
      projectId: "test-project-id",
      startDate: new Date().getTime() - 24 * 60 * 60 * 1000, // 1 day ago
      endDate: new Date().getTime(),
      labels: ["test-messages"],
    });

    expect(response).toEqual({
      currentPeriod: {
        total_users: 2,
        total_sessions: 4,
        average_sessions_per_user: 2,
        average_threads_per_user_session: 1,
        average_duration_per_user_session: 20333,
        bouncing_users_count: 1,
        returning_users_count: 1,
      },
      previousPeriod: {
        total_users: 0,
        total_sessions: 0,
        average_sessions_per_user: 0,
        average_threads_per_user_session: 0,
        average_duration_per_user_session: 0,
        bouncing_users_count: 0,
        returning_users_count: 0,
      },
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
