import { describe, it, expect } from "vitest";
import { encode, decode, Base62Error } from "../base62.ts";

describe("Base62", () => {
  describe("encode", () => {
    it("should encode empty array", () => {
      const result = encode(new Uint8Array(0));
      expect(result).toBe("");
    });

    it("should encode single byte", () => {
      const result = encode(new Uint8Array([0]));
      expect(result).toBe("0");
    });

    it("should encode multiple bytes", () => {
      const result = encode(new Uint8Array([1, 2, 3]));
      expect(result).toBe("HBL");
    });

    it("should encode large numbers", () => {
      const result = encode(new Uint8Array([255, 255, 255, 255]));
      expect(result).toBe("4gfFC3");
    });

    it("should handle all zeros", () => {
      const result = encode(new Uint8Array([0, 0, 0, 0]));
      expect(result).toBe("0");
    });
  });

  describe("decode", () => {
    it("should decode empty string", () => {
      const result = decode("");
      expect(result).toEqual(new Uint8Array(0));
    });

    it("should decode single character", () => {
      const result = decode("0");
      expect(result).toEqual(new Uint8Array([0]));
    });

    it("should decode multiple characters", () => {
      const result = decode("HBL");
      expect(result).toEqual(new Uint8Array([1, 2, 3]));
    });

    it("should decode large numbers", () => {
      const result = decode("4gfFC3");
      expect(result).toEqual(new Uint8Array([255, 255, 255, 255]));
    });

    it("should throw error for invalid characters", () => {
      expect(() => {
        decode("invalid!");
      }).toThrow(Base62Error);
    });

    it("should throw error for characters not in alphabet", () => {
      expect(() => {
        decode("ABC123!@#");
      }).toThrow(Base62Error);
    });
  });

  describe("roundtrip", () => {
    it("should encode and decode correctly", () => {
      const original = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      const encoded = encode(original);
      const decoded = decode(encoded);
      expect(decoded).toEqual(original);
    });

    it("should handle large arrays", () => {
      const original = new Uint8Array(100).fill(255);
      const encoded = encode(original);
      const decoded = decode(encoded);
      expect(decoded).toEqual(original);
    });

    it("should handle mixed values", () => {
      const original = new Uint8Array([255, 1, 254, 2, 253]);
      const encoded = encode(original);
      const decoded = decode(encoded);
      expect(decoded).toEqual(original);
    });
  });

  describe("Base62Error", () => {
    it("should have correct name", () => {
      const error = new Base62Error("test error");
      expect(error.name).toBe("Base62Error");
    });

    it("should have correct message", () => {
      const error = new Base62Error("test error");
      expect(error.message).toBe("test error");
    });
  });
});
