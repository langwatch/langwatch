/**
 * End-to-end tests for metadata and labels
 *
 * Tests that all metadata fields (user_id, thread_id, customer_id, labels,
 * custom metadata) are correctly ingested via both:
 * 1. SDK (OpenTelemetry span attributes)
 * 2. REST API (direct HTTP POST to /api/collector)
 */

import { describe, it, expect } from "vitest";
import {
  setupE2ETest,
  createTestTracer,
  generateTestIds,
  delay,
  E2E_CONFIG,
  expectTraceToBeIngested,
  getTraceIdFromSpan,
  expectSpanAttributeWithTrace,
} from "./e2e-utils";
import * as semconv from "../../semconv";

describe("Metadata and Labels E2E", () => {
  const setup = setupE2ETest();

  describe("SDK (OpenTelemetry span attributes)", () => {
    it("should ingest user_id, thread_id, and customer_id", async () => {
      const tracer = createTestTracer("metadata-ids");
      const testIds = generateTestIds();
      let traceId: string;

      await tracer.withActiveSpan("metadata-ids-operation", async (span) => {
        traceId = getTraceIdFromSpan(span);

        span.setAttribute(semconv.ATTR_LANGWATCH_USER_ID, testIds.userId);
        span.setAttribute(semconv.ATTR_LANGWATCH_THREAD_ID, testIds.threadId);
        span.setAttribute(semconv.ATTR_LANGWATCH_CUSTOMER_ID, "test-customer-123");

        span.setType("llm");
        span.setInput({ message: "test" });
        span.setOutput({ response: "test response" });

        await delay(50);
      });

      const trace = await expectTraceToBeIngested(setup.client, traceId!, 1);
      const span = trace.spans![0]!;

      expectSpanAttributeWithTrace(trace, span, semconv.ATTR_LANGWATCH_USER_ID, testIds.userId);
      expectSpanAttributeWithTrace(trace, span, semconv.ATTR_LANGWATCH_THREAD_ID, testIds.threadId);
      expectSpanAttributeWithTrace(trace, span, semconv.ATTR_LANGWATCH_CUSTOMER_ID, "test-customer-123");
    }, E2E_CONFIG.timeout);

    it("should ingest labels", async () => {
      const tracer = createTestTracer("metadata-labels");
      const testIds = generateTestIds();
      let traceId: string;

      const labels = ["e2e-test", "production", "premium-user"];

      await tracer.withActiveSpan("metadata-labels-operation", async (span) => {
        traceId = getTraceIdFromSpan(span);

        span.setAttribute(semconv.ATTR_LANGWATCH_CUSTOMER_ID, testIds.userId);
        span.setAttribute(semconv.ATTR_LANGWATCH_LABELS, JSON.stringify(labels));

        span.setType("llm");
        span.setInput({ message: "test" });

        await delay(50);
      });

      const trace = await expectTraceToBeIngested(setup.client, traceId!, 1);

      // Labels should be on the trace metadata
      const traceLabels = (trace.metadata as any)?.labels;
      expect(traceLabels).toBeTruthy();
      expect(traceLabels).toEqual(expect.arrayContaining(labels));
    }, E2E_CONFIG.timeout);

    it("should ingest custom metadata", async () => {
      const tracer = createTestTracer("metadata-custom");
      const testIds = generateTestIds();
      let traceId: string;

      const customMetadata = {
        feature_flags: ["new-ui", "beta-model"],
        request_source: "e2e-test",
        sdk_version: "1.0.0",
      };

      await tracer.withActiveSpan("metadata-custom-operation", async (span) => {
        traceId = getTraceIdFromSpan(span);

        span.setAttribute(semconv.ATTR_LANGWATCH_CUSTOMER_ID, testIds.userId);
        span.setAttribute("metadata", JSON.stringify(customMetadata));

        span.setType("llm");
        span.setInput({ message: "test" });

        await delay(50);
      });

      const trace = await expectTraceToBeIngested(setup.client, traceId!, 1);

      // Custom metadata should be accessible on the trace
      const metadata = trace.metadata as Record<string, any>;
      expect(metadata).toBeTruthy();
      expect(metadata.request_source).toBe("e2e-test");
      expect(metadata.sdk_version).toBe("1.0.0");
    }, E2E_CONFIG.timeout);

    it("should ingest gen_ai.conversation.id as thread_id", async () => {
      const tracer = createTestTracer("metadata-conversation-id");
      const testIds = generateTestIds();
      let traceId: string;

      const conversationId = `conv-${crypto.randomUUID().slice(0, 8)}`;

      await tracer.withActiveSpan("metadata-convid-operation", async (span) => {
        traceId = getTraceIdFromSpan(span);

        span.setAttribute(semconv.ATTR_LANGWATCH_CUSTOMER_ID, testIds.userId);
        span.setAttribute("gen_ai.conversation.id", conversationId);

        span.setType("llm");
        span.setInput({ message: "test" });

        await delay(50);
      });

      const trace = await expectTraceToBeIngested(setup.client, traceId!, 1);

      // gen_ai.conversation.id should map to thread_id
      const metadata = trace.metadata as Record<string, any>;
      expect(metadata?.thread_id).toBe(conversationId);
    }, E2E_CONFIG.timeout);
  });

  describe("REST API (direct HTTP)", () => {
    /**
     * Sends a trace directly via the REST API collector endpoint.
     */
    async function sendTraceViaRestApi(opts: {
      traceId: string;
      spanId: string;
      metadata: Record<string, any>;
    }): Promise<Response> {
      const nowMs = Date.now();

      return fetch(`${E2E_CONFIG.endpoint}/api/collector`, {
        method: "POST",
        headers: {
          "X-Auth-Token": E2E_CONFIG.apiKey!,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          trace_id: opts.traceId,
          spans: [
            {
              type: "llm",
              span_id: opts.spanId,
              name: "rest-api-test",
              model: "gpt-4o-mini",
              input: { type: "text", value: "Hello" },
              output: { type: "text", value: "Hi there!" },
              timestamps: {
                started_at: nowMs - 500,
                finished_at: nowMs,
              },
            },
          ],
          metadata: opts.metadata,
        }),
      });
    }

    it("should accept traces with all metadata fields via REST API", async () => {
      const traceId = `trace-rest-${crypto.randomUUID().slice(0, 12)}`;
      const spanId = `span-rest-${crypto.randomUUID().slice(0, 12)}`;
      const threadId = `thread-rest-${crypto.randomUUID().slice(0, 8)}`;

      const response = await sendTraceViaRestApi({
        traceId,
        spanId,
        metadata: {
          user_id: "rest-user-123",
          thread_id: threadId,
          customer_id: "rest-customer-456",
          labels: ["rest-api-test", "e2e"],
          custom_field: "custom-value",
          nested_data: { key: "value" },
        },
      });

      expect(response.status).toBe(200);
    }, E2E_CONFIG.timeout);

    it("should ingest REST API metadata and make it queryable", async () => {
      const traceId = `trace-rest-${crypto.randomUUID().slice(0, 12)}`;
      const spanId = `span-rest-${crypto.randomUUID().slice(0, 12)}`;
      const threadId = `thread-rest-${crypto.randomUUID().slice(0, 8)}`;
      const userId = `user-rest-${crypto.randomUUID().slice(0, 8)}`;

      const response = await sendTraceViaRestApi({
        traceId,
        spanId,
        metadata: {
          user_id: userId,
          thread_id: threadId,
          customer_id: "rest-customer-e2e",
          labels: ["rest-api-e2e", "metadata-test"],
          environment: "testing",
        },
      });

      expect(response.status).toBe(200);

      // Wait and verify the trace was ingested with correct metadata
      const trace = await expectTraceToBeIngested(setup.client, traceId, 1);

      const metadata = trace.metadata as Record<string, any>;
      expect(metadata).toBeTruthy();
      expect(metadata.user_id).toBe(userId);
      expect(metadata.thread_id).toBe(threadId);
      expect(metadata.customer_id).toBe("rest-customer-e2e");
      expect(metadata.labels).toEqual(
        expect.arrayContaining(["rest-api-e2e", "metadata-test"])
      );
    }, E2E_CONFIG.timeout);
  });
});
