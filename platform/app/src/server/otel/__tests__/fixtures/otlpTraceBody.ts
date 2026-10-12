/** Shared OTLP trace request fixtures for the parseOtlpBody tests. */
import * as root from "@opentelemetry/otlp-transformer/build/src/generated/root";

const traceRequestType = (root as any).opentelemetry.proto.collector.trace.v1
  .ExportTraceServiceRequest;

/** Returns a minimal OTLP trace export request with one span named "test-span". */
export function buildTraceRequest(): {
  resourceSpans: Array<Record<string, unknown>>;
} {
  const startNano = "1700000000000000000";
  const endNano = "1700000000100000000";
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            {
              key: "service.name",
              value: { stringValue: "shared-parser-test" },
            },
          ],
        },
        scopeSpans: [
          {
            scope: { name: "test-scope", version: "1.0.0" },
            spans: [
              {
                traceId: "0123456789abcdef0123456789abcdef",
                spanId: "0123456789abcdef",
                parentSpanId: "",
                name: "test-span",
                kind: 1,
                startTimeUnixNano: startNano,
                endTimeUnixNano: endNano,
                attributes: [
                  {
                    key: "gen_ai.usage.cost_usd",
                    value: { doubleValue: 0.0123 },
                  },
                  {
                    key: "gen_ai.usage.input_tokens",
                    value: { intValue: 150 },
                  },
                  {
                    key: "gen_ai.request.model",
                    value: { stringValue: "claude-3-5-sonnet" },
                  },
                ],
                events: [],
                links: [],
                status: { code: 1 },
                droppedAttributesCount: 0,
                droppedEventsCount: 0,
                droppedLinksCount: 0,
              },
            ],
          },
        ],
      },
    ],
  };
}

/** Encodes an OTLP trace request as a protobuf ExportTraceServiceRequest body. */
export function buildProtobufBody(
  payload: ReturnType<typeof buildTraceRequest>,
): ArrayBuffer {
  const message = traceRequestType.create(payload);
  const bytes = traceRequestType.encode(message).finish() as Uint8Array;
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

/** Builds a POST Request carrying the OTLP body and optional Content-Encoding header. */
export function makeRequest(
  body: ArrayBuffer | Buffer,
  headers: Record<string, string>,
): Request {
  return new Request("http://localhost/test", {
    method: "POST",
    headers,
    body: new Uint8Array(body),
  });
}
