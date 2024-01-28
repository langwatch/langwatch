import type { Worker } from "bullmq";
import { createMocks } from "node-mocks-http";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { prisma } from "../../server/db";
import {
  EVENTS_INDEX,
  TRACE_INDEX,
  esClient,
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
      index: TRACE_INDEX,
      id: traceId,
      refresh: true,
    });

    // Clean up the events created during the test in Elasticsearch
    await esClient.deleteByQuery({
      index: EVENTS_INDEX,
      body: {
        query: {
          match: {
            project_id: project.id,
          },
        },
      },
    });
  });

  it("should store a valid event in Elasticsearch", async () => {
    const { req, res } = createMocks({
      method: "POST",
      headers: {
        "x-auth-token": project.apiKey,
      },
      body: {
        id: "my_event_id",
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
      id: traceId,
      project_id: project.id,
      input: {
        value: "Test input for trace",
      },
      output: {
        value: "Test output for trace",
      },
      timestamps: { started_at: Date.now(), inserted_at: Date.now() },
      thread_id: "test-thread",
      user_id: "test-user",
      customer_id: "test-customer",
      labels: ["test-label"],
      metrics: {},
      search_embeddings: {},
    };

    await esClient.index({
      index: TRACE_INDEX,
      id: traceId,
      document: testTraceData,
      refresh: true,
    });

    // Wait for the job to be completed
    await new Promise<void>(
      (resolve) =>
        worker?.on("completed", (args) => {
          if (args.data.event.id.includes("my_event_id")) resolve();
        })
    );

    const eventId = `event_${project.id}_my_event_id`;
    let event: GetResponse<Event>;
    try {
      event = await esClient.get<Event>({
        index: EVENTS_INDEX,
        id: eventId,
      });
    } catch {
      // Wait once more for the job to be completed
      await new Promise<void>(
        (resolve) =>
          worker?.on("completed", (args) => {
            if (args.data.event.id.includes("my_event_id")) resolve();
          })
      );
      event = await esClient.get<Event>({
        index: EVENTS_INDEX,
        id: eventId,
      });
    }

    expect(event).toBeDefined();
    expect(event._source).toMatchObject({
      id: eventId,
      project_id: project.id,
      trace_id: traceId,
      event_type: "thumbs_up_down",
      metrics: { vote: 1 },
      event_details: { feedback: "Great!" },
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

  // Additional tests can be added as needed
});
