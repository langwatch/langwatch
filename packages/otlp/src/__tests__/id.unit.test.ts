import { describe, expect, it } from "vitest";

import { bytesToHex, decodeBase64OpenTelemetryId } from "../id";

const TRACE_ID_BYTES = new Uint8Array([
  0x4b, 0xf9, 0x2f, 0x35, 0x77, 0xb3, 0x4d, 0xa6, 0xa3, 0xce, 0x92, 0x9d, 0x0e, 0x0e, 0x47, 0x36,
]);
const TRACE_ID_HEX = "4bf92f3577b34da6a3ce929d0e0e4736";
const TRACE_ID_BASE64 = Buffer.from(TRACE_ID_BYTES).toString("base64");

describe("bytesToHex", () => {
  it("writes two lower-case digits per byte", () => {
    expect(bytesToHex(TRACE_ID_BYTES)).toBe(TRACE_ID_HEX);
  });

  it("keeps the leading zero of a byte below sixteen", () => {
    expect(bytesToHex(new Uint8Array([0x00, 0x0e, 0xff]))).toBe("000eff");
  });

  it("answers the empty string for no bytes", () => {
    expect(bytesToHex(new Uint8Array([]))).toBe("");
  });
});

describe("decodeBase64OpenTelemetryId", () => {
  describe("given the binary protocol's bytes", () => {
    it("hex-encodes them", () => {
      expect(decodeBase64OpenTelemetryId(TRACE_ID_BYTES)).toBe(TRACE_ID_HEX);
    });
  });

  describe("given protobuf-JSON's base64", () => {
    it("decodes it to the same hex the bytes give", () => {
      expect(TRACE_ID_BASE64).toMatch(/[+/=]/);
      expect(decodeBase64OpenTelemetryId(TRACE_ID_BASE64)).toBe(TRACE_ID_HEX);
    });

    it("decodes a span id, which is half the width", () => {
      const spanId = new Uint8Array([0x00, 0xf0, 0x67, 0xaa, 0x0b, 0xa9, 0x02, 0xb7]);
      expect(decodeBase64OpenTelemetryId(Buffer.from(spanId).toString("base64"))).toBe(
        "00f067aa0ba902b7",
      );
    });
  });

  describe("given hex a sender already encoded", () => {
    /**
     * The case the `[+/=]` test exists for. A 32-character hex identifier is
     * also syntactically valid base64, so decoding on "does this parse as
     * base64" would silently return a DIFFERENT identifier for every sender
     * that emits hex. Only a character hex cannot contain is proof.
     */
    it("returns it unchanged rather than decoding it as base64", () => {
      expect(decodeBase64OpenTelemetryId(TRACE_ID_HEX)).toBe(TRACE_ID_HEX);
    });

    it("returns an all-digit identifier unchanged", () => {
      expect(decodeBase64OpenTelemetryId("0123456789abcdef")).toBe("0123456789abcdef");
    });
  });

  describe("given something that is not an identifier", () => {
    it.each([
      ["null", null],
      ["undefined", undefined],
      ["a number", 42],
      ["an object", { traceId: TRACE_ID_HEX }],
      ["an array", [1, 2, 3]],
    ])("answers null for %s", (_label, value) => {
      expect(decodeBase64OpenTelemetryId(value)).toBeNull();
    });

    it("answers the empty string for the empty string, which contains no base64 marker", () => {
      expect(decodeBase64OpenTelemetryId("")).toBe("");
    });
  });
});
