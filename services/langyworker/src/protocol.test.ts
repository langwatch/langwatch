import { describe, expect, it } from "vitest";
import {
  MAX_FIELD_BYTES,
  TRUNCATION_MARKER,
  boundJsonValue,
  boundText,
  parseCommand,
  truncateToBytes,
} from "./protocol.js";

describe("parseCommand", () => {
  describe("when a valid turn line", () => {
    it("parses turnId, prompt and the optional fields", () => {
      expect(
        parseCommand('{"type":"turn","turnId":"t1","prompt":"hi","system":"s","resumeToken":"r"}'),
      ).toEqual({ type: "turn", turnId: "t1", prompt: "hi", system: "s", resumeToken: "r" });
    });

    it("omits optional fields that are absent", () => {
      expect(parseCommand('{"type":"turn","turnId":"t1","prompt":"hi"}')).toEqual({
        type: "turn",
        turnId: "t1",
        prompt: "hi",
      });
    });
  });

  describe("when abort, shutdown_imminent and ping lines", () => {
    it("parses them", () => {
      expect(parseCommand('{"type":"abort","turnId":"t1"}')).toEqual({
        type: "abort",
        turnId: "t1",
      });
      expect(parseCommand('{"type":"shutdown_imminent","deadlineMs":123}')).toEqual({
        type: "shutdown_imminent",
        deadlineMs: 123,
      });
      expect(parseCommand('{"type":"ping"}')).toEqual({ type: "ping" });
    });
  });

  describe("when garbage input", () => {
    it("returns undefined for non-JSON, non-objects, unknown types and missing fields", () => {
      expect(parseCommand("not json")).toBeUndefined();
      expect(parseCommand('"a string"')).toBeUndefined();
      expect(parseCommand("[1,2]")).toBeUndefined();
      expect(parseCommand('{"type":"launch_missiles"}')).toBeUndefined();
      expect(parseCommand('{"type":"turn","prompt":"no id"}')).toBeUndefined();
      expect(parseCommand('{"type":"turn","turnId":"","prompt":"x"}')).toBeUndefined();
      expect(parseCommand('{"type":"abort"}')).toBeUndefined();
    });
  });
});

describe("boundText", () => {
  it("passes small strings through untouched", () => {
    expect(boundText("hello")).toBe("hello");
  });

  it("caps oversized strings at the limit with the marker appended", () => {
    const bounded = boundText("x".repeat(MAX_FIELD_BYTES + 10));
    expect(Buffer.byteLength(bounded, "utf8")).toBeLessThanOrEqual(MAX_FIELD_BYTES);
    expect(bounded.endsWith(TRUNCATION_MARKER)).toBe(true);
  });

  it("never splits a multi-byte code point", () => {
    const bounded = boundText("é".repeat(100), 41);
    expect(Buffer.byteLength(bounded, "utf8")).toBeLessThanOrEqual(41);
    expect(bounded.endsWith(TRUNCATION_MARKER)).toBe(true);
    // Round trip must not contain a replacement char from a split code point.
    expect(bounded.includes("�")).toBe(false);
  });

  it("keeps the cap when the budget is smaller than the marker", () => {
    const bounded = boundText("é".repeat(100), 21);
    expect(Buffer.byteLength(bounded, "utf8")).toBeLessThanOrEqual(21);
    expect(bounded.includes("�")).toBe(false);
  });
});

describe("boundJsonValue", () => {
  it("passes small values through as-is", () => {
    expect(boundJsonValue({ a: 1 })).toEqual({ a: 1 });
  });

  it("replaces oversized values with a truncated marked string", () => {
    const bounded = boundJsonValue({ big: "x".repeat(MAX_FIELD_BYTES) }, 1024);
    expect(typeof bounded).toBe("string");
    expect((bounded as string).endsWith(TRUNCATION_MARKER)).toBe(true);
    expect(Buffer.byteLength(bounded as string, "utf8")).toBeLessThanOrEqual(1024);
  });

  it("handles unserializable values", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(typeof boundJsonValue(cyclic)).toBe("string");
  });
});

describe("truncateToBytes", () => {
  it("returns the string unchanged when it fits", () => {
    expect(truncateToBytes("abc", 10)).toBe("abc");
  });

  it("cuts on a byte budget without splitting code points", () => {
    // "é" is 2 bytes; a 3-byte budget can only hold one whole "é".
    expect(truncateToBytes("ééé", 3)).toBe("é");
    expect(truncateToBytes("abc", 0)).toBe("");
  });
});
