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

    /** @scenario "A list is counted with no pipe in front of length" */
    it("counts the whole document with a bare length, the way jq spells it", () => {
      expect(applyJq("length", [1, 2, 3])).toBe(3);
      expect(applyJq("length", DATA)).toBe(1);
    });
  });

  // Indexing is the first thing anyone tries after reading the flag's own
  // `.traces[].traceId` example. It used to throw, which sent the caller off to
  // write its own reader; it is implemented now, with jq's own semantics.
  describe("when the expression indexes an array", () => {
    /** @scenario "An index reads one row out of a list" */
    it("reads one row out of a list", () => {
      expect(applyJq(".traces[0].traceId", DATA)).toBe("t1");
      expect(applyJq(".traces[0]", DATA)).toEqual(DATA.traces[0]);
    });

    /** @scenario "A negative index counts from the end" */
    it("counts a negative index from the end", () => {
      expect(applyJq(".traces[-1].traceId", DATA)).toBe("t2");
    });

    /** @scenario "An index past the end answers null" */
    it("answers null past the end, the way jq does", () => {
      expect(applyJq(".traces[9]", DATA)).toBeNull();
      expect(applyJq(".traces[-9]", DATA)).toBeNull();
    });

    it("indexes at the root", () => {
      expect(applyJq(".[1]", [{ id: "a" }, { id: "b" }])).toEqual({ id: "b" });
    });

    it("indexes under iteration", () => {
      expect(applyJq(".traces[].spans[0].id", DATA)).toEqual(["s1", "s3"]);
    });

    /** @scenario "An index into something that is not a list is refused" */
    it("refuses to index a value that is not an array", () => {
      expect(() => applyJq(".traces[0].spans[0].id[0]", DATA)).toThrow(
        /indexes a value that is not an array/,
      );
    });
  });

  // Each of these previously walked as a literal key, missed, and returned
  // null at exit 0, a fabricated answer the caller then builds on.
  describe("when the expression uses syntax this subset does not implement", () => {
    /** @scenario "Syntax the subset does not implement is still refused" */
    it.each([
      ['.["traces"]'],
      [".traces[]?"],
      [".traces[1:2]"],
      // Operators: a denylist missed these and answered `null` silently.
      [".traces - 1"],
      [".traces,.other"],
      [".traces + 1"],
      [".traces(x)"],
      // A minus with no digits: this parsed as an index of NaN and traversed
      // to null, which is exactly the fabricated answer this list exists for.
      [".traces[-]"],
    ])("throws rather than answering null for %s", (expression) => {
      expect(() => applyJq(expression, DATA)).toThrow(
        /unsupported syntax|must start with/,
      );
    });

    it("throws on an empty segment", () => {
      expect(() => applyJq(".traces..traceId", DATA)).toThrow(/empty segment/);
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
  describe("when the expression asks for more than the subset does", () => {
    /** @scenario "The built-in filter names the shell tools when it is asked for more" */
    it.each([
      ["[.results[] | {index, expected: .entry.l3}]"],
      [".results[] | map(.id)"],
      ['.["traces"]'],
      // A typo rather than a reach for more power, but the caller still needs
      // to be told where the rest of the work can be done.
      [".traces..traceId"],
    ])("names jq and python in the shell for %s", (expression) => {
      expect(() => applyJq(expression, { results: [] })).toThrow(
        /`jq` and `python` are both in your shell/,
      );
    });
  });
});
