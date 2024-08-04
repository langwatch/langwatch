import type { Worker } from "bullmq";
import { createMocks } from "node-mocks-http";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { prisma } from "../../server/db";
import {
  EVENTS_INDEX,
  TRACE_INDEX,
  esClient,
  eventIndexId,
  traceIndexId,
} from "../../server/elasticsearch";
import handler from "./track_event";
import type { Project } from "@prisma/client";
import { startTrackEventsWorker } from "../../server/background/workers/trackEventsWorker";
import type { TrackEventJob } from "../../server/background/types";
import type { Trace } from "../../server/tracer/types";
import { nanoid } from "nanoid";
import type { GetResponse } from "@elastic/elasticsearch/lib/api/types";
import debug from "debug";

describe("/api/track_event", () => {
  let worker: Worker<TrackEventJob, void, string>;
  let project: Project;
  let traceId: string;
  const eventId = `my_event_id_${nanoid()}`;

  beforeAll(async () => {
    worker = startTrackEventsWorker();
    await worker.waitUntilReady();
  });

  beforeAll(async () => {
    await prisma.project.deleteMany({
      where: { slug: "--test-project" },
    });
    project = await prisma.project.create({
      data: {
        name: "Test Project",
        slug: "--test-project",
        language: "python",
        framework: "openai",
        apiKey: "test-auth-token",
        teamId: "some-team",
      },
    });

    // Create a trace entry in Elasticsearch with grouping keys for the test
    traceId = `test-trace-${nanoid()}`;
  });

  afterAll(async () => {
    await worker?.close();

    // Clean up the test project
    await prisma.project.delete({
      where: {
        id: project.id,
      },
    });

    // Clean up the trace
    await esClient.delete({
      index: TRACE_INDEX.write_alias,
      id: traceIndexId({ traceId, projectId: project.id }),
      refresh: true,
    });
  });

  it("should store a valid event in ElasticSearch", async () => {
    const { req, res } = createMocks({
      method: "POST",
      headers: {
        "x-auth-token": project.apiKey,
      },
      body: {
        event_id: eventId,
        trace_id: traceId,
        event_type: "thumbs_up_down",
        metrics: { vote: 1 },
        event_details: { feedback: "Great!" },
        timestamp: Date.now(),
      },
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._getJSONData()).toEqual({
      message: "Event tracked",
    });

    // Save trace after sending the event
    const testTraceData: Trace = {
      trace_id: traceId,
      project_id: project.id,
      input: {
        value: "Test input for trace",
      },
      output: {
        value: "Test output for trace",
      },
      timestamps: {
        started_at: Date.now(),
        inserted_at: Date.now(),
        updated_at: Date.now(),
      },
      metadata: {
        thread_id: "test-thread",
        user_id: "test-user",
        customer_id: "test-customer",
        labels: ["test-label"],
      },
      metrics: {},
    };

    await esClient.index({
      index: TRACE_INDEX.write_alias,
      id: traceIndexId({ traceId, projectId: project.id }),
      document: testTraceData,
      refresh: true,
    });

    // Wait for the job to be completed
    await new Promise<void>(
      (resolve) =>
        worker?.on("completed", (args) => {
          if (args.data.event.event_id.includes(eventId)) resolve();
        })
    );

    const indexEventId = eventIndexId({
      eventId: eventId,
      projectId: project.id,
    });
    let event: GetResponse<Event>;
    try {
      event = await esClient.get<Event>({
        index: EVENTS_INDEX,
        id: indexEventId,
      });
    } catch {
      // Wait once more for the job to be completed
      await new Promise<void>(
        (resolve) =>
          worker?.on("completed", (args) => {
            if (args.data.event.event_id.includes(eventId)) resolve();
          })
      );
      event = await esClient.get<Event>({
        index: EVENTS_INDEX,
        id: indexEventId,
      });
    }

    expect(event).toBeDefined();
    expect(event._source).toMatchObject({
      event_id: eventId,
      project_id: project.id,
      trace_id: traceId,
      event_type: "thumbs_up_down",
      metrics: [{ key: "vote", value: 1 }],
      event_details: [{ key: "feedback", value: "Great!" }],
      timestamps: {
        started_at: expect.any(Number),
        inserted_at: expect.any(Number),
      },
      // Grouping keys from the trace even though even was sent earlier
      thread_id: "test-thread",
      user_id: "test-user",
      customer_id: "test-customer",
      labels: ["test-label"],
    });
  });

  it("should return an error for invalid event data", async () => {
    const namespaces = debug.disable();
    const { req, res } = createMocks({
      method: "POST",
      headers: {
        "x-auth-token": project.apiKey,
      },
      body: {
        // Missing required fields like event_type
        trace_id: "trace_123",
        metrics: { vote: 1 },
        event_details: { feedback: "Great!" },
        timestamp: Date.now(),
      },
    });

    await handler(req, res);
    debug.enable(namespaces);

    expect(res.statusCode).toBe(400);
  });

  it("should return an error for unauthorized access", async () => {
    const { req, res } = createMocks({
      method: "POST",
      body: {
        trace_id: "trace_123",
        event_type: "thumbs_up",
        metrics: { vote: 1 },
        event_details: { feedback: "Great!" },
        timestamp: Date.now(),
      },
    });

    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res._getJSONData()).toHaveProperty(
      "message",
      "X-Auth-Token header is required."
    );
  });
});
