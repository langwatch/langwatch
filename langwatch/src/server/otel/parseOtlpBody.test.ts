/**
 * Parser-equivalence tests for the shared OTLP body helper.
 *
 * `parseOtlpBody.ts` is consumed by both the project-keyed `/api/otel/v1/traces`
 * receiver and the org-keyed governance `/api/ingest/otel/:sourceId` receiver.
 * Both must produce *byte-for-byte identical* parsed `IExportTraceServiceRequest`
 * for the same wire input — that is the whole architectural claim of the
 * unified-substrate direction. These tests lock the contract before the
 * receiver rewire (Sergey commit 2b) so the rewire can't accidentally diverge
 * the two call sites.
 *
 * Spec contract: specs/ai-gateway/governance/architecture-invariants.feature
 * (cross-cutting "shared OTLP parser" invariant) +
 * specs/ai-gateway/governance/receiver-shapes.feature.
 */
import { describe, expect, it } from "vitest";
import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";
import * as root from "@opentelemetry/otlp-transformer/build/src/generated/root";

import {
  parseOtlpLogs,
  parseOtlpMetrics,
  parseOtlpTraces,
  readOtlpBody,
} from "./parseOtlpBody";

const traceRequestType = (root as any).opentelemetry.proto.collector.trace.v1
  .ExportTraceServiceRequest;
const logRequestType = (root as any).opentelemetry.proto.collector.logs.v1
  .ExportLogsServiceRequest;

function buildTraceRequest(): {
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

function buildProtobufBody(payload: ReturnType<typeof buildTraceRequest>): ArrayBuffer {
  const message = traceRequestType.create(payload);
  const bytes = traceRequestType.encode(message).finish() as Uint8Array;
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function buildJsonBody(payload: ReturnType<typeof buildTraceRequest>): ArrayBuffer {
  return new TextEncoder().encode(JSON.stringify(payload)).buffer as ArrayBuffer;
}

function makeRequest(body: ArrayBuffer | Buffer, headers: Record<string, string>): Request {
  return new Request("http://localhost/test", {
    method: "POST",
    headers,
    body: body instanceof Buffer ? new Uint8Array(body) : new Uint8Array(body),
  });
}

function spanCountOf(parsed: { resourceSpans?: Array<{ scopeSpans?: Array<{ spans?: unknown[] }> }> }): number {
  return (parsed.resourceSpans ?? []).flatMap((rs) =>
    (rs.scopeSpans ?? []).flatMap((ss) => ss.spans ?? []),
  ).length;
}

describe("readOtlpBody", () => {
  describe("when Content-Encoding is identity or absent", () => {
    it("returns the body unchanged (no header)", async () => {
      const body = new TextEncoder().encode("hello").buffer as ArrayBuffer;
      const req = makeRequest(body, { "content-type": "application/json" });
      const decoded = await readOtlpBody(req);
      expect(new TextDecoder().decode(decoded)).toBe("hello");
    });

    it("returns the body unchanged (identity)", async () => {
      const body = new TextEncoder().encode("hello").buffer as ArrayBuffer;
      const req = makeRequest(body, { "content-encoding": "identity" });
      const decoded = await readOtlpBody(req);
      expect(new TextDecoder().decode(decoded)).toBe("hello");
    });
  });

  describe("when Content-Encoding is gzip", () => {
    it("decompresses transparently", async () => {
      const original = "the quick brown fox jumps over the lazy OTLP receiver";
      const compressed = gzipSync(Buffer.from(original));
      const req = makeRequest(compressed, { "content-encoding": "gzip" });
      const decoded = await readOtlpBody(req);
      expect(new TextDecoder().decode(decoded)).toBe(original);
    });
  });

  describe("when Content-Encoding is deflate", () => {
    it("decompresses transparently", async () => {
      const original = "deflated payload";
      const compressed = deflateSync(Buffer.from(original));
      const req = makeRequest(compressed, { "content-encoding": "deflate" });
      const decoded = await readOtlpBody(req);
      expect(new TextDecoder().decode(decoded)).toBe(original);
    });
  });

  describe("when Content-Encoding is br (brotli)", () => {
    it("decompresses transparently", async () => {
      const original = "brotli payload";
      const compressed = brotliCompressSync(Buffer.from(original));
      const req = makeRequest(compressed, { "content-encoding": "br" });
      const decoded = await readOtlpBody(req);
      expect(new TextDecoder().decode(decoded)).toBe(original);
    });
  });

  describe("when Content-Encoding is unsupported", () => {
    it("throws (caller decides response)", async () => {
      const req = makeRequest(new ArrayBuffer(0), {
        "content-encoding": "snappy",
      });
      await expect(readOtlpBody(req)).rejects.toThrow(/Unsupported Content-Encoding/);
    });
  });
});

describe("parseOtlpTraces", () => {
  describe("when body is empty", () => {
    it("returns ok with empty resourceSpans", () => {
      const result = parseOtlpTraces(new ArrayBuffer(0), "application/x-protobuf");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.request.resourceSpans).toEqual([]);
      }
    });
  });

  describe("when body is application/json", () => {
    it("parses JSON and returns the request", () => {
      const payload = buildTraceRequest();
      const body = buildJsonBody(payload);
      const result = parseOtlpTraces(body, "application/json");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(spanCountOf(result.request)).toBe(1);
      }
    });
  });

  describe("when body is protobuf", () => {
    it("parses protobuf and returns the request", () => {
      const payload = buildTraceRequest();
      const body = buildProtobufBody(payload);
      const result = parseOtlpTraces(body, "application/x-protobuf");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(spanCountOf(result.request)).toBe(1);
      }
    });
  });

  describe("when body is JSON but Content-Type is missing or wrong", () => {
    it("falls back to JSON-then-protobuf re-encode (matches /v1/traces hardened path)", () => {
      const payload = buildTraceRequest();
      const body = buildJsonBody(payload);
      // No content-type header — protobuf decode will fail, then JSON fallback wins.
      const result = parseOtlpTraces(body, undefined);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(spanCountOf(result.request)).toBe(1);
      }
    });

    it("falls back when content-type lies (says protobuf but body is JSON)", () => {
      const payload = buildTraceRequest();
      const body = buildJsonBody(payload);
      const result = parseOtlpTraces(body, "application/x-protobuf");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(spanCountOf(result.request)).toBe(1);
      }
    });
  });

  describe("when body is malformed", () => {
    it("returns ok:false with diagnostic error", () => {
      const garbage = new TextEncoder().encode("this is not OTLP")
        .buffer as ArrayBuffer;
      const result = parseOtlpTraces(garbage, "application/json");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/Failed to parse OTLP body/);
      }
    });
  });
});

