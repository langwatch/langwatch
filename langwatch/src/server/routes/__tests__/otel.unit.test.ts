import { describe, expect, it } from "vitest";
import * as root from "@opentelemetry/otlp-transformer/build/src/generated/root";
import { classifyTokenType, peekCustomerTraceIds } from "../otel";

const traceRequestType = (root as any).opentelemetry.proto.collector.trace.v1
  .ExportTraceServiceRequest;

// Two distinct 16-byte trace ids (hex) — used across the suite so we can
// assert the function emits hex regardless of whether the input was bytes
// or base64.
const TRACE_ID_HEX_1 = "0bcb2eb84dd52ac9bc1496a99c733880";
const TRACE_ID_HEX_2 = "1122334455667788aabbccddeeff0011";
const TRACE_ID_BYTES_1 = Buffer.from(TRACE_ID_HEX_1, "hex");
const TRACE_ID_BYTES_2 = Buffer.from(TRACE_ID_HEX_2, "hex");
const TRACE_ID_B64_1 = TRACE_ID_BYTES_1.toString("base64");
const TRACE_ID_B64_2 = TRACE_ID_BYTES_2.toString("base64");

const SPAN_ID_HEX = "1122334455667788";
const SPAN_ID_BYTES = Buffer.from(SPAN_ID_HEX, "hex");

function bufferToArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(
    buf.byteOffset,
    buf.byteOffset + buf.byteLength,
  ) as ArrayBuffer;
}

function jsonOtlpBody(traceIdsB64: string[]): ArrayBuffer {
  // Mirrors the wire shape an SDK produces when content-type is
  // application/json: traceId/spanId are base64-encoded strings.
  return bufferToArrayBuffer(
    Buffer.from(
      JSON.stringify({
        resourceSpans: [
          {
            scopeSpans: [
              {
                spans: traceIdsB64.map((tid) => ({
                  traceId: tid,
                  spanId: SPAN_ID_BYTES.toString("base64"),
                  name: "test-span",
                })),
              },
            ],
          },
        ],
      }),
      "utf-8",
    ),
  );
}

function protobufOtlpBody(traceIds: Buffer[]): ArrayBuffer {
  // Use the protobuf encoder so we exercise the same decode path the
  // production handler uses for application/x-protobuf bodies.
  const encoded = traceRequestType
    .encode({
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: traceIds.map((tid) => ({
                traceId: tid,
                spanId: SPAN_ID_BYTES,
                name: "test-span",
              })),
            },
          ],
        },
      ],
    })
    .finish() as Uint8Array;
  return bufferToArrayBuffer(Buffer.from(encoded));
}

