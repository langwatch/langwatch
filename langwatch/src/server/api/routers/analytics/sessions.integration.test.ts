import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTestUser } from "../../../../utils/testUtils";
import { TRACE_INDEX, esClient, traceIndexId } from "../../../elasticsearch";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";
import type { Trace } from "../../../tracer/types";

describe("Sessions Endpoint Integration Tests", () => {
  const sampleTraces: Partial<Trace>[] = [
    // Two messages on the same session
    {
      trace_id: `test-trace-id-${nanoid()}`,
      project_id: "test-project-id",
      metadata: {
        user_id: "test-user-id",
        customer_id: "customer-id-1",
        labels: ["test-messages"],
        thread_id: "test-thread-id",
      },
      timestamps: {
        inserted_at: new Date().getTime(),
        started_at: new Date().getTime(),
        updated_at: new Date().getTime(),
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
      timestamps: {
        inserted_at: new Date().getTime(),
        started_at: new Date().getTime() - 1 * 2 * 60 * 1000, // 2 minutes ago
        updated_at: new Date().getTime(),
      },
    },
    // One message on another session
    {
      trace_id: `test-trace-id-${nanoid()}`,
      project_id: "test-project-id",
      metadata: {
        user_id: "test-user-id",
        customer_id: "customer-id-2",
        labels: ["test-messages"],
        thread_id: "test-thread-id-2",
      },
      timestamps: {
        inserted_at: new Date().getTime(),
        started_at: new Date().getTime() - 1 * 61 * 60 * 1000, // 1 hour and a minute ago,
        updated_at: new Date().getTime(),
      },
      metrics: {
        total_time_ms: 2000,
      },
    },
    // One message on yet another session
    {
      trace_id: `test-trace-id-${nanoid()}`,
      project_id: "test-project-id",
      metadata: {
        user_id: "test-user-id",
        customer_id: "customer-id-2",
        labels: ["test-messages"],
        thread_id: "test-thread-id-2",
      },
      timestamps: {
        inserted_at: new Date().getTime(),
        started_at: new Date().getTime() - 2 * 61 * 60 * 1000, // 2 hours and a minute ago,
        updated_at: new Date().getTime(),
      },
    },
    // Different user
    {
      trace_id: `test-trace-id-${nanoid()}`,
      project_id: "test-project-id",
      metadata: {
        user_id: "test-user-id-2",
        customer_id: "customer-id-2",
        labels: ["test-messages"],
        thread_id: "test-thread-id-2",
      },
      timestamps: {
        inserted_at: new Date().getTime(),
        started_at: new Date().getTime(),
        updated_at: new Date().getTime(),
      },
    },
  ];

  beforeAll(async () => {
    const client = await esClient({ test: true });
    await client.bulk({
      index: TRACE_INDEX.alias,
      body: sampleTraces.flatMap((trace) => [
        {
          index: {
            _id: traceIndexId({
              traceId: trace.trace_id ?? "",
              projectId: trace.project_id ?? "",
            }),
          },
        },
        trace,
      ]),
      refresh: true,
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
      filters: {
        "metadata.labels": [],
      },
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
});
