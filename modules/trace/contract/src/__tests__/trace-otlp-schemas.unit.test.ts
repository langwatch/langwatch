import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { anyValueSchema, bytesSchema, idSchema, spanSchema } from "@langwatch/trace-contract";

/** Parses with `schema`, failing the test when it refuses, and hands back the parsed value. */
function expectParsed<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);

  expect(result.success).toBe(true);
  if (!result.success) throw result.error;

  return result.data;
}

describe("otlp schemas", () => {
  describe("idSchema", () => {
    describe("when parsing string IDs", () => {
      it("passes through string IDs unchanged", () => {
        const traceId = "abc123def456";

        const parsed = expectParsed(idSchema, traceId);

        expect(parsed).toBe(traceId);
      });
    });

    describe("when parsing Uint8Array IDs", () => {
      it("transforms Uint8Array to hex string", () => {
        // Trace ID bytes: [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]
        const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

        const parsed = expectParsed(idSchema, bytes);

        expect(parsed).toBe("0102030405060708");
      });

      it("transforms empty Uint8Array to empty string", () => {
        const bytes = new Uint8Array([]);

        const parsed = expectParsed(idSchema, bytes);

        expect(parsed).toBe("");
      });

      it("handles standard 16-byte trace IDs", () => {
        // Typical OpenTelemetry trace ID (16 bytes)
        const bytes = new Uint8Array([
          0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88,
          0x99,
        ]);

        const parsed = expectParsed(idSchema, bytes);

        expect(parsed).toBe("aabbccddeeff00112233445566778899");
      });

      it("handles standard 8-byte span IDs", () => {
        // Typical OpenTelemetry span ID (8 bytes)
        const bytes = new Uint8Array([0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef]);

        const parsed = expectParsed(idSchema, bytes);

        expect(parsed).toBe("0123456789abcdef");
      });
    });

    describe("when parsing JSON-serialized Uint8Array (object with numeric keys)", () => {
      it("transforms numeric-keyed object to hex string", () => {
        // JSON.stringify(new Uint8Array([1, 2, 3])) produces {"0":1,"1":2,"2":3}
        const jsonSerializedBytes = { "0": 1, "1": 2, "2": 3, "3": 4 };

        const parsed = expectParsed(idSchema, jsonSerializedBytes);

        expect(parsed).toBe("01020304");
      });

      it("handles out-of-order keys correctly", () => {
        // Keys may not be in order when parsed from JSON
        const jsonSerializedBytes = { "2": 3, "0": 1, "1": 2 };

        const parsed = expectParsed(idSchema, jsonSerializedBytes);

        expect(parsed).toBe("010203");
      });

      it("handles empty object", () => {
        const jsonSerializedBytes = {};

        const parsed = expectParsed(idSchema, jsonSerializedBytes);

        expect(parsed).toBe("");
      });
    });
  });

  describe("spanSchema", () => {
    function makeValidSpan(overrides: Record<string, unknown> = {}) {
      return {
        traceId: "aaaa0000000000000000000000000001",
        spanId: "bbbb000000000001",
        name: "test-span",
        kind: 1,
        startTimeUnixNano: "1700000000000000000",
        endTimeUnixNano: "1700000001000000000",
        attributes: [],
        events: [],
        links: [],
        status: { code: null, message: null },
        droppedAttributesCount: 0,
        droppedEventsCount: 0,
        droppedLinksCount: 0,
        ...overrides,
      };
    }

    describe("when status is a valid object", () => {
      it("accepts status with code and message", () => {
        const span = makeValidSpan({ status: { code: 1, message: "OK" } });

        const parsed = expectParsed(spanSchema, span);

        expect(parsed.status).toEqual({ code: 1, message: "OK" });
      });
    });

    describe("when status is null (.NET OTEL SDK)", () => {
      it("accepts null status and defaults to code=null, message=null", () => {
        const span = makeValidSpan({ status: null });

        const parsed = expectParsed(spanSchema, span);

        expect(parsed.status).toEqual({ code: null, message: null });
      });
    });

    describe("when status is undefined", () => {
      it("accepts undefined status and defaults to code=null, message=null", () => {
        const span = makeValidSpan();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (span as any).status;

        const parsed = expectParsed(spanSchema, span);

        expect(parsed.status).toEqual({ code: null, message: null });
      });
    });

    describe("when status has empty object (no code/message)", () => {
      it("accepts empty status object", () => {
        const span = makeValidSpan({ status: {} });

        const parsed = expectParsed(spanSchema, span);

        expect(parsed.status).toEqual({});
      });
    });
  });

  describe("anyValueSchema bytesValue", () => {
    describe("when value has a Uint8Array bytesValue", () => {
      it("validates successfully", () => {
        const value = { bytesValue: new Uint8Array([1, 2, 3]) };

        const parsed = expectParsed(anyValueSchema, value);

        expect(parsed.bytesValue).toBeInstanceOf(Uint8Array);
        expect(parsed.bytesValue).toEqual(new Uint8Array([1, 2, 3]));
      });
    });

    describe("when bytesValue goes through JSON round-trip", () => {
      it("reconstructs Uint8Array from serialized object", () => {
        const original = { bytesValue: new Uint8Array([10, 20, 30]) };
        // JSON.stringify converts Uint8Array to {"0":10,"1":20,"2":30}
        const roundTripped = JSON.parse(JSON.stringify(original));

        const parsed = expectParsed(anyValueSchema, roundTripped);

        expect(parsed.bytesValue).toBeInstanceOf(Uint8Array);
        expect(parsed.bytesValue).toEqual(new Uint8Array([10, 20, 30]));
      });
    });

    describe("when bytesValue is null", () => {
      it("accepts null bytesValue", () => {
        const value = { bytesValue: null };

        const parsed = expectParsed(anyValueSchema, value);

        expect(parsed.bytesValue).toBeNull();
      });
    });
  });

  describe("bytesSchema", () => {
    it("validates Uint8Array instances", () => {
      const bytes = new Uint8Array([1, 2, 3]);

      const result = bytesSchema.safeParse(bytes);

      expect(result.success).toBe(true);
    });

    it("rejects non-Uint8Array values", () => {
      const notBytes = [1, 2, 3];

      const result = bytesSchema.safeParse(notBytes);

      expect(result.success).toBe(false);
    });

    it("rejects strings", () => {
      const stringValue = "not bytes";

      const result = bytesSchema.safeParse(stringValue);

      expect(result.success).toBe(false);
    });
  });
});
