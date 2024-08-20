import type { Project } from "@prisma/client";
import type { Worker } from "bullmq";
import debug from "debug";
import { nanoid } from "nanoid";
import { createMocks } from "node-mocks-http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TrackEventJob } from "../../server/background/types";
import { startTrackEventsWorker } from "../../server/background/workers/trackEventsWorker";
import { prisma } from "../../server/db";
import {
  TRACE_INDEX,
  esClient,
  traceIndexId,
} from "../../server/elasticsearch";
import type { ElasticSearchTrace, Trace } from "../../server/tracer/types";
import { getTestProject, waitForResult } from "../../utils/testUtils";
import handler from "./track_event";

describe("/api/track_event", () => {
  let worker: Worker<TrackEventJob, void, string> | undefined;
  let project: Project;
  let traceId: string;
  const eventId = `my_event_id_${nanoid()}`;

  beforeAll(async () => {
    worker = startTrackEventsWorker();
    if (worker) {
      await worker.waitUntilReady();
    }
  });

  beforeAll(async () => {
    project = await getTestProject("track-event-test");

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
      index: TRACE_INDEX.alias,
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
      index: TRACE_INDEX.alias,
      id: traceIndexId({ traceId, projectId: project.id }),
      document: testTraceData,
      refresh: true,
    });

    console.log("Waiting for job")

    // Wait for the job to be completed
    await new Promise<void>(
      (resolve) =>
        worker?.on("completed", (args) => {
          if (args.data.event.event_id.includes(eventId)) resolve();
        })
    );

    console.log("Event processed")

    const trace = await waitForResult(async () => {
      const trace = await esClient.getSource<ElasticSearchTrace>({
        index: TRACE_INDEX.alias,
        id: traceIndexId({
          traceId,
          projectId: project?.id ?? "",
        }),
      });

      expect(trace.events).toHaveLength(1);

      return trace;
    });

    const event = trace?.events?.find((e) => e.event_id === eventId);

    expect(event).toMatchObject({
      event_id: eventId,
      project_id: project.id,
      trace_id: traceId,
      event_type: "thumbs_up_down",
      metrics: [{ key: "vote", value: 1 }],
      event_details: [{ key: "feedback", value: "Great!" }],
      timestamps: {
        started_at: expect.any(Number),
        inserted_at: expect.any(Number),
        updated_at: expect.any(Number),
      },
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
