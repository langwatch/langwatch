import { describe, it, expect } from "vitest";
import { deserializeAttributes, serializeAttributes } from "../span-storage.clickhouse.repository";

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

describe("deserializeAttributes", () => {
  describe("when given boolean strings", () => {
    it("converts 'true' to boolean true", () => {
      const result = deserializeAttributes({ flag: "true" });
      expect(result).toEqual({ flag: true });
    });

    it("converts 'false' to boolean false", () => {
      const result = deserializeAttributes({ flag: "false" });
      expect(result).toEqual({ flag: false });
    });
  });

  describe("when given numeric strings", () => {
    it("converts integer strings to numbers", () => {
      const result = deserializeAttributes({ count: "42" });
      expect(result).toEqual({ count: 42 });
    });

    it("converts float strings to numbers", () => {
      const result = deserializeAttributes({ rate: "3.14" });
      expect(result).toEqual({ rate: 3.14 });
    });

    it("converts negative number strings", () => {
      const result = deserializeAttributes({ offset: "-5" });
      expect(result).toEqual({ offset: -5 });
    });
  });

  describe("when given JSON strings", () => {
    it("parses JSON objects", () => {
      const result = deserializeAttributes({ data: '{"nested":true}' });
      expect(result).toEqual({ data: { nested: true } });
    });

    it("parses JSON arrays", () => {
      const result = deserializeAttributes({ items: "[1,2,3]" });
      expect(result).toEqual({ items: [1, 2, 3] });
    });

    it("keeps invalid JSON-looking strings as strings", () => {
      const result = deserializeAttributes({ bad: "{not json" });
      expect(result).toEqual({ bad: "{not json" });
    });
  });

  describe("when given plain strings", () => {
    it("keeps non-special strings unchanged", () => {
      const result = deserializeAttributes({ name: "hello world" });
      expect(result).toEqual({ name: "hello world" });
    });

    it("keeps empty strings unchanged", () => {
      const result = deserializeAttributes({ empty: "" });
      expect(result).toEqual({ empty: "" });
    });
  });

  describe("when round-tripping with serializeAttributes", () => {
    it("recovers numbers after serialize → deserialize", () => {
      const original = { count: 42, rate: 3.14 };
      const serialized = serializeAttributes(original);
      const deserialized = deserializeAttributes(serialized);
      expect(deserialized).toEqual(original);
    });

    it("recovers booleans after serialize → deserialize", () => {
      const original = { flag: true, off: false };
      const serialized = serializeAttributes(original);
      const deserialized = deserializeAttributes(serialized);
      expect(deserialized).toEqual(original);
    });

    it("recovers objects after serialize → deserialize", () => {
      const original = { data: { nested: true, count: 1 } };
      const serialized = serializeAttributes(original);
      const deserialized = deserializeAttributes(serialized);
      expect(deserialized).toEqual(original);
    });

    it("recovers arrays after serialize → deserialize", () => {
      const original = { items: [1, 2, 3] };
      const serialized = serializeAttributes(original);
      const deserialized = deserializeAttributes(serialized);
      expect(deserialized).toEqual(original);
    });
  });
});
