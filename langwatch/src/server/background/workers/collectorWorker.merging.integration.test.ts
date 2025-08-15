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

    it("should handle evaluations", async () => {
      const traceId = `test-eval-${nanoid()}`;
      const spanId = `test-span-${nanoid()}`;
      const evalId = `test-eval-${nanoid()}`;

      // Create trace with evaluation
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
        evaluations: [
          {
            evaluator_id: evalId,
            name: "Test Evaluator",
            score: 0.8,
            passed: true,
          },
        ],
        traceId,
        projectId,
        expectedOutput: null,
        reservedTraceMetadata: {},
        customMetadata: {},
        collectedAt: Date.now(),
        paramsMD5: "test-md5-1",
      };

      await processCollectorJob(undefined, initialJob);

      // Verify evaluation exists
      const client = await esClient({ test: true });
      const response = await client.get({
        index: TRACE_INDEX.alias,
        id: traceIndexId({ traceId, projectId }),
      });

      const trace = response._source as ElasticSearchTrace;

      expect(trace.evaluations).toHaveLength(1);
      expect(trace.evaluations?.[0]?.evaluator_id).toBe(evalId);
      expect(trace.evaluations?.[0]?.score).toBe(0.8);
      expect(trace.evaluations?.[0]?.passed).toBe(true);
    });

    it("should preserve input/output for spans with preserve flag", async () => {
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
            params: {
              "__internal_langwatch_preserve_existing_io": true,
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

      // Update with empty input/output (should be ignored for spans with preserve flag)
      const updateJob: CollectorJob = {
        spans: [
          {
            span_id: spanId,
            trace_id: traceId,
            type: "llm",
            name: "Updated Log Record Call",
            input: { type: "text", value: "" }, // Empty - should be ignored
            output: null, // Null - should be ignored
            timestamps: {
              started_at: Date.now() - 1000,
              finished_at: Date.now(),
            },
            params: {
              "__internal_langwatch_preserve_existing_io": true,
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

      // Input/output should be preserved (not overwritten by empty/null values due to preserve flag)
      expect(span?.input?.value).toBe(JSON.stringify("Log record input"));
      expect(span?.output?.value).toBe(JSON.stringify("Log record output"));

      // Other fields should be updated
      expect(span?.name).toBe("Updated Log Record Call");
    });

    it("should allow input/output updates for spans when preserve flag is not set", async () => {
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

      // Update with new input/output values (should be allowed since no preserve flag)
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

      // Input/output should be updated (no preserve flag, so updates are allowed)
      expect(span?.input?.value).toBe(JSON.stringify("New input"));
      expect(span?.output?.value).toBe(JSON.stringify("New output"));
    });

    it("should update trace-level fields normally when no preserve flags are set", async () => {
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

      // Trace-level fields should be updated normally
      expect(trace.input?.value).toBe("Updated Call"); // Computed from updated span name
      expect(trace.output).toBeUndefined(); // No output in spans, so undefined
      expect(trace.expected_output?.value).toBe("New expected output"); // This should be updated
    });

    it("should preserve existing input/output when updating with preserve flag", async () => {
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
            params: {
              "__internal_langwatch_preserve_existing_io": true,
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

      // Existing input/output should be preserved (not overwritten by preserve flag data)
      expect(span?.input?.value).toBe(JSON.stringify("Existing input"));
      expect(span?.output?.value).toBe(JSON.stringify("Existing output"));

      // Other fields should be updated
      expect(span?.name).toBe("Updated Call");
    });
  });

  describe("Trace-Level Input/Output Merging", () => {
    it("should update trace-level input/output when no preserve flags are set", async () => {
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

      // Trace-level fields should be updated normally
      expect(trace.input?.value).toBe("Updated Call"); // Computed from updated span name
      expect(trace.output).toBeUndefined(); // No output in spans
      expect(trace.expected_output?.value).toBe("Updated expected output");
      expect(trace.metadata?.custom?.version).toBe("2.0");
    });

    it("should preserve existing trace-level input/output when spans have preserve flag", async () => {
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
            params: {
              "__internal_langwatch_preserve_existing_io": true,
            },
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

      // Trace-level input/output should be preserved from SDK spans
      expect(trace.input?.value).toBe("SDK input"); // From SDK span, not log record
      expect(trace.output?.value).toBe("SDK output"); // From SDK span, not log record
      expect(trace.expected_output?.value).toBe("Log record expected output"); // This should update
      expect(trace.metadata?.custom?.source).toBe("log_record"); // This should update
      expect(trace.spans).toHaveLength(2);

      // Verify both spans exist
      const sdkSpan = trace.spans?.find((s) => s.span_id === spanId1);
      const logSpan = trace.spans?.find((s) => s.span_id === spanId2);

      expect(sdkSpan?.input?.value).toBe(JSON.stringify("SDK input"));
      expect(sdkSpan?.output?.value).toBe(JSON.stringify("SDK output"));
      expect(logSpan?.input?.value).toBe(JSON.stringify("Log record input"));
      expect(logSpan?.output?.value).toBe(JSON.stringify("Log record output"));
    });

    it("should allow trace-level input/output updates when no spans have preserve flag", async () => {
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

      // Trace-level fields should be updated (no preserve flags on spans)
      // Note: getFirstInputAsText works based on span hierarchy, getLastOutputAsText works based on finish time
      expect(trace.input?.value).toBe("First input"); // From first span (topmost in hierarchy)
      expect(trace.output?.value).toBe("Second output"); // From second span (last to finish)
      expect(trace.expected_output?.value).toBe("Second expected output");
      expect(trace.metadata?.custom?.version).toBe("2.0");
      expect(trace.spans).toHaveLength(2);
    });

    it("should handle mixed preserve flags across spans in same trace", async () => {
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
            params: {
              "__internal_langwatch_preserve_existing_io": true,
            },
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

      // Trace-level input/output should be from the appropriate spans based on function logic
      // Note: getFirstInputAsText works based on span hierarchy, getLastOutputAsText works based on finish time
      expect(trace.input?.value).toBe("SDK input"); // From SDK span (topmost in hierarchy)
      expect(trace.output?.value).toBe("Third output"); // From third span (last to finish)
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
});
