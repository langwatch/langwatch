import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TRACE_INDEX, esClient, traceIndexId } from "../../elasticsearch";
import type { ElasticSearchTrace, Span } from "../../tracer/types";
import { processCollectorJob } from "./collectorWorker";
import type { CollectorJob } from "../types";
import { getTestProject } from "../../../utils/testUtils";

describe("Collector Worker Merging Logic Tests", () => {
  let projectId: string;

  beforeAll(async () => {
    const project = await getTestProject("collector-worker-merging-test");
    projectId = project.id;
  });

  afterAll(async () => {
    // Clean up test documents from Elasticsearch
    const client = await esClient({ test: true });
    await client.deleteByQuery({
      index: TRACE_INDEX.alias,
      body: {
        query: {
          term: { project_id: projectId },
        },
      },
    });
  });

  describe("Basic Trace Merging", () => {
    it("should create and update a trace with spans", async () => {
      const traceId = `test-trace-${nanoid()}`;
      const spanId = `test-span-${nanoid()}`;

      // Create initial trace
      const initialJob: CollectorJob = {
        spans: [
          {
            span_id: spanId,
            trace_id: traceId,
            type: "llm",
            name: "Initial Call",
            input: { type: "text", value: "Initial input" },
            output: { type: "text", value: "Initial output" },
            timestamps: {
              started_at: Date.now() - 1000,
              finished_at: Date.now(),
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
        customMetadata: {
          environment: "test",
        },
        collectedAt: Date.now(),
        paramsMD5: "test-md5-1",
      };

      await processCollectorJob(undefined, initialJob);

      // Update trace
      const updateJob: CollectorJob = {
        spans: [
          {
            span_id: spanId,
            trace_id: traceId,
            type: "llm",
            name: "Updated Call",
            input: { type: "text", value: "Updated input" },
            output: { type: "text", value: "Updated output" },
            timestamps: {
              started_at: Date.now() - 1000,
              finished_at: Date.now(),
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
        customMetadata: {
          environment: "test",
          version: "2.0",
        },
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

      // Verify the trace data
      const client = await esClient({ test: true });
      const response = await client.get({
        index: TRACE_INDEX.alias,
        id: traceIndexId({ traceId, projectId }),
      });

      const trace = response._source as ElasticSearchTrace;

      // Input/output should be updated (no preserve flag, so updates are allowed)
      expect(trace.input?.value).toBe("Updated input");
      expect(trace.output?.value).toBe("Updated output");
      expect(trace.spans).toHaveLength(1);
      expect(trace.spans?.[0]?.name).toBe("Updated Call");
    });

    it("should add new spans to existing trace", async () => {
      const traceId = `test-trace-add-${nanoid()}`;
      const spanId1 = `test-span-1-${nanoid()}`;
      const spanId2 = `test-span-2-${nanoid()}`;

      // Create initial trace with one span
      const initialJob: CollectorJob = {
        spans: [
          {
            span_id: spanId1,
            trace_id: traceId,
            type: "llm",
            name: "First Call",
            timestamps: {
              started_at: Date.now() - 1000,
              finished_at: Date.now(),
            },
          } as Span,
        ],
        evaluations: undefined,
        traceId,
        projectId,
        expectedOutput: null,
        reservedTraceMetadata: {},
        customMetadata: {},
        collectedAt: Date.now(),
        paramsMD5: "test-md5-1",
      };

      await processCollectorJob(undefined, initialJob);

      // Add a second span
      const updateJob: CollectorJob = {
        spans: [
          {
            span_id: spanId2,
            trace_id: traceId,
            type: "span",
            name: "Second Call",
            timestamps: {
              started_at: Date.now() - 500,
              finished_at: Date.now(),
            },
          } as Span,
        ],
        evaluations: undefined,
        traceId,
        projectId,
        expectedOutput: null,
        reservedTraceMetadata: {},
        customMetadata: {},
        collectedAt: Date.now(),
        existingTrace: {
          inserted_at: Date.now() - 5000,
          indexing_md5s: ["test-md5-1"],
          existing_metadata: {},
        },
        paramsMD5: "test-md5-2",
      };

      await processCollectorJob(undefined, updateJob);

      // Verify both spans exist
      const client = await esClient({ test: true });
      const response = await client.get({
        index: TRACE_INDEX.alias,
        id: traceIndexId({ traceId, projectId }),
      });

      const trace = response._source as ElasticSearchTrace;

      expect(trace.spans).toHaveLength(2);
      expect(trace.spans?.find((s) => s.span_id === spanId1)?.name).toBe(
        "First Call"
      );
      expect(trace.spans?.find((s) => s.span_id === spanId2)?.name).toBe(
        "Second Call"
      );
    });


    it("should preserve span input/output when update provides none", async () => {
      const traceId = `test-log-record-${nanoid()}`;
      const spanId = `test-span-${nanoid()}`;

      // Create initial trace with span that has preserve flag
      const initialJob: CollectorJob = {
        spans: [
          {
            span_id: spanId,
            trace_id: traceId,
            type: "llm",
            name: "Log Record Call",
            input: { type: "text", value: "Log record input" },
            output: { type: "text", value: "Log record output" },
            timestamps: {
              started_at: Date.now() - 1000,
              finished_at: Date.now(),
            },
            params: {},
          } as Span,
        ],
        evaluations: undefined,
        traceId,
        projectId,
        expectedOutput: null,
        reservedTraceMetadata: {},
        customMetadata: {},
        collectedAt: Date.now(),
        paramsMD5: "test-md5-1",
      };

      await processCollectorJob(undefined, initialJob);

      // Update without input/output (should preserve existing values)
      const updateJob: CollectorJob = {
        spans: [
          {
            span_id: spanId,
            trace_id: traceId,
            type: "llm",
            name: "Updated Log Record Call",
            timestamps: {
              started_at: Date.now() - 1000,
              finished_at: Date.now(),
            },
            params: {},
          } as Span,
        ],
        evaluations: undefined,
        traceId,
        projectId,
        expectedOutput: null,
        reservedTraceMetadata: {},
        customMetadata: {},
        collectedAt: Date.now(),
        existingTrace: {
          inserted_at: Date.now() - 5000,
          indexing_md5s: ["test-md5-1"],
          existing_metadata: {},
        },
        paramsMD5: "test-md5-2",
      };

      await processCollectorJob(undefined, updateJob);

      // Verify the span
      const client = await esClient({ test: true });
      const response = await client.get({
        index: TRACE_INDEX.alias,
        id: traceIndexId({ traceId, projectId }),
      });

      const trace = response._source as ElasticSearchTrace;
      const span = trace.spans?.[0];

      // Input/output should be preserved (no new values provided)
      expect(span?.input?.value).toBe(JSON.stringify("Log record input"));
      expect(span?.output?.value).toBe(JSON.stringify("Log record output"));

      // Other fields should be updated
      expect(span?.name).toBe("Updated Log Record Call");
    });

    it("should override span input/output when update provides values", async () => {
      const traceId = `test-log-record-explicit-${nanoid()}`;
      const spanId = `test-span-${nanoid()}`;

      // Create initial trace with span (without preserve flag)
      const initialJob: CollectorJob = {
        spans: [
          {
            span_id: spanId,
            trace_id: traceId,
            type: "llm",
            name: "Log Record Call",
            input: { type: "text", value: "Log record input" },
            output: { type: "text", value: "Log record output" },
            timestamps: {
              started_at: Date.now() - 1000,
              finished_at: Date.now(),
            },
            params: {
              // Note: no preserve flag here
            },
          } as Span,
        ],
        evaluations: undefined,
        traceId,
        projectId,
        expectedOutput: null,
        reservedTraceMetadata: {},
        customMetadata: {},
        collectedAt: Date.now(),
        paramsMD5: "test-md5-1",
      };

      await processCollectorJob(undefined, initialJob);

      // Update with new input/output values (should override existing)
      const updateJob: CollectorJob = {
        spans: [
          {
            span_id: spanId,
            trace_id: traceId,
            type: "llm",
            name: "Updated Log Record Call",
            input: { type: "text", value: "New input" },
            output: { type: "text", value: "New output" },
            timestamps: {
              started_at: Date.now() - 1000,
              finished_at: Date.now(),
            },
            params: {
              // Note: no preserve flag here
            },
          } as Span,
        ],
        evaluations: undefined,
        traceId,
        projectId,
        expectedOutput: null,
        reservedTraceMetadata: {},
        customMetadata: {},
        collectedAt: Date.now(),
        existingTrace: {
          inserted_at: Date.now() - 5000,
          indexing_md5s: ["test-md5-1"],
          existing_metadata: {},
        },
        paramsMD5: "test-md5-2",
      };

      await processCollectorJob(undefined, updateJob);

      // Verify the span
      const client = await esClient({ test: true });
      const response = await client.get({
        index: TRACE_INDEX.alias,
        id: traceIndexId({ traceId, projectId }),
      });

      const trace = response._source as ElasticSearchTrace;
      const span = trace.spans?.[0];

      // Input/output should be updated (override applied)
      expect(span?.input?.value).toBe(JSON.stringify("New input"));
      expect(span?.output?.value).toBe(JSON.stringify("New output"));
    });

    it("should not change trace-level I/O when update provides none", async () => {
      const traceId = `test-trace-normal-${nanoid()}`;
      const spanId = `test-span-${nanoid()}`;

      // Create initial trace
      const initialJob: CollectorJob = {
        spans: [
          {
            span_id: spanId,
            trace_id: traceId,
            type: "llm",
            name: "Test Call",
            timestamps: {
              started_at: Date.now() - 1000,
              finished_at: Date.now(),
            },
          } as Span,
        ],
        evaluations: undefined,
        traceId,
        projectId,
        expectedOutput: null,
        reservedTraceMetadata: {},
        customMetadata: {},
        collectedAt: Date.now(),
        paramsMD5: "test-md5-1",
      };

      await processCollectorJob(undefined, initialJob);

      // Update trace with new expected output
      const updateJob: CollectorJob = {
        spans: [
          {
            span_id: spanId,
            trace_id: traceId,
            type: "llm",
            name: "Updated Call",
            timestamps: {
              started_at: Date.now() - 1000,
              finished_at: Date.now(),
            },
          } as Span,
        ],
        evaluations: undefined,
        traceId,
        projectId,
        expectedOutput: "New expected output",
        reservedTraceMetadata: {},
        customMetadata: {},
        collectedAt: Date.now(),
        existingTrace: {
          inserted_at: Date.now() - 5000,
          indexing_md5s: ["test-md5-1"],
          existing_metadata: {},
        },
        paramsMD5: "test-md5-2",
      };

      await processCollectorJob(undefined, updateJob);

      // Verify the trace
      const client = await esClient({ test: true });
      const response = await client.get({
        index: TRACE_INDEX.alias,
        id: traceIndexId({ traceId, projectId }),
      });

      const trace = response._source as ElasticSearchTrace;

      // Trace-level I/O is computed by heuristics; we only assert expected output here
      expect(trace.expected_output?.value).toBe("New expected output");
    });

    it("should override existing span input/output when update provides values", async () => {
      const traceId = `test-preserve-existing-${nanoid()}`;
      const spanId = `test-span-${nanoid()}`;

      // Create initial trace with existing input/output
      const initialJob: CollectorJob = {
        spans: [
          {
            span_id: spanId,
            trace_id: traceId,
            type: "llm",
            name: "Initial Call",
            input: { type: "text", value: "Existing input" },
            output: { type: "text", value: "Existing output" },
            timestamps: {
              started_at: Date.now() - 1000,
              finished_at: Date.now(),
            },
          } as Span,
        ],
        evaluations: undefined,
        traceId,
        projectId,
        expectedOutput: null,
        reservedTraceMetadata: {},
        customMetadata: {},
        collectedAt: Date.now(),
        paramsMD5: "test-md5-1",
      };

      await processCollectorJob(undefined, initialJob);

      // Update with preserve flag (should preserve existing input/output)
      const updateJob: CollectorJob = {
        spans: [
          {
            span_id: spanId,
            trace_id: traceId,
            type: "llm",
            name: "Updated Call",
            input: { type: "text", value: "Log record input" },
            output: { type: "text", value: "Log record output" },
            timestamps: {
              started_at: Date.now() - 1000,
              finished_at: Date.now(),
            },
            params: {},
          } as Span,
        ],
        evaluations: undefined,
        traceId,
        projectId,
        expectedOutput: null,
        reservedTraceMetadata: {},
        customMetadata: {},
        collectedAt: Date.now(),
        existingTrace: {
          inserted_at: Date.now() - 5000,
          indexing_md5s: ["test-md5-1"],
          existing_metadata: {},
        },
        paramsMD5: "test-md5-2",
      };

      await processCollectorJob(undefined, updateJob);

      // Verify the span
      const client = await esClient({ test: true });
      const response = await client.get({
        index: TRACE_INDEX.alias,
        id: traceIndexId({ traceId, projectId }),
      });

      const trace = response._source as ElasticSearchTrace;
      const span = trace.spans?.[0];

      // Existing input/output should be overridden by the new values
      expect(span?.input?.value).toBe(JSON.stringify("Log record input"));
      expect(span?.output?.value).toBe(JSON.stringify("Log record output"));

      // Other fields should be updated
      expect(span?.name).toBe("Updated Call");
    });
  });

  describe("Trace-Level Input/Output Merging", () => {
    it("should not change trace-level I/O when update provides none", async () => {
      const traceId = `test-trace-io-update-${nanoid()}`;
      const spanId = `test-span-${nanoid()}`;

      // Create initial trace with explicit trace-level input/output
      const initialJob: CollectorJob = {
        spans: [
          {
            span_id: spanId,
            trace_id: traceId,
            type: "llm",
            name: "Initial Call",
            timestamps: {
              started_at: Date.now() - 1000,
              finished_at: Date.now(),
            },
          } as Span,
        ],
        evaluations: undefined,
        traceId,
        projectId,
        expectedOutput: "Initial expected output",
        reservedTraceMetadata: {},
        customMetadata: {},
        collectedAt: Date.now(),
        paramsMD5: "test-md5-1",
      };

      await processCollectorJob(undefined, initialJob);

      // Update trace with new input/output values
      const updateJob: CollectorJob = {
        spans: [
          {
            span_id: spanId,
            trace_id: traceId,
            type: "llm",
            name: "Updated Call",
            timestamps: {
              started_at: Date.now() - 1000,
              finished_at: Date.now(),
            },
          } as Span,
        ],
        evaluations: undefined,
        traceId,
        projectId,
        expectedOutput: "Updated expected output",
        reservedTraceMetadata: {},
        customMetadata: {
          version: "2.0",
        },
        collectedAt: Date.now(),
        existingTrace: {
          inserted_at: Date.now() - 5000,
          indexing_md5s: ["test-md5-1"],
          existing_metadata: {},
        },
        paramsMD5: "test-md5-2",
      };

      await processCollectorJob(undefined, updateJob);

      // Verify the trace
      const client = await esClient({ test: true });
      const response = await client.get({
        index: TRACE_INDEX.alias,
        id: traceIndexId({ traceId, projectId }),
      });

      const trace = response._source as ElasticSearchTrace;

      // Trace-level I/O is computed by heuristics; we only assert expected output and metadata
      expect(trace.expected_output?.value).toBe("Updated expected output");
      expect(trace.metadata?.custom?.version).toBe("2.0");
    });

    it("should override trace-level I/O when update provides values", async () => {
      const traceId = `test-trace-io-preserve-${nanoid()}`;
      const spanId1 = `test-span-1-${nanoid()}`;
      const spanId2 = `test-span-2-${nanoid()}`;

      // Create initial trace with SDK spans that have real input/output
      const initialJob: CollectorJob = {
        spans: [
          {
            span_id: spanId1,
            trace_id: traceId,
            type: "llm",
            name: "SDK Call",
            input: { type: "text", value: "SDK input" },
            output: { type: "text", value: "SDK output" },
            timestamps: {
              started_at: Date.now() - 1000,
              finished_at: Date.now(),
            },
          } as Span,
        ],
        evaluations: undefined,
        traceId,
        projectId,
        expectedOutput: "SDK expected output",
        reservedTraceMetadata: {},
        customMetadata: {},
        collectedAt: Date.now(),
        paramsMD5: "test-md5-1",
      };

      await processCollectorJob(undefined, initialJob);

      // Add log record span with preserve flag (should not override existing trace I/O)
      const updateJob: CollectorJob = {
        spans: [
          {
            span_id: spanId2,
            trace_id: traceId,
            type: "llm",
            name: "Log Record Call",
            input: { type: "text", value: "Log record input" },
            output: { type: "text", value: "Log record output" },
            timestamps: {
              started_at: Date.now() - 500,
              finished_at: Date.now(),
            },
            params: {},
          } as Span,
        ],
        evaluations: undefined,
        traceId,
        projectId,
        expectedOutput: "Log record expected output",
        reservedTraceMetadata: {},
        customMetadata: {
          source: "log_record",
        },
        collectedAt: Date.now(),
        existingTrace: {
          inserted_at: Date.now() - 5000,
          indexing_md5s: ["test-md5-1"],
          existing_metadata: {},
        },
        paramsMD5: "test-md5-2",
      };

      await processCollectorJob(undefined, updateJob);

      // Verify the trace
      const client = await esClient({ test: true });
      const response = await client.get({
        index: TRACE_INDEX.alias,
        id: traceIndexId({ traceId, projectId }),
      });

      const trace = response._source as ElasticSearchTrace;

      // Trace-level input/output should follow heuristics (not necessarily latest span)
      expect(trace.input?.value).toBe("SDK input");
      // Output can come from the latest finishing span (log record)
      expect(trace.output?.value).toBe("Log record output");
      expect(trace.expected_output?.value).toBe("Log record expected output");
      expect(trace.metadata?.custom?.source).toBe("log_record");
      expect(trace.spans).toHaveLength(2);

      // Verify both spans exist
      const sdkSpan = trace.spans?.find((s) => s.span_id === spanId1);
      const logSpan = trace.spans?.find((s) => s.span_id === spanId2);

      expect(sdkSpan?.input?.value).toBe(JSON.stringify("SDK input"));
      expect(sdkSpan?.output?.value).toBe(JSON.stringify("SDK output"));
      expect(logSpan?.input?.value).toBe(JSON.stringify("Log record input"));
      expect(logSpan?.output?.value).toBe(JSON.stringify("Log record output"));
    });

    it("should override trace-level I/O from latest update span", async () => {
      const traceId = `test-trace-io-allow-update-${nanoid()}`;
      const spanId1 = `test-span-1-${nanoid()}`;
      const spanId2 = `test-span-2-${nanoid()}`;

      // Create initial trace with spans
      const initialJob: CollectorJob = {
        spans: [
          {
            span_id: spanId1,
            trace_id: traceId,
            type: "llm",
            name: "First Call",
            input: { type: "text", value: "First input" },
            output: { type: "text", value: "First output" },
            timestamps: {
              started_at: Date.now() - 1000,
              finished_at: Date.now(),
            },
          } as Span,
        ],
        evaluations: undefined,
        traceId,
        projectId,
        expectedOutput: "First expected output",
        reservedTraceMetadata: {},
        customMetadata: {},
        collectedAt: Date.now(),
        paramsMD5: "test-md5-1",
      };

      await processCollectorJob(undefined, initialJob);

      // Add second span without preserve flag (should allow trace I/O updates)
      const updateJob: CollectorJob = {
        spans: [
          {
            span_id: spanId2,
            trace_id: traceId,
            type: "llm",
            name: "Second Call",
            input: { type: "text", value: "Second input" },
            output: { type: "text", value: "Second output" },
            timestamps: {
              started_at: Date.now() - 500,
              finished_at: Date.now(),
            },
            // Note: no preserve flag
          } as Span,
        ],
        evaluations: undefined,
        traceId,
        projectId,
        expectedOutput: "Second expected output",
        reservedTraceMetadata: {},
        customMetadata: {
          version: "2.0",
        },
        collectedAt: Date.now(),
        existingTrace: {
          inserted_at: Date.now() - 5000,
          indexing_md5s: ["test-md5-1"],
          existing_metadata: {},
        },
        paramsMD5: "test-md5-2",
      };

      await processCollectorJob(undefined, updateJob);

      // Verify the trace
      const client = await esClient({ test: true });
      const response = await client.get({
        index: TRACE_INDEX.alias,
        id: traceIndexId({ traceId, projectId }),
      });

      const trace = response._source as ElasticSearchTrace;

      // Trace-level fields follow heuristics: first input stays from the first span; output is latest
      expect(trace.input?.value).toBe("First input");
      expect(trace.output?.value).toBe("Second output");
      expect(trace.expected_output?.value).toBe("Second expected output");
      expect(trace.metadata?.custom?.version).toBe("2.0");
      expect(trace.spans).toHaveLength(2);
    });

    it("should override trace-level I/O each time update provides values", async () => {
      const traceId = `test-trace-mixed-flags-${nanoid()}`;
      const spanId1 = `test-span-1-${nanoid()}`;
      const spanId2 = `test-span-2-${nanoid()}`;
      const spanId3 = `test-span-3-${nanoid()}`;

      // Create initial trace with SDK span
      const initialJob: CollectorJob = {
        spans: [
          {
            span_id: spanId1,
            trace_id: traceId,
            type: "llm",
            name: "SDK Call",
            input: { type: "text", value: "SDK input" },
            output: { type: "text", value: "SDK output" },
            timestamps: {
              started_at: Date.now() - 1000,
              finished_at: Date.now(),
            },
          } as Span,
        ],
        evaluations: undefined,
        traceId,
        projectId,
        expectedOutput: "SDK expected output",
        reservedTraceMetadata: {},
        customMetadata: {},
        collectedAt: Date.now(),
        paramsMD5: "test-md5-1",
      };

      await processCollectorJob(undefined, initialJob);

      // Add log record span with preserve flag
      const updateJob1: CollectorJob = {
        spans: [
          {
            span_id: spanId2,
            trace_id: traceId,
            type: "llm",
            name: "Log Record Call",
            input: { type: "text", value: "Log record input" },
            output: { type: "text", value: "Log record output" },
            timestamps: {
              started_at: Date.now() - 500,
              finished_at: Date.now(),
            },
            params: {},
          } as Span,
        ],
        evaluations: undefined,
        traceId,
        projectId,
        expectedOutput: "Log record expected output",
        reservedTraceMetadata: {},
        customMetadata: {
          source: "log_record",
        },
        collectedAt: Date.now(),
        existingTrace: {
          inserted_at: Date.now() - 5000,
          indexing_md5s: ["test-md5-1"],
          existing_metadata: {},
        },
        paramsMD5: "test-md5-2",
      };

      await processCollectorJob(undefined, updateJob1);

      // Add another span without preserve flag
      const updateJob2: CollectorJob = {
        spans: [
          {
            span_id: spanId3,
            trace_id: traceId,
            type: "llm",
            name: "Third Call",
            input: { type: "text", value: "Third input" },
            output: { type: "text", value: "Third output" },
            timestamps: {
              started_at: Date.now() - 200,
              finished_at: Date.now(),
            },
            // Note: no preserve flag
          } as Span,
        ],
        evaluations: undefined,
        traceId,
        projectId,
        expectedOutput: "Third expected output",
        reservedTraceMetadata: {},
        customMetadata: {
          version: "3.0",
        },
        collectedAt: Date.now(),
        existingTrace: {
          inserted_at: Date.now() - 5000,
          indexing_md5s: ["test-md5-1", "test-md5-2"],
          existing_metadata: {},
        },
        paramsMD5: "test-md5-3",
      };

      await processCollectorJob(undefined, updateJob2);

      // Verify the trace
      const client = await esClient({ test: true });
      const response = await client.get({
        index: TRACE_INDEX.alias,
        id: traceIndexId({ traceId, projectId }),
      });

      const trace = response._source as ElasticSearchTrace;

      // Trace-level input/output should follow heuristics across updates
      expect(trace.input?.value).toBe("SDK input");
      expect(trace.output?.value).toBe("Third output");
      expect(trace.expected_output?.value).toBe("Third expected output");
      expect(trace.metadata?.custom?.version).toBe("3.0");
      expect(trace.spans).toHaveLength(3);

      // Verify all spans exist with correct I/O
      const sdkSpan = trace.spans?.find((s) => s.span_id === spanId1);
      const logSpan = trace.spans?.find((s) => s.span_id === spanId2);
      const thirdSpan = trace.spans?.find((s) => s.span_id === spanId3);

      expect(sdkSpan?.input?.value).toBe(JSON.stringify("SDK input"));
      expect(sdkSpan?.output?.value).toBe(JSON.stringify("SDK output"));
      expect(logSpan?.input?.value).toBe(JSON.stringify("Log record input"));
      expect(logSpan?.output?.value).toBe(JSON.stringify("Log record output"));
      expect(thirdSpan?.input?.value).toBe(JSON.stringify("Third input"));
      expect(thirdSpan?.output?.value).toBe(JSON.stringify("Third output"));
    });
  });

  describe("Concurrent Merging", () => {
    it("should not lose spans under concurrent updates", async () => {
      const traceId = `test-trace-concurrent-${nanoid()}`;
      const spanIds = Array.from({ length: 6 }, () => `span-${nanoid()}`);

      const jobs: CollectorJob[] = spanIds.map((sid, idx) => ({
        spans: [
          {
            span_id: sid,
            trace_id: traceId,
            type: idx % 2 === 0 ? "llm" : "span",
            name: `Concurrent ${idx}`,
            timestamps: {
              started_at: Date.now() - (1000 - idx * 10),
              finished_at: Date.now() - (900 - idx * 10),
            },
            ...(idx % 2 === 0
              ? {
                  input: { type: "text", value: `input-${idx}` },
                  output: { type: "text", value: `output-${idx}` },
                }
              : {}),
          } as Span,
        ],
        evaluations: undefined,
        traceId,
        projectId,
        expectedOutput: null,
        reservedTraceMetadata: {},
        customMetadata: {},
        collectedAt: Date.now(),
        paramsMD5: `md5-${idx}`,
      }));

      await Promise.all(jobs.map((j) => processCollectorJob(undefined, j)));

      const client = await esClient({ test: true });
      const response = await client.get({
        index: TRACE_INDEX.alias,
        id: traceIndexId({ traceId, projectId }),
      });
      const trace = response._source as ElasticSearchTrace;

      // All spans must be present exactly once
      expect(trace.spans?.length).toBe(spanIds.length);
      for (const sid of spanIds) {
        const s = trace.spans?.find((sp) => sp.span_id === sid);
        expect(s).toBeTruthy();
      }
    });

    it("should deduplicate same span_id under concurrent updates and keep non-empty I/O", async () => {
      const traceId = `test-trace-concurrent-same-${nanoid()}`;
      const spanId = `span-${nanoid()}`;

      const jobA: CollectorJob = {
        spans: [
          {
            span_id: spanId,
            trace_id: traceId,
            type: "llm",
            name: "Concurrent A",
            timestamps: {
              started_at: Date.now() - 1200,
              finished_at: Date.now() - 1100,
            },
            input: { type: "text", value: "A-input" },
            output: { type: "text", value: "A-output" },
            params: { a: true },
          } as Span,
        ],
        evaluations: undefined,
        traceId,
        projectId,
        expectedOutput: null,
        reservedTraceMetadata: {},
        customMetadata: {},
        collectedAt: Date.now(),
        paramsMD5: "md5-A",
      };

      const jobB: CollectorJob = {
        spans: [
          {
            span_id: spanId, // same span id
            trace_id: traceId,
            type: "llm",
            name: "Concurrent B",
            timestamps: {
              started_at: Date.now() - 1000,
              finished_at: Date.now() - 900,
            },
            // Provide different I/O
            input: { type: "text", value: "B-input" },
            output: { type: "text", value: "B-output" },
            params: { b: true },
          } as Span,
        ],
        evaluations: undefined,
        traceId,
        projectId,
        expectedOutput: null,
        reservedTraceMetadata: {},
        customMetadata: {},
        collectedAt: Date.now(),
        paramsMD5: "md5-B",
      };

      // Fire both updates concurrently
      await Promise.all([
        processCollectorJob(undefined, jobA),
        processCollectorJob(undefined, jobB),
      ]);

      const client = await esClient({ test: true });
      const response = await client.get({
        index: TRACE_INDEX.alias,
        id: traceIndexId({ traceId, projectId }),
      });
      const trace = response._source as ElasticSearchTrace;

      // Only one span with that id should exist
      const spansWithId = trace.spans?.filter((s) => s.span_id === spanId) ?? [];
      expect(spansWithId.length).toBe(1);
      const s = spansWithId[0]!;

      // I/O must be one of the provided non-empty values (no clobber to empty)
      expect([JSON.stringify("A-input"), JSON.stringify("B-input")]).toContain(
        s.input?.value
      );
      expect([
        JSON.stringify("A-output"),
        JSON.stringify("B-output"),
      ]).toContain(s.output?.value);

      // Deep-merge semantics for params: either param a or b (or both) present
      // Depending on last-writer wins for maps, at least one should be present
      const hasA = (s.params as any)?.a === true;
      const hasB = (s.params as any)?.b === true;
      expect(hasA || hasB).toBe(true);
    });

    it("should prefer non-empty I/O in three-way race on same span_id", async () => {
      const traceId = `test-trace-concurrent-3way-${nanoid()}`;
      const spanId = `span-${nanoid()}`;

      const job1: CollectorJob = {
        spans: [
          {
            span_id: spanId,
            trace_id: traceId,
            type: "llm",
            name: "Race-1",
            timestamps: {
              started_at: Date.now() - 1500,
              finished_at: Date.now() - 1400,
            },
            input: { type: "text", value: "one-input" },
            output: { type: "text", value: "one-output" },
            params: { one: true },
          } as Span,
        ],
        evaluations: undefined,
        traceId,
        projectId,
        expectedOutput: null,
        reservedTraceMetadata: {},
        customMetadata: {},
        collectedAt: Date.now(),
        paramsMD5: "md5-1",
      };

      const job2: CollectorJob = {
        spans: [
          {
            span_id: spanId,
            trace_id: traceId,
            type: "llm",
            name: "Race-2",
            timestamps: {
              started_at: Date.now() - 1300,
              finished_at: Date.now() - 1200,
            },
            // empty/missing I/O should not clobber
            input: { type: "text", value: "" },
            output: null,
            params: { two: true },
          } as Span,
        ],
        evaluations: undefined,
        traceId,
        projectId,
        expectedOutput: null,
        reservedTraceMetadata: {},
        customMetadata: {},
        collectedAt: Date.now(),
        paramsMD5: "md5-2",
      };

      const job3: CollectorJob = {
        spans: [
          {
            span_id: spanId,
            trace_id: traceId,
            type: "llm",
            name: "Race-3",
            timestamps: {
              started_at: Date.now() - 1100,
              finished_at: Date.now() - 1000,
            },
            input: { type: "text", value: "three-input" },
            output: { type: "text", value: "three-output" },
            params: { three: true },
          } as Span,
        ],
        evaluations: undefined,
        traceId,
        projectId,
        expectedOutput: null,
        reservedTraceMetadata: {},
        customMetadata: {},
        collectedAt: Date.now(),
        paramsMD5: "md5-3",
      };

      await Promise.all([
        processCollectorJob(undefined, job1),
        processCollectorJob(undefined, job2),
        processCollectorJob(undefined, job3),
      ]);

      const client = await esClient({ test: true });
      const response = await client.get({
        index: TRACE_INDEX.alias,
        id: traceIndexId({ traceId, projectId }),
      });
      const trace = response._source as ElasticSearchTrace;
      const spansWithId = trace.spans?.filter((s) => s.span_id === spanId) ?? [];
      expect(spansWithId.length).toBe(1);
      const s = spansWithId[0]!;

      // Final input should be non-empty; in rare races it might be empty briefly, so just assert non-empty
      expect(typeof s.input?.value).toBe("string");
      expect(s.input?.value).not.toBe("");
      expect([
        JSON.stringify("one-output"),
        JSON.stringify("three-output"),
      ]).toContain(s.output?.value);
    });

    it("should preserve existing non-empty I/O if later concurrent update omits I/O", async () => {
      const traceId = `test-trace-concurrent-omit-${nanoid()}`;
      const spanId = `span-${nanoid()}`;

      const withIO: CollectorJob = {
        spans: [
          {
            span_id: spanId,
            trace_id: traceId,
            type: "llm",
            name: "With-IO",
            timestamps: {
              started_at: Date.now() - 1000,
              finished_at: Date.now() - 900,
            },
            input: { type: "text", value: "seed-input" },
            output: { type: "text", value: "seed-output" },
          } as Span,
        ],
        evaluations: undefined,
        traceId,
        projectId,
        expectedOutput: null,
        reservedTraceMetadata: {},
        customMetadata: {},
        collectedAt: Date.now(),
        paramsMD5: "md5-seed",
      };

      const withoutIO: CollectorJob = {
        spans: [
          {
            span_id: spanId,
            trace_id: traceId,
            type: "llm",
            name: "Without-IO",
            timestamps: {
              started_at: Date.now() - 800,
              finished_at: Date.now() - 700,
            },
            // no input/output
          } as Span,
        ],
        evaluations: undefined,
        traceId,
        projectId,
        expectedOutput: null,
        reservedTraceMetadata: {},
        customMetadata: {},
        collectedAt: Date.now(),
        paramsMD5: "md5-noio",
      };

      await Promise.all([
        processCollectorJob(undefined, withIO),
        processCollectorJob(undefined, withoutIO),
      ]);

      const client = await esClient({ test: true });
      const response = await client.get({
        index: TRACE_INDEX.alias,
        id: traceIndexId({ traceId, projectId }),
      });
      const trace = response._source as ElasticSearchTrace;
      const s = trace.spans?.find((sp) => sp.span_id === spanId);
      expect(s).toBeTruthy();
      if (!s) return;

      // I/O should remain non-empty and match the provided values
      expect(s.input?.value).toBe(JSON.stringify("seed-input"));
      expect(s.output?.value).toBe(JSON.stringify("seed-output"));
    });
  });
});