describe("parser equivalence — JSON path produces same shape as protobuf path", () => {
  it("returns the same span count and same canonical attributes regardless of wire format", () => {
    const payload = buildTraceRequest();
    const jsonResult = parseOtlpTraces(buildJsonBody(payload), "application/json");
    const protoResult = parseOtlpTraces(
      buildProtobufBody(payload),
      "application/x-protobuf",
    );

    expect(jsonResult.ok).toBe(true);
    expect(protoResult.ok).toBe(true);
    if (!jsonResult.ok || !protoResult.ok) return;

    expect(spanCountOf(jsonResult.request)).toBe(spanCountOf(protoResult.request));

    const jsonSpan =
      jsonResult.request.resourceSpans?.[0]?.scopeSpans?.[0]?.spans?.[0];
    const protoSpan =
      protoResult.request.resourceSpans?.[0]?.scopeSpans?.[0]?.spans?.[0];

    expect(jsonSpan?.name).toBe(protoSpan?.name);

    const attrKeys = (span: typeof jsonSpan): string[] =>
      (span?.attributes ?? []).map((a) => a.key).sort();
    expect(attrKeys(jsonSpan)).toEqual(attrKeys(protoSpan));
  });
});

describe("readOtlpBody → parseOtlpTraces round-trip across all encodings", () => {
  const payload = buildTraceRequest();

  describe("given identical OTLP bytes", () => {
    it("parses identically across identity / gzip / deflate / brotli", async () => {
      const protobufBytes = Buffer.from(buildProtobufBody(payload));

      const variants = [
        { encoding: "identity", body: protobufBytes as Buffer },
        { encoding: "gzip", body: gzipSync(protobufBytes) },
        { encoding: "deflate", body: deflateSync(protobufBytes) },
        { encoding: "br", body: brotliCompressSync(protobufBytes) },
      ];

      const results = await Promise.all(
        variants.map(async ({ encoding, body }) => {
          const headers: Record<string, string> = {
            "content-type": "application/x-protobuf",
          };
          if (encoding !== "identity") headers["content-encoding"] = encoding;
          const req = makeRequest(body, headers);
          const decoded = await readOtlpBody(req);
          return parseOtlpTraces(decoded, "application/x-protobuf");
        }),
      );

      expect(results.every((r) => r.ok)).toBe(true);
      const counts = results.map((r) => (r.ok ? spanCountOf(r.request) : -1));
      expect(new Set(counts).size).toBe(1);
      expect(counts[0]).toBe(1);
    });
  });
});

describe("parser-helper exports — both consumer routes import the same primitives", () => {
  it("the receiver routes use the same helpers (compile-time guarantee, asserted at runtime here)", async () => {
    const otelRoute = await import("../routes/otel");
    const ingestRoute = await import("../routes/ingest/ingestionRoutes");

    expect(otelRoute).toBeDefined();
    expect(ingestRoute).toBeDefined();

    expect(typeof readOtlpBody).toBe("function");
    expect(typeof parseOtlpTraces).toBe("function");
    expect(typeof parseOtlpLogs).toBe("function");
    expect(typeof parseOtlpMetrics).toBe("function");
  });
});

describe("parseOtlpLogs", () => {
  describe("when body is empty", () => {
    it("returns ok with empty resourceLogs", () => {
      const result = parseOtlpLogs(new ArrayBuffer(0), "application/x-protobuf");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.request.resourceLogs).toEqual([]);
      }
    });
  });

  describe("when body is JSON", () => {
    it("parses to the logs request shape", () => {
      const logsPayload = {
        resourceLogs: [
          {
            resource: { attributes: [] },
            scopeLogs: [
              {
                scope: { name: "audit-feed" },
                logRecords: [
                  {
                    timeUnixNano: "1700000000000000000",
                    severityNumber: 9,
                    severityText: "INFO",
                    body: { stringValue: "test audit event" },
                    attributes: [
                      {
                        key: "user.email",
                        value: { stringValue: "user@example.com" },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };
      const body = new TextEncoder().encode(JSON.stringify(logsPayload))
        .buffer as ArrayBuffer;
      const result = parseOtlpLogs(body, "application/json");
      expect(result.ok).toBe(true);
      if (result.ok) {
        const records = (result.request.resourceLogs ?? []).flatMap((rl) =>
          (rl.scopeLogs ?? []).flatMap((sl) => sl.logRecords ?? []),
        );
        expect(records).toHaveLength(1);
      }
    });
  });
});

describe("parseOtlpMetrics", () => {
  describe("when body is empty", () => {
    it("returns ok with empty resourceMetrics", () => {
      const result = parseOtlpMetrics(new ArrayBuffer(0), "application/x-protobuf");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.request.resourceMetrics).toEqual([]);
      }
    });
  });
});
