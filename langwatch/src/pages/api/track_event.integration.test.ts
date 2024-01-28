import type { Worker } from "bullmq";
import { createMocks } from "node-mocks-http";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { prisma } from "../../server/db";
import { EVENTS_INDEX, esClient } from "../../server/elasticsearch";
import handler from "./track_event";
import type { Project } from "@prisma/client";
import { startTrackEventsWorker } from "../../server/background/workers/trackEventsWorker";
import type { TrackEventJob } from "../../server/background/types";

describe("/api/track_event", () => {
  let worker: Worker<TrackEventJob, void, string>;
  let project: Project;

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
  });

  afterAll(async () => {
    await worker?.close();

    // Clean up the test project
    await prisma.project.delete({
      where: {
        id: project.id,
      },
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
        trace_id: "trace_123",
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

    // Wait for the job to be completed
    await new Promise<void>(
      (resolve) =>
        worker?.on("completed", (args) => {
          if (args.data.event.id.includes("my_event_id")) resolve();
        })
    );

    const eventId = `event_${project.id}_my_event_id`;
    const event = await esClient.get<Event>({
      index: EVENTS_INDEX,
      id: eventId,
    });

    expect(event).toBeDefined();
    expect(event._source).toMatchObject({
      event_type: "thumbs_up_down",
      metrics: { vote: 1 },
      event_details: { feedback: "Great!" },
      project_id: project.id,
    });
  });

  it("should return an error for invalid event data", async () => {
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
