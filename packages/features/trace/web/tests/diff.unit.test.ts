import { describe, expect, it } from "vitest";
import { computeLineDiff, diffStat } from "../src/line-diff";

describe("computeLineDiff", () => {
  it("marks identical lines as context", () => {
    expect(computeLineDiff("a\nb\nc", "a\nb\nc").map((line) => line.kind)).toEqual([
      "context",
      "context",
      "context",
    ]);
  });

  it("emits a changed line as remove then add with independent numbers", () => {
    const lines = computeLineDiff("a\nb\nc", "a\nB\nc");

    expect(lines.map((line) => `${line.kind}:${line.text}`)).toEqual([
      "context:a",
      "remove:b",
      "add:B",
      "context:c",
    ]);
    expect(lines[1]?.oldLineNo).toBe(2);
    expect(lines[1]?.newLineNo).toBeUndefined();
    expect(lines[2]?.newLineNo).toBe(2);
    expect(lines[2]?.oldLineNo).toBeUndefined();
  });

  it("handles empty input, appends, and trailing newlines", () => {
    expect(computeLineDiff("", "one\ntwo").map((line) => line.kind)).toEqual([
      "add",
      "add",
    ]);
    expect(
      computeLineDiff("a\nb", "a\nb\nc\nd").map((line) => `${line.kind}:${line.text}`),
    ).toEqual(["context:a", "context:b", "add:c", "add:d"]);
    expect(computeLineDiff("a\n", "a\n")).toHaveLength(1);
  });
});

describe("diffStat", () => {
  it("counts added and removed lines", () => {
    expect(diffStat(computeLineDiff("a\nb\nc", "a\nX\nc\nd"))).toEqual({
      added: 2,
      removed: 1,
    });
  });
});
