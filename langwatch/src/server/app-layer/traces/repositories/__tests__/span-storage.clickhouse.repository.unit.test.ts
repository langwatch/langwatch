import { describe, it, expect } from "vitest";
import { serializeAttributes } from "../span-storage.clickhouse.repository";

describe("serializeAttributes", () => {
  describe("when given string values", () => {
    it("passes strings through unchanged", () => {
      const result = serializeAttributes({ key: "hello" });
      expect(result).toEqual({ key: "hello" });
    });
  });

  describe("when given numeric values", () => {
    it("stringifies numbers", () => {
      const result = serializeAttributes({ count: 42, float: 3.14 });
      expect(result).toEqual({ count: "42", float: "3.14" });
    });
  });

  describe("when given boolean values", () => {
    it("stringifies booleans", () => {
      const result = serializeAttributes({ flag: true, off: false });
      expect(result).toEqual({ flag: "true", off: "false" });
    });
  });

  describe("when given bigint values", () => {
    it("stringifies bigints", () => {
      const result = serializeAttributes({ big: BigInt(9007199254740991) });
      expect(result).toEqual({ big: "9007199254740991" });
    });
  });

  describe("when given object values", () => {
    it("JSON-stringifies objects", () => {
      const result = serializeAttributes({ data: { nested: true } });
      expect(result).toEqual({ data: '{"nested":true}' });
    });

    it("JSON-stringifies arrays", () => {
      const result = serializeAttributes({ items: [1, 2, 3] });
      expect(result).toEqual({ items: "[1,2,3]" });
    });
  });

  describe("when given null or undefined values", () => {
    it("skips null values", () => {
      const result = serializeAttributes({ key: null });
      expect(result).toEqual({});
    });

    it("skips undefined values", () => {
      const result = serializeAttributes({ key: undefined });
      expect(result).toEqual({});
    });
  });

  describe("when given unserializable values", () => {
    it("skips values with circular references", () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      const result = serializeAttributes({ ok: "yes", bad: circular });
      expect(result).toEqual({ ok: "yes" });
    });
  });
});
