import { describe, expect, it } from "vitest";
import { bytesSchema, idSchema } from "../otlp";

describe("otlp schemas", () => {
  describe("idSchema", () => {
    describe("when parsing string IDs", () => {
      it("passes through string IDs unchanged", () => {
        const traceId = "abc123def456";

        const result = idSchema.safeParse(traceId);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toBe(traceId);
        }
      });
    });

    describe("when parsing Uint8Array IDs", () => {
      it("transforms Uint8Array to hex string", () => {
        // Trace ID bytes: [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]
        const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

        const result = idSchema.safeParse(bytes);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toBe("0102030405060708");
        }
      });

      it("transforms empty Uint8Array to empty string", () => {
        const bytes = new Uint8Array([]);

        const result = idSchema.safeParse(bytes);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toBe("");
        }
      });

      it("handles standard 16-byte trace IDs", () => {
        // Typical OpenTelemetry trace ID (16 bytes)
        const bytes = new Uint8Array([
          0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x00, 0x11, 0x22, 0x33, 0x44,
          0x55, 0x66, 0x77, 0x88, 0x99,
        ]);

        const result = idSchema.safeParse(bytes);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toBe("aabbccddeeff00112233445566778899");
        }
      });

      it("handles standard 8-byte span IDs", () => {
        // Typical OpenTelemetry span ID (8 bytes)
        const bytes = new Uint8Array([
          0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef,
        ]);

        const result = idSchema.safeParse(bytes);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toBe("0123456789abcdef");
        }
      });
    });

    describe("when parsing JSON-serialized Uint8Array (object with numeric keys)", () => {
      it("transforms numeric-keyed object to hex string", () => {
        // JSON.stringify(new Uint8Array([1, 2, 3])) produces {"0":1,"1":2,"2":3}
        const jsonSerializedBytes = { "0": 1, "1": 2, "2": 3, "3": 4 };

        const result = idSchema.safeParse(jsonSerializedBytes);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toBe("01020304");
        }
      });

      it("handles out-of-order keys correctly", () => {
        // Keys may not be in order when parsed from JSON
        const jsonSerializedBytes = { "2": 3, "0": 1, "1": 2 };

        const result = idSchema.safeParse(jsonSerializedBytes);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toBe("010203");
        }
      });

      it("handles empty object", () => {
        const jsonSerializedBytes = {};

        const result = idSchema.safeParse(jsonSerializedBytes);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toBe("");
        }
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
