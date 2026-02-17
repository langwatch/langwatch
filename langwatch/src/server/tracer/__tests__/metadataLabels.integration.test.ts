/**
 * Integration tests for metadata and labels flow through OTEL and REST API paths.
 *
 * These tests verify that metadata attributes are correctly hoisted to trace-level
 * reserved metadata fields.
 *
 * @see https://github.com/langwatch/langwatch/issues/1580
 */

import type {
  ESpanKind,
  EStatusCode,
  IExportTraceServiceRequest,
} from "@opentelemetry/otlp-transformer";
import { describe, expect, it } from "vitest";
import type { DeepPartial } from "../../../utils/types";
import {
  openTelemetryTraceRequestToTracesForCollection,
  type TraceForCollection,
} from "../otel.traces";

/**
 * Helper to create a minimal OTEL trace request with the given span attributes.
 */
function createOtelTraceWithAttributes(
  attributes: Array<{
    key: string;
    value: {
      stringValue?: string;
      intValue?: number;
      boolValue?: boolean;
      arrayValue?: { values: Array<{ stringValue?: string }> };
    };
  }>,
  traceId = "dGVzdC10cmFjZS1pZDEyMzQ=", // base64 encoded 'test-trace-id1234'
): DeepPartial<IExportTraceServiceRequest> {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: "test-service" } },
          ],
        },
        scopeSpans: [
          {
            scope: {
              name: "test.instrumentation",
              version: "1.0.0",
            },
            spans: [
              {
                traceId,
                spanId: "c3Bhbi1pZC0xMjM0NTY=", // base64 encoded
                name: "test-span",
                kind: "SPAN_KIND_INTERNAL" as unknown as ESpanKind,
                startTimeUnixNano: "1700000000000000000",
                endTimeUnixNano: "1700000001000000000",
                attributes,
                status: {
                  code: "STATUS_CODE_OK" as unknown as EStatusCode,
                },
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("Metadata and Labels Flow - OTEL Path", () => {
  describe("Thread ID hoisting", () => {
    it("hoists gen_ai.conversation.id to thread_id (OTEL semconv)", async () => {
      const request = createOtelTraceWithAttributes([
        { key: "gen_ai.conversation.id", value: { stringValue: "conv-123" } },
      ]);

      const traces =
        await openTelemetryTraceRequestToTracesForCollection(request);
      expect(traces).toHaveLength(1);

      const trace = traces[0]!;
      expect(trace.reservedTraceMetadata.thread_id).toBe("conv-123");
    });

    it("hoists session.id to thread_id (OpenInference)", async () => {
      const request = createOtelTraceWithAttributes([
        { key: "session.id", value: { stringValue: "session-456" } },
      ]);

      const traces =
        await openTelemetryTraceRequestToTracesForCollection(request);
      expect(traces).toHaveLength(1);

      const trace = traces[0]!;
      expect(trace.reservedTraceMetadata.thread_id).toBe("session-456");
    });

    it("hoists langwatch.thread.id to thread_id (legacy)", async () => {
      const request = createOtelTraceWithAttributes([
        { key: "langwatch.thread.id", value: { stringValue: "lw-thread-789" } },
      ]);

      const traces =
        await openTelemetryTraceRequestToTracesForCollection(request);
      expect(traces).toHaveLength(1);

      const trace = traces[0]!;
      expect(trace.reservedTraceMetadata.thread_id).toBe("lw-thread-789");
    });

    it("prefers gen_ai.conversation.id over session.id when both present", async () => {
      const request = createOtelTraceWithAttributes([
        { key: "session.id", value: { stringValue: "session-from-session" } },
        {
          key: "gen_ai.conversation.id",
          value: { stringValue: "conv-from-genai" },
        },
      ]);

      const traces =
        await openTelemetryTraceRequestToTracesForCollection(request);
      expect(traces).toHaveLength(1);

      const trace = traces[0]!;
      // gen_ai.conversation.id is processed after session.id, so it should win
      expect(trace.reservedTraceMetadata.thread_id).toBe("conv-from-genai");
    });
  });

  describe("User ID hoisting", () => {
    it("hoists user.id to user_id (OpenInference)", async () => {
      const request = createOtelTraceWithAttributes([
        { key: "user.id", value: { stringValue: "user-123" } },
      ]);

      const traces =
        await openTelemetryTraceRequestToTracesForCollection(request);
      expect(traces).toHaveLength(1);

      const trace = traces[0]!;
      expect(trace.reservedTraceMetadata.user_id).toBe("user-123");
    });

    it("hoists langwatch.user.id to user_id (legacy)", async () => {
      const request = createOtelTraceWithAttributes([
        { key: "langwatch.user.id", value: { stringValue: "lw-user-456" } },
      ]);

      const traces =
        await openTelemetryTraceRequestToTracesForCollection(request);
      expect(traces).toHaveLength(1);

      const trace = traces[0]!;
      expect(trace.reservedTraceMetadata.user_id).toBe("lw-user-456");
    });
  });

  describe("Customer ID hoisting", () => {
    it("hoists langwatch.customer.id to customer_id", async () => {
      const request = createOtelTraceWithAttributes([
        { key: "langwatch.customer.id", value: { stringValue: "cust-789" } },
      ]);

      const traces =
        await openTelemetryTraceRequestToTracesForCollection(request);
      expect(traces).toHaveLength(1);

      const trace = traces[0]!;
      expect(trace.reservedTraceMetadata.customer_id).toBe("cust-789");
    });
  });

  describe("Labels hoisting", () => {
    it("hoists tag.tags array to labels", async () => {
      const request = createOtelTraceWithAttributes([
        {
          key: "tag.tags",
          value: {
            arrayValue: {
              values: [
                { stringValue: "label-1" },
                { stringValue: "label-2" },
                { stringValue: "production" },
              ],
            },
          },
        },
      ]);

      const traces =
        await openTelemetryTraceRequestToTracesForCollection(request);
      expect(traces).toHaveLength(1);

      const trace = traces[0]!;
      expect(trace.reservedTraceMetadata.labels).toEqual([
        "label-1",
        "label-2",
        "production",
      ]);
    });

    it("hoists langwatch.labels JSON array string to labels", async () => {
      const request = createOtelTraceWithAttributes([
        {
          key: "langwatch.labels",
          value: { stringValue: '["env:prod", "version:1.0"]' },
        },
      ]);

      const traces =
        await openTelemetryTraceRequestToTracesForCollection(request);
      expect(traces).toHaveLength(1);

      const trace = traces[0]!;
      // langwatch.labels goes through metadata extraction
      expect(trace.reservedTraceMetadata.labels).toEqual([
        "env:prod",
        "version:1.0",
      ]);
    });
  });

  describe("Metadata attribute processing", () => {
    it("extracts metadata JSON object to custom metadata", async () => {
      const request = createOtelTraceWithAttributes([
        {
          key: "metadata",
          value: {
            stringValue: '{"custom_key": "custom_value", "count": 42}',
          },
        },
      ]);

      const traces =
        await openTelemetryTraceRequestToTracesForCollection(request);
      expect(traces).toHaveLength(1);

      const trace = traces[0]!;
      expect(trace.customMetadata.custom_key).toBe("custom_value");
      expect(trace.customMetadata.count).toBe(42);
    });

    it("hoists reserved fields from metadata to reservedTraceMetadata", async () => {
      const request = createOtelTraceWithAttributes([
        {
          key: "metadata",
          value: {
            stringValue: JSON.stringify({
              thread_id: "meta-thread-123",
              user_id: "meta-user-456",
              customer_id: "meta-cust-789",
              labels: ["from-metadata"],
              custom_field: "stays-in-custom",
            }),
          },
        },
      ]);

      const traces =
        await openTelemetryTraceRequestToTracesForCollection(request);
      expect(traces).toHaveLength(1);

      const trace = traces[0]!;
      expect(trace.reservedTraceMetadata.thread_id).toBe("meta-thread-123");
      expect(trace.reservedTraceMetadata.user_id).toBe("meta-user-456");
      expect(trace.reservedTraceMetadata.customer_id).toBe("meta-cust-789");
      expect(trace.reservedTraceMetadata.labels).toEqual(["from-metadata"]);
      expect(trace.customMetadata.custom_field).toBe("stays-in-custom");
    });

    it("converts camelCase metadata keys to snake_case", async () => {
      const request = createOtelTraceWithAttributes([
        {
          key: "metadata",
          value: {
            stringValue: JSON.stringify({
              threadId: "camel-thread",
              userId: "camel-user",
              customerId: "camel-customer",
            }),
          },
        },
      ]);

      const traces =
        await openTelemetryTraceRequestToTracesForCollection(request);
      expect(traces).toHaveLength(1);

      const trace = traces[0]!;
      // These should be converted from camelCase
      expect(trace.reservedTraceMetadata.thread_id).toBe("camel-thread");
      expect(trace.reservedTraceMetadata.user_id).toBe("camel-user");
      expect(trace.reservedTraceMetadata.customer_id).toBe("camel-customer");
    });
  });

  describe("Combined metadata from multiple sources", () => {
    it("combines metadata from span attributes and metadata object", async () => {
      const request = createOtelTraceWithAttributes([
        { key: "user.id", value: { stringValue: "span-user" } },
        {
          key: "gen_ai.conversation.id",
          value: { stringValue: "span-thread" },
        },
        {
          key: "tag.tags",
          value: {
            arrayValue: {
              values: [{ stringValue: "span-label" }],
            },
          },
        },
        {
          key: "metadata",
          value: {
            stringValue: JSON.stringify({
              custom_key: "custom_value",
            }),
          },
        },
      ]);

      const traces =
        await openTelemetryTraceRequestToTracesForCollection(request);
      expect(traces).toHaveLength(1);

      const trace = traces[0]!;
      expect(trace.reservedTraceMetadata.user_id).toBe("span-user");
      expect(trace.reservedTraceMetadata.thread_id).toBe("span-thread");
      expect(trace.reservedTraceMetadata.labels).toEqual(["span-label"]);
      expect(trace.customMetadata.custom_key).toBe("custom_value");
    });

    it("handles complete OTEL semconv + legacy attributes together", async () => {
      // This represents a real-world scenario where an SDK might send various attributes
      const request = createOtelTraceWithAttributes([
        // OTEL GenAI semconv
        {
          key: "gen_ai.conversation.id",
          value: { stringValue: "conversation-001" },
        },
        // OpenInference
        { key: "user.id", value: { stringValue: "user-001" } },
        { key: "session.id", value: { stringValue: "session-001" } },
        // LangWatch-specific
        { key: "langwatch.customer.id", value: { stringValue: "customer-001" } },
        {
          key: "langwatch.labels",
          value: { stringValue: '["important", "v2"]' },
        },
        // Custom metadata
        {
          key: "metadata",
          value: {
            stringValue: JSON.stringify({
              environment: "production",
              version: "2.0.0",
            }),
          },
        },
      ]);

      const traces =
        await openTelemetryTraceRequestToTracesForCollection(request);
      expect(traces).toHaveLength(1);

      const trace = traces[0]!;
      // gen_ai.conversation.id wins over session.id
      expect(trace.reservedTraceMetadata.thread_id).toBe("conversation-001");
      expect(trace.reservedTraceMetadata.user_id).toBe("user-001");
      expect(trace.reservedTraceMetadata.customer_id).toBe("customer-001");
      expect(trace.reservedTraceMetadata.labels).toEqual(["important", "v2"]);
      expect(trace.customMetadata.environment).toBe("production");
      expect(trace.customMetadata.version).toBe("2.0.0");
    });
  });

  describe("Edge cases", () => {
    it("handles empty metadata object", async () => {
      const request = createOtelTraceWithAttributes([
        {
          key: "metadata",
          value: { stringValue: "{}" },
        },
      ]);

      const traces =
        await openTelemetryTraceRequestToTracesForCollection(request);
      expect(traces).toHaveLength(1);

      const trace = traces[0]!;
      expect(trace.reservedTraceMetadata).toEqual({});
      // customMetadata will still have service.name from resource attributes
      expect(trace.customMetadata["service.name"]).toBe("test-service");
    });

    it("ignores null and undefined metadata values", async () => {
      const request = createOtelTraceWithAttributes([
        {
          key: "metadata",
          value: {
            stringValue: JSON.stringify({
              thread_id: null,
              user_id: undefined,
              valid_field: "valid",
            }),
          },
        },
      ]);

      const traces =
        await openTelemetryTraceRequestToTracesForCollection(request);
      expect(traces).toHaveLength(1);

      const trace = traces[0]!;
      // null/undefined should not appear in reservedTraceMetadata
      expect(trace.reservedTraceMetadata.thread_id).toBeUndefined();
      expect(trace.reservedTraceMetadata.user_id).toBeUndefined();
      expect(trace.customMetadata.valid_field).toBe("valid");
    });

    it("preserves numeric string values for IDs", async () => {
      const request = createOtelTraceWithAttributes([
        { key: "user.id", value: { stringValue: "12345" } },
        { key: "gen_ai.conversation.id", value: { stringValue: "67890" } },
        { key: "langwatch.customer.id", value: { stringValue: "11111" } },
      ]);

      const traces =
        await openTelemetryTraceRequestToTracesForCollection(request);
      expect(traces).toHaveLength(1);

      const trace = traces[0]!;
      expect(trace.reservedTraceMetadata.user_id).toBe("12345");
      expect(trace.reservedTraceMetadata.thread_id).toBe("67890");
      expect(trace.reservedTraceMetadata.customer_id).toBe("11111");
    });
  });
});

describe("Metadata and Labels Flow - SDK Telemetry attributes", () => {
  it("extracts SDK telemetry attributes from resource", async () => {
    const request: DeepPartial<IExportTraceServiceRequest> = {
      resourceSpans: [
        {
          resource: {
            attributes: [
              {
                key: "telemetry.sdk.language",
                value: { stringValue: "python" },
              },
              {
                key: "telemetry.sdk.name",
                value: { stringValue: "opentelemetry" },
              },
              {
                key: "telemetry.sdk.version",
                value: { stringValue: "1.25.0" },
              },
              {
                key: "service.name",
                value: { stringValue: "my-service" },
              },
            ],
          },
          scopeSpans: [
            {
              scope: { name: "test", version: "1.0.0" },
              spans: [
                {
                  traceId: "dGVzdC10cmFjZS1pZDEyMzQ=",
                  spanId: "c3Bhbi1pZC0xMjM0NTY=",
                  name: "test-span",
                  kind: "SPAN_KIND_INTERNAL" as unknown as ESpanKind,
                  startTimeUnixNano: "1700000000000000000",
                  endTimeUnixNano: "1700000001000000000",
                  attributes: [],
                  status: { code: "STATUS_CODE_OK" as unknown as EStatusCode },
                },
              ],
            },
          ],
        },
      ],
    };

    const traces = await openTelemetryTraceRequestToTracesForCollection(request);
    expect(traces).toHaveLength(1);

    const trace = traces[0]!;
    // These go into customMetadata since they're resource-level attributes
    expect(trace.customMetadata["telemetry.sdk.language"]).toBe("python");
    expect(trace.customMetadata["telemetry.sdk.name"]).toBe("opentelemetry");
    expect(trace.customMetadata["telemetry.sdk.version"]).toBe("1.25.0");
    expect(trace.customMetadata["service.name"]).toBe("my-service");
  });
});

describe("Metadata Mapping - openTelemetryToLangWatchMetadataMapping", () => {
  it("maps thread.id to thread_id via metadata", async () => {
    const request = createOtelTraceWithAttributes([
      {
        key: "metadata",
        value: { stringValue: JSON.stringify({ "thread.id": "mapped-thread" }) },
      },
    ]);

    const traces = await openTelemetryTraceRequestToTracesForCollection(request);
    expect(traces).toHaveLength(1);

    const trace = traces[0]!;
    expect(trace.reservedTraceMetadata.thread_id).toBe("mapped-thread");
  });

  it("maps gen_ai.conversation.id to thread_id via metadata", async () => {
    const request = createOtelTraceWithAttributes([
      {
        key: "metadata",
        value: {
          stringValue: JSON.stringify({ "gen_ai.conversation.id": "genai-conv" }),
        },
      },
    ]);

    const traces = await openTelemetryTraceRequestToTracesForCollection(request);
    expect(traces).toHaveLength(1);

    const trace = traces[0]!;
    expect(trace.reservedTraceMetadata.thread_id).toBe("genai-conv");
  });

  it("maps user.id to user_id via metadata", async () => {
    const request = createOtelTraceWithAttributes([
      {
        key: "metadata",
        value: { stringValue: JSON.stringify({ "user.id": "mapped-user" }) },
      },
    ]);

    const traces = await openTelemetryTraceRequestToTracesForCollection(request);
    expect(traces).toHaveLength(1);

    const trace = traces[0]!;
    expect(trace.reservedTraceMetadata.user_id).toBe("mapped-user");
  });

  it("maps customer.id to customer_id via metadata", async () => {
    const request = createOtelTraceWithAttributes([
      {
        key: "metadata",
        value: {
          stringValue: JSON.stringify({ "customer.id": "mapped-customer" }),
        },
      },
    ]);

    const traces = await openTelemetryTraceRequestToTracesForCollection(request);
    expect(traces).toHaveLength(1);

    const trace = traces[0]!;
    expect(trace.reservedTraceMetadata.customer_id).toBe("mapped-customer");
  });

  it("maps tag.tags to labels via metadata", async () => {
    const request = createOtelTraceWithAttributes([
      {
        key: "metadata",
        value: {
          stringValue: JSON.stringify({ "tag.tags": ["tag1", "tag2"] }),
        },
      },
    ]);

    const traces = await openTelemetryTraceRequestToTracesForCollection(request);
    expect(traces).toHaveLength(1);

    const trace = traces[0]!;
    expect(trace.reservedTraceMetadata.labels).toEqual(["tag1", "tag2"]);
  });

  it("maps langwatch.* attributes via metadata", async () => {
    const request = createOtelTraceWithAttributes([
      {
        key: "metadata",
        value: {
          stringValue: JSON.stringify({
            "langwatch.thread.id": "lw-meta-thread",
            "langwatch.user.id": "lw-meta-user",
            "langwatch.customer.id": "lw-meta-customer",
          }),
        },
      },
    ]);

    const traces = await openTelemetryTraceRequestToTracesForCollection(request);
    expect(traces).toHaveLength(1);

    const trace = traces[0]!;
    expect(trace.reservedTraceMetadata.thread_id).toBe("lw-meta-thread");
    expect(trace.reservedTraceMetadata.user_id).toBe("lw-meta-user");
    expect(trace.reservedTraceMetadata.customer_id).toBe("lw-meta-customer");
  });

  it("maps langwatch SDK attributes via metadata", async () => {
    const request = createOtelTraceWithAttributes([
      {
        key: "metadata",
        value: {
          stringValue: JSON.stringify({
            "langwatch.sdk.language": "typescript",
            "langwatch.sdk.name": "langwatch-sdk",
            "langwatch.sdk.version": "0.1.0",
          }),
        },
      },
    ]);

    const traces = await openTelemetryTraceRequestToTracesForCollection(request);
    expect(traces).toHaveLength(1);

    const trace = traces[0]!;
    expect(trace.reservedTraceMetadata.sdk_language).toBe("typescript");
    expect(trace.reservedTraceMetadata.sdk_name).toBe("langwatch-sdk");
    expect(trace.reservedTraceMetadata.sdk_version).toBe("0.1.0");
  });
});

describe("Vercel AI SDK telemetry metadata", () => {
  it("extracts metadata from ai.telemetry.metadata", async () => {
    const request = createOtelTraceWithAttributes([
      {
        key: "ai.telemetry.metadata",
        value: {
          stringValue: JSON.stringify({
            user_id: "vercel-user",
            thread_id: "vercel-thread",
            custom_field: "vercel-custom",
          }),
        },
      },
    ]);

    const traces = await openTelemetryTraceRequestToTracesForCollection(request);
    expect(traces).toHaveLength(1);

    const trace = traces[0]!;
    expect(trace.reservedTraceMetadata.user_id).toBe("vercel-user");
    expect(trace.reservedTraceMetadata.thread_id).toBe("vercel-thread");
    expect(trace.customMetadata.custom_field).toBe("vercel-custom");
  });
});

describe("Integration - Real-world SDK scenarios", () => {
  it("handles OpenInference (Phoenix) instrumentation attributes", async () => {
    const request: DeepPartial<IExportTraceServiceRequest> = {
      resourceSpans: [
        {
          resource: {
            attributes: [
              {
                key: "telemetry.sdk.language",
                value: { stringValue: "python" },
              },
              {
                key: "service.name",
                value: { stringValue: "phoenix-app" },
              },
            ],
          },
          scopeSpans: [
            {
              scope: {
                name: "openinference.instrumentation.openai",
                version: "0.1.12",
              },
              spans: [
                {
                  traceId: "dGVzdC10cmFjZS1pZDEyMzQ=",
                  spanId: "c3Bhbi1pZC0xMjM0NTY=",
                  name: "ChatCompletion",
                  kind: "SPAN_KIND_INTERNAL" as unknown as ESpanKind,
                  startTimeUnixNano: "1700000000000000000",
                  endTimeUnixNano: "1700000001000000000",
                  attributes: [
                    {
                      key: "openinference.span.kind",
                      value: { stringValue: "LLM" },
                    },
                    {
                      key: "session.id",
                      value: { stringValue: "phoenix-session-123" },
                    },
                    { key: "user.id", value: { stringValue: "phoenix-user-456" } },
                    {
                      key: "metadata",
                      value: { stringValue: '{"experiment": "test-run-1"}' },
                    },
                    {
                      key: "tag.tags",
                      value: {
                        arrayValue: {
                          values: [
                            { stringValue: "openinference" },
                            { stringValue: "openai" },
                          ],
                        },
                      },
                    },
                  ],
                  status: { code: "STATUS_CODE_OK" as unknown as EStatusCode },
                },
              ],
            },
          ],
        },
      ],
    };

    const traces = await openTelemetryTraceRequestToTracesForCollection(request);
    expect(traces).toHaveLength(1);

    const trace = traces[0]!;
    expect(trace.reservedTraceMetadata.thread_id).toBe("phoenix-session-123");
    expect(trace.reservedTraceMetadata.user_id).toBe("phoenix-user-456");
    expect(trace.reservedTraceMetadata.labels).toEqual([
      "openinference",
      "openai",
    ]);
    expect(trace.customMetadata.experiment).toBe("test-run-1");
  });

  it("handles Traceloop (OpenLLMetry) instrumentation attributes", async () => {
    const request: DeepPartial<IExportTraceServiceRequest> = {
      resourceSpans: [
        {
          resource: {
            attributes: [
              {
                key: "telemetry.sdk.language",
                value: { stringValue: "python" },
              },
              {
                key: "service.name",
                value: { stringValue: "traceloop-app" },
              },
            ],
          },
          scopeSpans: [
            {
              scope: {
                name: "opentelemetry.instrumentation.openai.v1",
                version: "0.26.4",
              },
              spans: [
                {
                  traceId: "dGVzdC10cmFjZS1pZDEyMzQ=",
                  spanId: "c3Bhbi1pZC0xMjM0NTY=",
                  name: "openai.chat",
                  kind: "SPAN_KIND_CLIENT" as unknown as ESpanKind,
                  startTimeUnixNano: "1700000000000000000",
                  endTimeUnixNano: "1700000001000000000",
                  attributes: [
                    { key: "llm.request.type", value: { stringValue: "chat" } },
                    { key: "gen_ai.system", value: { stringValue: "OpenAI" } },
                    {
                      key: "gen_ai.conversation.id",
                      value: { stringValue: "traceloop-conv-789" },
                    },
                    {
                      key: "user.id",
                      value: { stringValue: "traceloop-user-012" },
                    },
                  ],
                  status: { code: "STATUS_CODE_OK" as unknown as EStatusCode },
                },
              ],
            },
          ],
        },
      ],
    };

    const traces = await openTelemetryTraceRequestToTracesForCollection(request);
    expect(traces).toHaveLength(1);

    const trace = traces[0]!;
    expect(trace.reservedTraceMetadata.thread_id).toBe("traceloop-conv-789");
    expect(trace.reservedTraceMetadata.user_id).toBe("traceloop-user-012");
  });

  it("handles LangWatch Python SDK attributes", async () => {
    const request: DeepPartial<IExportTraceServiceRequest> = {
      resourceSpans: [
        {
          resource: {
            attributes: [
              {
                key: "telemetry.sdk.language",
                value: { stringValue: "python" },
              },
              {
                key: "service.name",
                value: { stringValue: "langwatch-app" },
              },
            ],
          },
          scopeSpans: [
            {
              scope: {
                name: "langwatch.tracer",
                version: "0.2.0",
              },
              spans: [
                {
                  traceId: "dGVzdC10cmFjZS1pZDEyMzQ=",
                  spanId: "c3Bhbi1pZC0xMjM0NTY=",
                  name: "my-llm-call",
                  kind: "SPAN_KIND_INTERNAL" as unknown as ESpanKind,
                  startTimeUnixNano: "1700000000000000000",
                  endTimeUnixNano: "1700000001000000000",
                  attributes: [
                    {
                      key: "langwatch.thread.id",
                      value: { stringValue: "lw-thread-abc" },
                    },
                    {
                      key: "langwatch.user.id",
                      value: { stringValue: "lw-user-def" },
                    },
                    {
                      key: "langwatch.customer.id",
                      value: { stringValue: "lw-customer-ghi" },
                    },
                    {
                      key: "langwatch.labels",
                      value: { stringValue: '["production", "v2.0"]' },
                    },
                    { key: "langwatch.span.type", value: { stringValue: "llm" } },
                  ],
                  status: { code: "STATUS_CODE_OK" as unknown as EStatusCode },
                },
              ],
            },
          ],
        },
      ],
    };

    const traces = await openTelemetryTraceRequestToTracesForCollection(request);
    expect(traces).toHaveLength(1);

    const trace = traces[0]!;
    expect(trace.reservedTraceMetadata.thread_id).toBe("lw-thread-abc");
    expect(trace.reservedTraceMetadata.user_id).toBe("lw-user-def");
    expect(trace.reservedTraceMetadata.customer_id).toBe("lw-customer-ghi");
    expect(trace.reservedTraceMetadata.labels).toEqual(["production", "v2.0"]);
    expect(trace.spans[0]?.type).toBe("llm");
  });
});