describe("peekCustomerTraceIds", () => {
  describe("when the body is missing or empty", () => {
    it("returns an empty array for a zero-byte ArrayBuffer", () => {
      const empty = new ArrayBuffer(0);
      expect(peekCustomerTraceIds(empty, "application/x-protobuf")).toEqual([]);
    });

    it("returns an empty array when content-type is JSON and body is empty", () => {
      const empty = new ArrayBuffer(0);
      expect(peekCustomerTraceIds(empty, "application/json")).toEqual([]);
    });
  });

  describe("when the body is malformed", () => {
    it("returns an empty array for non-protobuf garbage", () => {
      const garbage = bufferToArrayBuffer(Buffer.from([0xff, 0x00, 0xde, 0xad]));
      expect(
        peekCustomerTraceIds(garbage, "application/x-protobuf"),
      ).toEqual([]);
    });

    it("returns an empty array for invalid JSON", () => {
      const bad = bufferToArrayBuffer(Buffer.from("not-json", "utf-8"));
      expect(peekCustomerTraceIds(bad, "application/json")).toEqual([]);
    });
  });

  describe("when the body is well-formed JSON OTLP", () => {
    it("decodes base64 trace_ids to lowercase hex", () => {
      const body = jsonOtlpBody([TRACE_ID_B64_1]);
      expect(peekCustomerTraceIds(body, "application/json")).toEqual([
        TRACE_ID_HEX_1,
      ]);
    });

    it.each([
      "application/json; charset=utf-8",
      "application/json;charset=utf-8",
      "  Application/JSON  ",
      "APPLICATION/JSON",
    ])(
      "still routes through the JSON parser when content-type is %j",
      (contentType) => {
        const body = jsonOtlpBody([TRACE_ID_B64_1]);
        expect(peekCustomerTraceIds(body, contentType)).toEqual([
          TRACE_ID_HEX_1,
        ]);
      },
    );

    it("preserves order across distinct trace_ids", () => {
      const body = jsonOtlpBody([TRACE_ID_B64_1, TRACE_ID_B64_2]);
      expect(peekCustomerTraceIds(body, "application/json")).toEqual([
        TRACE_ID_HEX_1,
        TRACE_ID_HEX_2,
      ]);
    });

    it("deduplicates trace_ids that appear on multiple spans", () => {
      const body = jsonOtlpBody([
        TRACE_ID_B64_1,
        TRACE_ID_B64_1,
        TRACE_ID_B64_2,
      ]);
      expect(peekCustomerTraceIds(body, "application/json")).toEqual([
        TRACE_ID_HEX_1,
        TRACE_ID_HEX_2,
      ]);
    });
  });

  describe("when the body is well-formed protobuf OTLP", () => {
    it("decodes Uint8Array trace_ids to lowercase hex", () => {
      const body = protobufOtlpBody([TRACE_ID_BYTES_1]);
      expect(
        peekCustomerTraceIds(body, "application/x-protobuf"),
      ).toEqual([TRACE_ID_HEX_1]);
    });

    it("decodes when no content-type is supplied (defaults to protobuf path)", () => {
      const body = protobufOtlpBody([TRACE_ID_BYTES_1]);
      expect(peekCustomerTraceIds(body, undefined)).toEqual([TRACE_ID_HEX_1]);
    });

    it("returns multiple unique trace_ids in the order they appear", () => {
      const body = protobufOtlpBody([TRACE_ID_BYTES_1, TRACE_ID_BYTES_2]);
      expect(
        peekCustomerTraceIds(body, "application/x-protobuf"),
      ).toEqual([TRACE_ID_HEX_1, TRACE_ID_HEX_2]);
    });
  });

  describe("when the body has nothing useful to extract", () => {
    it("returns an empty array for OTLP with no resourceSpans", () => {
      const body = bufferToArrayBuffer(
        Buffer.from(JSON.stringify({}), "utf-8"),
      );
      expect(peekCustomerTraceIds(body, "application/json")).toEqual([]);
    });

    it("returns an empty array for spans missing traceId", () => {
      const body = bufferToArrayBuffer(
        Buffer.from(
          JSON.stringify({
            resourceSpans: [{ scopeSpans: [{ spans: [{ name: "x" }] }] }],
          }),
          "utf-8",
        ),
      );
      expect(peekCustomerTraceIds(body, "application/json")).toEqual([]);
    });
  });

  describe("when the request has many distinct trace_ids", () => {
    it("respects the max cap", () => {
      // Build 20 distinct ids, ask for 5
      const ids = Array.from({ length: 20 }, (_, i) =>
        Buffer.from(
          i.toString(16).padStart(2, "0").repeat(16).slice(0, 32),
          "hex",
        ),
      );
      const body = protobufOtlpBody(ids);
      const result = peekCustomerTraceIds(
        body,
        "application/x-protobuf",
        5,
      );
      expect(result).toHaveLength(5);
      // Each id must be 32 hex chars (16 bytes).
      for (const id of result) {
        expect(id).toMatch(/^[0-9a-f]{32}$/);
      }
    });
  });
});

describe("classifyTokenType", () => {
  describe("when given a PAT prefix", () => {
    it("classifies pat-lw-… tokens as pat", () => {
      expect(classifyTokenType("pat-lw-abcdef123456")).toBe("pat");
    });
  });

  describe("when given a legacy SDK key prefix", () => {
    it("classifies sk-lw-… tokens as legacy", () => {
      expect(classifyTokenType("sk-lw-abcdef123456")).toBe("legacy");
    });
  });

  describe("when given anything else", () => {
    it("returns unknown for an arbitrary string", () => {
      expect(classifyTokenType("abc123")).toBe("unknown");
    });

    it("returns unknown for an empty string", () => {
      expect(classifyTokenType("")).toBe("unknown");
    });

    it("does not match a PAT prefix in the middle of the token", () => {
      // Defensive: only the start of the string counts. This protects
      // against pathological inputs from being misclassified.
      expect(classifyTokenType("xpat-lw-abc")).toBe("unknown");
    });
  });
});
