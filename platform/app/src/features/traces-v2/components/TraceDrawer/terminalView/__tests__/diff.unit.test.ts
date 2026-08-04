import { describe, expect, it } from "vitest";
import { computeLineDiff, diffStat } from "../diff";

describe("computeLineDiff", () => {
  describe("given identical old and new text", () => {
    it("marks every line as context", () => {
      const lines = computeLineDiff("a\nb\nc", "a\nb\nc");
      expect(lines.map((l) => l.kind)).toEqual([
        "context",
        "context",
        "context",
      ]);
    });
  });

  describe("given a single changed line", () => {
    it("emits a remove immediately followed by its replacement", () => {
      const lines = computeLineDiff("a\nb\nc", "a\nB\nc");
      expect(lines.map((l) => `${l.kind}:${l.text}`)).toEqual([
        "context:a",
        "remove:b",
        "add:B",
        "context:c",
      ]);
    });

    it("numbers old and new lines independently", () => {
      const lines = computeLineDiff("a\nb\nc", "a\nB\nc");
      const removed = lines.find((l) => l.kind === "remove")!;
      const added = lines.find((l) => l.kind === "add")!;
      expect(removed.oldLineNo).toBe(2);
      expect(removed.newLineNo).toBeUndefined();
      expect(added.newLineNo).toBe(2);
      expect(added.oldLineNo).toBeUndefined();
    });
  });

  describe("given a pure insertion (empty old text)", () => {
    it("marks every line as an addition", () => {
      const lines = computeLineDiff("", "one\ntwo");
      expect(lines.map((l) => l.kind)).toEqual(["add", "add"]);
    });
  });

  describe("given an appended block", () => {
    it("keeps the shared prefix as context and the tail as additions", () => {
      const lines = computeLineDiff("a\nb", "a\nb\nc\nd");
      expect(lines.map((l) => `${l.kind}:${l.text}`)).toEqual([
        "context:a",
        "context:b",
        "add:c",
        "add:d",
      ]);
    });
  });

  describe("given a trailing newline", () => {
    it("does not treat it as an extra empty line", () => {
      const lines = computeLineDiff("a\n", "a\n");
      expect(lines).toHaveLength(1);
      expect(lines[0]!.text).toBe("a");
    });
  });
});

describe("diffStat", () => {
  it("counts additions and removals", () => {
    const lines = computeLineDiff("a\nb\nc", "a\nX\nc\nd");
    expect(diffStat(lines)).toEqual({ added: 2, removed: 1 });
  });
});
