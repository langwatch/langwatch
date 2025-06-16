import { nanoid } from "nanoid";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { TRACE_INDEX, esClient, traceIndexId } from "../../elasticsearch";
import type {
  ElasticSearchSpan,
  ElasticSearchTrace,
  Span,
} from "../../tracer/types";
import { processCollectorJob } from "./collectorWorker";
import type { CollectorJob } from "../types";
import { prisma } from "../../db";

describe.skip("Collector Worker Integration Tests", () => {
  let projectId: string;

  beforeAll(async () => {
    // Create a test project
    const project = await prisma.project.create({
      data: {
        name: "Test Project for Collector Worker",
        slug: `test-collector-${nanoid()}`,
        teamId: "test-team-id",
        apiKey: `test-api-key-${nanoid()}`,
        language: "typescript",
        framework: "other",
      },
    });
    projectId = project.id;
  });

  afterAll(async () => {
    // Clean up test documents
    const client = await esClient({ test: true });
    await client.deleteByQuery({
      index: TRACE_INDEX.alias,
      body: {
        query: {
          term: { project_id: projectId },
        },
      },
    });

    // Clean up test project
    await prisma.project.delete({
      where: { id: projectId },
    });
  });

  describe("ignore_timestamps_on_write functionality", () => {
    it.skip("should preserve existing timestamps when ignore_timestamps_on_write is true and trace exists", async () => {
      const traceId = `test-trace-preserve-${nanoid()}`;
      const spanId1 = `test-span-1-${nanoid()}`;
      const spanId2 = `test-span-2-${nanoid()}`;

      const originalStartedAt = Date.now() - 10000; // 10 seconds ago
      const originalFirstTokenAt = Date.now() - 9000; // 9 seconds ago
      const originalFinishedAt = Date.now() - 8000; // 8 seconds ago

      // First, create a trace with initial spans
      const initialJob: CollectorJob = {
        spans: [
          {
            span_id: spanId1,
            trace_id: traceId,
            type: "llm",
            name: "Initial LLM Call",
            timestamps: {
              started_at: originalStartedAt,
              first_token_at: originalFirstTokenAt,
              finished_at: originalFinishedAt,
            },
            input: { type: "text", value: "Hello" },
            output: { type: "text", value: "Hi there!" },
          } as Span,
          {
            span_id: spanId2,
            trace_id: traceId,
            type: "span",
            name: "Processing",
            timestamps: {
              started_at: originalStartedAt + 1000,
              finished_at: originalFinishedAt + 1000,
            },
          } as Span,
        ],
        evaluations: undefined,
        traceId,
        projectId,
        expectedOutput: null,
        reservedTraceMetadata: {
          user_id: "test-user",
        },
        customMetadata: {},
        collectedAt: Date.now(),
        paramsMD5: "test-md5-1",
      };

      await processCollectorJob(undefined, initialJob);

      // Now update the spans with ignore_timestamps_on_write = true
      const updateJob: CollectorJob = {
        spans: [
          {
            span_id: spanId1,
            trace_id: traceId,
            type: "llm",
            name: "Updated LLM Call",
            timestamps: {
              ignore_timestamps_on_write: true,
              started_at: Date.now(), // This should be ignored
              first_token_at: Date.now(), // This should be ignored
              finished_at: Date.now(), // This should be ignored
            },
            input: { type: "text", value: "Hello Updated" },
            output: { type: "text", value: "Hi there updated!" },
          } as Span,
        ],
        evaluations: undefined,
        traceId,
        projectId,
        expectedOutput: null,
        reservedTraceMetadata: {
          user_id: "test-user",
        },
        customMetadata: {},
        collectedAt: Date.now(),
        existingTrace: {
          inserted_at: Date.now() - 5000,
          indexing_md5s: ["test-md5-1"],
          existing_metadata: {
            user_id: "test-user",
            all_keys: ["user_id"],
          },
        },
        paramsMD5: "test-md5-2",
      };

      await processCollectorJob(undefined, updateJob);

      // Verify the timestamps were preserved
      const client = await esClient({ test: true });
      const response = await client.get({
        index: TRACE_INDEX.alias,
        id: traceIndexId({ traceId, projectId }),
      });

      const trace = response._source as ElasticSearchTrace;
      const updatedSpan = trace.spans?.find((s) => s.span_id === spanId1);
      const unchangedSpan = trace.spans?.find((s) => s.span_id === spanId2);

      // The updated span should preserve original timestamps
      expect(updatedSpan?.timestamps.started_at).toBe(originalStartedAt);
      expect(updatedSpan?.timestamps.first_token_at).toBe(originalFirstTokenAt);
      expect(updatedSpan?.timestamps.finished_at).toBe(originalFinishedAt);

      // But other fields should be updated
      expect(updatedSpan?.name).toBe("Updated LLM Call");
      expect(updatedSpan?.input?.value).toBe(JSON.stringify("Hello Updated"));

      // The unchanged span should still exist
      expect(unchangedSpan?.timestamps.started_at).toBe(
        originalStartedAt + 1000
      );
      expect(unchangedSpan?.timestamps.finished_at).toBe(
        originalFinishedAt + 1000
      );
    });

    it("should use provided timestamps when ignore_timestamps_on_write is true but no existing trace exists", async () => {
      const traceId = `test-trace-new-${nanoid()}`;
      const spanId = `test-span-new-${nanoid()}`;

      const providedStartedAt = Date.now() - 5000; // 5 seconds ago
      const providedFirstTokenAt = Date.now() - 4000; // 4 seconds ago
      const providedFinishedAt = Date.now() - 3000; // 3 seconds ago

      // Create a new trace with ignore_timestamps_on_write = true
      const newJob: CollectorJob = {
        spans: [
          {
            span_id: spanId,
            trace_id: traceId,
            type: "llm",
            name: "New LLM Call",
            timestamps: {
              ignore_timestamps_on_write: true,
              started_at: providedStartedAt,
              first_token_at: providedFirstTokenAt,
              finished_at: providedFinishedAt,
            },
            input: { type: "text", value: "New Hello" },
            output: { type: "text", value: "New Hi there!" },
          } as Span,
        ],
        evaluations: undefined,
        traceId,
        projectId,
        expectedOutput: null,
        reservedTraceMetadata: {
          user_id: "test-user-new",
        },
        customMetadata: {},
        collectedAt: Date.now(),
        paramsMD5: "test-md5-new",
      };

      await processCollectorJob(undefined, newJob);

      // Verify the provided timestamps were used since no existing trace
      const client = await esClient({ test: true });
      const response = await client.get({
        index: TRACE_INDEX.alias,
        id: traceIndexId({ traceId, projectId }),
      });

      const trace = response._source as ElasticSearchTrace;
      const span = trace.spans?.find((s) => s.span_id === spanId);

      // Should use the provided timestamps since there was no existing trace
      expect(span?.timestamps.started_at).toBe(providedStartedAt);
      expect(span?.timestamps.first_token_at).toBe(providedFirstTokenAt);
      expect(span?.timestamps.finished_at).toBe(providedFinishedAt);

      // Other fields should be set correctly
      expect(span?.name).toBe("New LLM Call");
      expect(span?.input?.value).toBe(JSON.stringify("New Hello"));
      expect(trace.timestamps.started_at).toBe(providedStartedAt);
    });

    it("should use existing timestamps when ignore_timestamps_on_write is false or not set", async () => {
      const traceId = `test-trace-normal-${nanoid()}`;
      const spanId = `test-span-normal-${nanoid()}`;

      const beforeTime = Date.now();

      // Create a trace without ignore_timestamps_on_write
      const normalJob: CollectorJob = {
        spans: [
          {
            span_id: spanId,
            trace_id: traceId,
            type: "llm",
            name: "Normal LLM Call",
            timestamps: {
              started_at: Date.now() - 10000,
              finished_at: Date.now() - 9000,
            },
            input: { type: "text", value: "Normal Hello" },
            output: { type: "text", value: "Normal Hi there!" },
          } as Span,
        ],
        evaluations: undefined,
        traceId,
        projectId,
        expectedOutput: null,
        reservedTraceMetadata: {
          user_id: "test-user-normal",
        },
        customMetadata: {},
        collectedAt: Date.now(),
        paramsMD5: "test-md5-normal",
      };

      await processCollectorJob(undefined, normalJob);

      const afterTime = Date.now();

      // Verify current timestamps were used for ES fields
      const client = await esClient({ test: true });
      const response = await client.get({
        index: TRACE_INDEX.alias,
        id: traceIndexId({ traceId, projectId }),
      });

      const trace = response._source as ElasticSearchTrace;
      const span = trace.spans?.find((s) => s.span_id === spanId);

      // Verify span exists and has correct content
      expect(span).toBeDefined();
      expect(span?.name).toBe("Normal LLM Call");

      // Should preserve the provided started_at and finished_at
      if (span) {
        expect(span.timestamps.started_at).toBe(
          normalJob.spans[0]!.timestamps.started_at
        );
        expect(span.timestamps.finished_at).toBe(
          normalJob.spans[0]!.timestamps.finished_at
        );
        // inserted_at and updated_at should be set to current time (cast to any for ES-specific fields)
        const esSpan = span as ElasticSearchSpan;
        expect(esSpan.timestamps.inserted_at).toBeGreaterThanOrEqual(
          beforeTime
        );
        expect(esSpan.timestamps.inserted_at).toBeLessThanOrEqual(afterTime);
        expect(esSpan.timestamps.updated_at).toBeGreaterThanOrEqual(beforeTime);
        expect(esSpan.timestamps.updated_at).toBeLessThanOrEqual(afterTime);
      }
    });
  });
});
