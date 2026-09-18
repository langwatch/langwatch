/**
 * The `--jq` subset, pinned to fail LOUDLY.
 *
 * This is an allowlist, not a denylist, and the distinction is the whole point:
 * an expression the subset does not implement used to walk as a literal key,
 * miss, and return `null` at exit 0 — a fabricated answer the caller then
 * builds on. Every unsupported spelling below must throw instead.
 *
 * Split out of `output-port.unit.test.ts`, which pins the port itself.
 */
import { describe, it, expect } from "vitest";
import { applyJq } from "../output";

describe("applyJq", () => {
  const DATA = {
    traces: [
      { traceId: "t1", spans: [{ id: "s1" }, { id: "s2" }] },
      { traceId: "t2", spans: [{ id: "s3" }] },
    ],
  };

  describe("when the expression is supported", () => {
    it("walks a dot path", () => {
      expect(applyJq(".traces", DATA)).toEqual(DATA.traces);
    });

    it("collects an iterated field", () => {
      expect(applyJq(".traces[].traceId", DATA)).toEqual(["t1", "t2"]);
    });

    // jq's `[ .a[].b[] ]` collects; it does not nest.
    it("flattens chained iteration rather than nesting it", () => {
      expect(applyJq(".traces[].spans[].id", DATA)).toEqual(["s1", "s2", "s3"]);
    });

    it("counts with a terminal length pipe", () => {
      expect(applyJq(".traces | length", DATA)).toBe(2);
    });
  });

  // Each of these previously walked as a literal key, missed, and returned
  // null at exit 0 — a fabricated answer the caller then builds on. Array
  // indexing is the first thing anyone tries after reading the flag's own
  // `.traces[].traceId` example, so it must fail loudly.
  describe("when the expression uses syntax this subset does not implement", () => {
    it.each([
      [".traces[0]"],
      [".traces[0].traceId"],
      ['.["traces"]'],
      [".traces[]?"],
      [".[0]"],
      [".traces[].spans[0]"],
      // Operators: a denylist missed these and answered `null` silently.
      [".traces - 1"],
      [".traces,.other"],
      [".traces + 1"],
      [".traces(x)"],
    ])("throws rather than answering null for %s", (expression) => {
      expect(() => applyJq(expression, DATA)).toThrow(/unsupported syntax|must start with/);
    });
  });

  // Root-level iteration has an empty key by design; the allowlist must not
  // mistake that for invalid syntax (it did, briefly).
  describe("when iterating at the root", () => {
    it("iterates a top-level array with .[]", () => {
      expect(applyJq(".[]", [{ id: "a" }, { id: "b" }])).toEqual([
        { id: "a" },
        { id: "b" },
      ]);
    });

    it("selects a field under root iteration with .[].id", () => {
      expect(applyJq(".[].id", [{ id: "a" }, { id: "b" }])).toEqual(["a", "b"]);
    });
  });

  describe("when a key is genuinely absent", () => {
    it("still answers null, the way jq does", () => {
      expect(applyJq(".nope", DATA)).toBeNull();
    });
  });
});
