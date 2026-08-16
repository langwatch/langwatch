/**
 * How far the document walk will follow a caller's nesting.
 *
 * `visitJsonObjects` is the descent every blanket refusal rule is built on, and
 * the document it walks is caller-authored: a saved specification arrives as
 * text and is parsed before any rule has run. So the walk has to reach an
 * object however deeply it is buried, and has to survive nesting authored to
 * break it — a walk that throws refuses nothing, and the screen shows a crash
 * where a refusal belonged.
 */

import { describe, expect, it } from "vitest";
import { visitJsonObjects } from "../vegaLiteStructure";

/** Wraps `inner` in `depth` nested arrays: depth 3 → `[[[inner]]]`. */
function nestArrays(inner: unknown, depth: number): unknown {
  let built = inner;
  for (let level = 0; level < depth; level += 1) built = [built];
  return built;
}

describe("visitJsonObjects", () => {
  describe("given an object buried under nested arrays", () => {
    it("still reports it, with the pointer that reaches it", () => {
      const found = visitJsonObjects({
        layer: [[{ embedOptions: { actions: false } }]],
      });

      const buried = found.find((entry) => "embedOptions" in entry.node);
      expect(buried).toBeDefined();
      expect(buried?.path).toBe("/layer/0/0");
    });
  });

  describe("given arrays nested far deeper than the call stack allows", () => {
    /**
     * 50k is comfortably past the default stack: a recursive descent overflows
     * here, and the overflow is a RangeError thrown out of the validator rather
     * than a refusal handed to the member.
     */
    it("walks it without throwing, and finds what is at the bottom", () => {
      const hostile = {
        layer: nestArrays({ embedOptions: { actions: false } }, 50_000),
      };

      let found: ReturnType<typeof visitJsonObjects> | undefined;
      expect(() => {
        found = visitJsonObjects(hostile);
      }).not.toThrow();

      expect(found?.some((entry) => "embedOptions" in entry.node)).toBe(true);
    });
  });

  describe("given sibling objects in one array", () => {
    /**
     * Characterisation, not a promise: the walk pops a LIFO stack, so siblings
     * come back last-first. No rule depends on the order — each reads the
     * pointer — but the descent was rewritten from recursion to a worklist and
     * a reordering there would be silent, so it is pinned.
     */
    it("reports them in the stack's order, unchanged by the worklist descent", () => {
      const found = visitJsonObjects({
        layer: [{ mark: "first" }, { mark: "second" }, { mark: "third" }],
      });

      const marks = found
        .filter((entry) => typeof entry.node.mark === "string")
        .map((entry) => entry.node.mark);
      expect(marks).toEqual(["third", "second", "first"]);
    });
  });
});
