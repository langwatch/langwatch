import { describe, expect, it } from "vitest";

import { parseUnifiedDiff } from "../src/unified-diff.ts";

describe("parseUnifiedDiff", () => {
  describe("given a hunk", () => {
    it("numbers old and new lines from the hunk header and strips the markers", () => {
      const lines = parseUnifiedDiff("@@ -10,3 +20,3 @@\n keep\n-old\n+new");

      expect(lines.map((l) => [l.kind, l.text, l.oldLine, l.newLine])).toEqual([
        ["hunk", "@@ -10,3 +20,3 @@", null, null],
        ["context", "keep", 10, 20],
        ["remove", "old", 11, null],
        ["add", "new", null, 21],
      ]);
    });
  });

  describe("given file headers before the first hunk", () => {
    it("reads them as headers, not as a removal and an addition", () => {
      const lines = parseUnifiedDiff("--- a/x.py\n+++ b/x.py\n@@ -1 +1 @@\n-a\n+b");

      expect(lines.map((l) => l.kind)).toEqual(["meta", "meta", "hunk", "remove", "add"]);
    });
  });

  describe("given a removed line that starts with dashes inside a hunk", () => {
    it("keeps it a removal", () => {
      const [, removed] = parseUnifiedDiff("@@ -1 +0,0 @@\n--- a comment");

      expect(removed).toMatchObject({ kind: "remove", text: "-- a comment" });
    });
  });

  describe("given bare +/- lines with no headers", () => {
    it("numbers both sides from 1", () => {
      const lines = parseUnifiedDiff(" a\n-b\n+c");

      expect(lines.map((l) => [l.oldLine, l.newLine])).toEqual([
        [1, 1],
        [2, null],
        [null, 2],
      ]);
    });
  });
});
