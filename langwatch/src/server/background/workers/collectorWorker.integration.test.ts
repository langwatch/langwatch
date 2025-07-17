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

describe("Collector Worker Integration Tests", () => {
  let projectId: string;

  beforeAll(async () => {
    // Create a test organization
    const organization = await prisma.organization.create({
      data: {
        name: "Test Organization for Collector Worker",
        slug: `test-org-${nanoid()}`,
      },
    });

    // Create a test team
    const team = await prisma.team.create({
      data: {
        name: "Test Team for Collector Worker",
        slug: `test-team-${nanoid()}`,
        organizationId: organization.id,
      },
    });

    // Create a test project
    const project = await prisma.project.create({
      data: {
        name: "Test Project for Collector Worker",
        slug: `test-collector-${nanoid()}`,
        teamId: team.id,
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
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { team: { include: { organization: true } } },
    });

    if (project) {
      await prisma.project.delete({
        where: { id: projectId },
      });

      await prisma.team.delete({
        where: { id: project.team.id },
      });

      await prisma.organization.delete({
        where: { id: project.team.organization.id },
      });
    }
  });

  describe("ignore_timestamps_on_write functionality", () => {
    it("should preserve existing timestamps when ignore_timestamps_on_write is true and trace exists", async () => {
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

  describe("cost calculation and aggregation", () => {
    it("should correctly aggregate costs from multiple spans in a single job", async () => {
      const traceId = `test-trace-cost-aggregation-${nanoid()}`;
      const spanId1 = `test-span-cost-1-${nanoid()}`;
      const spanId2 = `test-span-cost-2-${nanoid()}`;
      const spanId3 = `test-span-cost-3-${nanoid()}`;

      // Create a job with multiple spans, each with different costs
      const job: CollectorJob = {
        spans: [
          {
            span_id: spanId1,
            trace_id: traceId,
            type: "llm",
            name: "First LLM Call",
            timestamps: {
              started_at: Date.now() - 10000,
              finished_at: Date.now() - 9000,
            },
            input: { type: "text", value: "First prompt" },
            output: { type: "text", value: "First response" },
            metrics: {
              cost: 0.0001,
              prompt_tokens: 100,
              completion_tokens: 50,
            },
          } as Span,
          {
            span_id: spanId2,
            trace_id: traceId,
            type: "llm",
            name: "Second LLM Call",
            timestamps: {
              started_at: Date.now() - 8000,
              finished_at: Date.now() - 7000,
            },
            input: { type: "text", value: "Second prompt" },
            output: { type: "text", value: "Second response" },
            metrics: {
              cost: 0.0002,
              prompt_tokens: 200,
              completion_tokens: 100,
            },
          } as Span,
          {
            span_id: spanId3,
            trace_id: traceId,
            type: "span",
            name: "Processing",
            timestamps: {
              started_at: Date.now() - 6000,
              finished_at: Date.now() - 5000,
            },
            // No metrics - should not affect cost calculation
          } as Span,
        ],
        evaluations: undefined,
        traceId,
        projectId,
        expectedOutput: null,
        reservedTraceMetadata: {
          user_id: "test-user-cost",
        },
        customMetadata: {},
        collectedAt: Date.now(),
        paramsMD5: "test-md5-cost-1",
      };

      await processCollectorJob(undefined, job);

      // Verify the trace was created with correct aggregated costs
      const client = await esClient({ test: true });
      const response = await client.get({
        index: TRACE_INDEX.alias,
        id: traceIndexId({ traceId, projectId }),
      });

      const trace = response._source as ElasticSearchTrace;

      // Total cost should be sum of all span costs
      expect(trace.metrics?.total_cost).toBe(0.0003); // 0.0001 + 0.0002
      expect(trace.metrics?.prompt_tokens).toBe(300); // 100 + 200
      expect(trace.metrics?.completion_tokens).toBe(150); // 50 + 100

      // Verify all spans are present
      expect(trace.spans).toHaveLength(3);
      expect(
        trace.spans?.find((s) => s.span_id === spanId1)?.metrics?.cost
      ).toBe(0.0001);
      expect(
        trace.spans?.find((s) => s.span_id === spanId2)?.metrics?.cost
      ).toBe(0.0002);
      expect(
        trace.spans?.find((s) => s.span_id === spanId3)?.metrics
      ).toBeUndefined();
    });

    it("should correctly aggregate costs when adding new spans to existing trace", async () => {
      const traceId = `test-trace-cost-incremental-${nanoid()}`;
      const spanId1 = `test-span-incremental-1-${nanoid()}`;
      const spanId2 = `test-span-incremental-2-${nanoid()}`;

      // First job with one span
      const firstJob: CollectorJob = {
        spans: [
          {
            span_id: spanId1,
            trace_id: traceId,
            type: "llm",
            name: "First LLM Call",
            timestamps: {
              started_at: Date.now() - 10000,
              finished_at: Date.now() - 9000,
            },
            input: { type: "text", value: "First prompt" },
            output: { type: "text", value: "First response" },
            metrics: {
              cost: 0.0001,
              prompt_tokens: 100,
              completion_tokens: 50,
            },
          } as Span,
        ],
        evaluations: undefined,
        traceId,
        projectId,
        expectedOutput: null,
        reservedTraceMetadata: {
          user_id: "test-user-incremental",
        },
        customMetadata: {},
        collectedAt: Date.now(),
        paramsMD5: "test-md5-incremental-1",
      };

      await processCollectorJob(undefined, firstJob);

      // Second job with another span, referencing existing trace
      const secondJob: CollectorJob = {
        spans: [
          {
            span_id: spanId2,
            trace_id: traceId,
            type: "llm",
            name: "Second LLM Call",
            timestamps: {
              started_at: Date.now() - 8000,
              finished_at: Date.now() - 7000,
            },
            input: { type: "text", value: "Second prompt" },
            output: { type: "text", value: "Second response" },
            metrics: {
              cost: 0.0002,
              prompt_tokens: 200,
              completion_tokens: 100,
            },
          } as Span,
        ],
        evaluations: undefined,
        traceId,
        projectId,
        expectedOutput: null,
        reservedTraceMetadata: {
          user_id: "test-user-incremental",
        },
        customMetadata: {},
        collectedAt: Date.now(),
        existingTrace: {
          inserted_at: Date.now() - 5000,
          indexing_md5s: ["test-md5-incremental-1"],
          existing_metadata: {
            user_id: "test-user-incremental",
            all_keys: ["user_id"],
          },
        },
        paramsMD5: "test-md5-incremental-2",
      };

      await processCollectorJob(undefined, secondJob);

      // Verify the trace now has aggregated costs from both spans
      const client = await esClient({ test: true });
      const response = await client.get({
        index: TRACE_INDEX.alias,
        id: traceIndexId({ traceId, projectId }),
      });

      const trace = response._source as ElasticSearchTrace;

      // Total cost should be sum of both span costs
      expect(trace.metrics?.total_cost).toBe(0.0003); // 0.0001 + 0.0002
      expect(trace.metrics?.prompt_tokens).toBe(300); // 100 + 200
      expect(trace.metrics?.completion_tokens).toBe(150); // 50 + 100

      // Verify both spans are present with their individual costs
      expect(trace.spans).toHaveLength(2);
      expect(
        trace.spans?.find((s) => s.span_id === spanId1)?.metrics?.cost
      ).toBe(0.0001);
      expect(
        trace.spans?.find((s) => s.span_id === spanId2)?.metrics?.cost
      ).toBe(0.0002);
    });

    it("should handle spans with undefined or null costs correctly", async () => {
      const traceId = `test-trace-cost-null-${nanoid()}`;
      const spanId1 = `test-span-null-1-${nanoid()}`;
      const spanId2 = `test-span-null-2-${nanoid()}`;

      // Job with one span having cost and another without
      const job: CollectorJob = {
        spans: [
          {
            span_id: spanId1,
            trace_id: traceId,
            type: "llm",
            name: "LLM Call with Cost",
            timestamps: {
              started_at: Date.now() - 10000,
              finished_at: Date.now() - 9000,
            },
            input: { type: "text", value: "Prompt with cost" },
            output: { type: "text", value: "Response with cost" },
            metrics: {
              cost: 0.0001,
              prompt_tokens: 100,
              completion_tokens: 50,
            },
          } as Span,
          {
            span_id: spanId2,
            trace_id: traceId,
            type: "llm",
            name: "LLM Call without Cost",
            timestamps: {
              started_at: Date.now() - 8000,
              finished_at: Date.now() - 7000,
            },
            input: { type: "text", value: "Prompt without cost" },
            output: { type: "text", value: "Response without cost" },
            metrics: {
              cost: undefined, // Should be ignored in total cost
              prompt_tokens: 200,
              completion_tokens: 100,
            },
          } as Span,
        ],
        evaluations: undefined,
        traceId,
        projectId,
        expectedOutput: null,
        reservedTraceMetadata: {
          user_id: "test-user-null",
        },
        customMetadata: {},
        collectedAt: Date.now(),
        paramsMD5: "test-md5-null",
      };

      await processCollectorJob(undefined, job);

      // Verify the trace only includes the cost from the span that has it
      const client = await esClient({ test: true });
      const response = await client.get({
        index: TRACE_INDEX.alias,
        id: traceIndexId({ traceId, projectId }),
      });

      const trace = response._source as ElasticSearchTrace;

      // Total cost should only include the span with defined cost
      expect(trace.metrics?.total_cost).toBe(0.0001); // Only from first span
      expect(trace.metrics?.prompt_tokens).toBe(300); // 100 + 200
      expect(trace.metrics?.completion_tokens).toBe(150); // 50 + 100

      // Verify both spans are present
      expect(trace.spans).toHaveLength(2);
      expect(
        trace.spans?.find((s) => s.span_id === spanId1)?.metrics?.cost
      ).toBe(0.0001);
      expect(
        trace.spans?.find((s) => s.span_id === spanId2)?.metrics?.cost
      ).toBeUndefined();
    });

    it("should return null total_cost when no spans have costs", async () => {
      const traceId = `test-trace-no-cost-${nanoid()}`;
      const spanId1 = `test-span-no-cost-1-${nanoid()}`;
      const spanId2 = `test-span-no-cost-2-${nanoid()}`;

      // Job with spans that have no costs
      const job: CollectorJob = {
        spans: [
          {
            span_id: spanId1,
            trace_id: traceId,
            type: "span",
            name: "Processing",
            timestamps: {
              started_at: Date.now() - 10000,
              finished_at: Date.now() - 9000,
            },
            // No metrics
          } as Span,
          {
            span_id: spanId2,
            trace_id: traceId,
            type: "llm",
            name: "LLM Call without Cost",
            timestamps: {
              started_at: Date.now() - 8000,
              finished_at: Date.now() - 7000,
            },
            input: { type: "text", value: "Prompt" },
            output: { type: "text", value: "Response" },
            metrics: {
              cost: undefined,
              prompt_tokens: 100,
              completion_tokens: 50,
            },
          } as Span,
        ],
        evaluations: undefined,
        traceId,
        projectId,
        expectedOutput: null,
        reservedTraceMetadata: {
          user_id: "test-user-no-cost",
        },
        customMetadata: {},
        collectedAt: Date.now(),
        paramsMD5: "test-md5-no-cost",
      };

      await processCollectorJob(undefined, job);

      // Verify the trace has null total_cost
      const client = await esClient({ test: true });
      const response = await client.get({
        index: TRACE_INDEX.alias,
        id: traceIndexId({ traceId, projectId }),
      });

      const trace = response._source as ElasticSearchTrace;

      // Total cost should be null when no spans have costs
      expect(trace.metrics?.total_cost).toBeNull();
      expect(trace.metrics?.prompt_tokens).toBe(100);
      expect(trace.metrics?.completion_tokens).toBe(50);

      // Verify both spans are present
      expect(trace.spans).toHaveLength(2);
      expect(
        trace.spans?.find((s) => s.span_id === spanId1)?.metrics
      ).toBeUndefined();
      expect(
        trace.spans?.find((s) => s.span_id === spanId2)?.metrics?.cost
      ).toBeUndefined();
    });

    it("should deduplicate spans and calculate costs correctly", async () => {
      const traceId = `test-trace-deduplication-${nanoid()}`;
      const spanId = `test-span-deduplication-${nanoid()}`;

      // First job with a span
      const firstJob: CollectorJob = {
        spans: [
          {
            span_id: spanId,
            trace_id: traceId,
            type: "llm",
            name: "LLM Call",
            timestamps: {
              started_at: Date.now() - 10000,
              finished_at: Date.now() - 9000,
            },
            input: { type: "text", value: "Original prompt" },
            output: { type: "text", value: "Original response" },
            metrics: {
              cost: 0.0001,
              prompt_tokens: 100,
              completion_tokens: 50,
            },
          } as Span,
        ],
        evaluations: undefined,
        traceId,
        projectId,
        expectedOutput: null,
        reservedTraceMetadata: {
          user_id: "test-user-dedup",
        },
        customMetadata: {},
        collectedAt: Date.now(),
        paramsMD5: "test-md5-dedup-1",
      };

      await processCollectorJob(undefined, firstJob);

      // Second job with the same span (duplicate) but different cost
      const secondJob: CollectorJob = {
        spans: [
          {
            span_id: spanId, // Same span ID
            trace_id: traceId,
            type: "llm",
            name: "Updated LLM Call",
            timestamps: {
              started_at: Date.now() - 10000,
              finished_at: Date.now() - 9000,
            },
            input: { type: "text", value: "Updated prompt" },
            output: { type: "text", value: "Updated response" },
            metrics: {
              cost: 0.0002, // Different cost
              prompt_tokens: 200, // Different tokens
              completion_tokens: 100,
            },
          } as Span,
        ],
        evaluations: undefined,
        traceId,
        projectId,
        expectedOutput: null,
        reservedTraceMetadata: {
          user_id: "test-user-dedup",
        },
        customMetadata: {},
        collectedAt: Date.now(),
        existingTrace: {
          inserted_at: Date.now() - 5000,
          indexing_md5s: ["test-md5-dedup-1"],
          existing_metadata: {
            user_id: "test-user-dedup",
            all_keys: ["user_id"],
          },
        },
        paramsMD5: "test-md5-dedup-2",
      };

      await processCollectorJob(undefined, secondJob);

      // Verify the trace has only one span (deduplicated) with the updated cost
      const client = await esClient({ test: true });
      const response = await client.get({
        index: TRACE_INDEX.alias,
        id: traceIndexId({ traceId, projectId }),
      });

      const trace = response._source as ElasticSearchTrace;

      // Total cost should be from the updated span (not doubled)
      expect(trace.metrics?.total_cost).toBe(0.0002); // Only the updated cost
      expect(trace.metrics?.prompt_tokens).toBe(200); // Only the updated tokens
      expect(trace.metrics?.completion_tokens).toBe(100);

      // Verify only one span exists (deduplicated)
      expect(trace.spans).toHaveLength(1);
      const span = trace.spans?.[0];
      expect(span?.span_id).toBe(spanId);
      expect(span?.metrics?.cost).toBe(0.0002);
      expect(span?.name).toBe("Updated LLM Call");
      expect(span?.input?.value).toBe(JSON.stringify("Updated prompt"));
    });
  });
});
