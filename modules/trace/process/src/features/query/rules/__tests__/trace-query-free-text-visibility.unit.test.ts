import { describe, expect, it } from "vitest";

import { canSearchCapturedContent } from "../../../../rules/trace-read-mappers.rules.ts";
import { translateFilterAst, translateTraceTag } from "../trace-query.rules.ts";

const timeRange = { from: 0, to: 1 };

function freeTextSql(searchContent: boolean): string | null {
  return translateFilterAst({
    queryText: "shipped",
    ctx: { paramCounter: 0, nodeCount: 0, params: {}, timeRange },
    translateTag: (tag, negated, ctx) =>
      translateTraceTag({ tag, negated, ctx, fieldDefs: new Map(), searchContent }),
  });
}

describe("free-text search and the viewer's content visibility", () => {
  /** @scenario "Free text matches captured content only for a viewer who may read it" */
  describe("given a viewer the captured input is hidden from", () => {
    it("matches the word against trace and span names only", () => {
      const searchContent = canSearchCapturedContent({
        canSeeCapturedInput: false,
        canSeeCapturedOutput: true,
      });

      const sql = freeTextSql(searchContent);

      expect(searchContent).toBe(false);
      expect(sql).not.toContain("ComputedInput");
      expect(sql).not.toContain("ComputedOutput");
      expect(sql).toContain("TraceName");
      expect(sql).toContain("SpanName");
    });
  });

  describe("given a viewer with a hidden custom attribute", () => {
    it("does not search captured content either", () => {
      expect(
        canSearchCapturedContent({
          canSeeCapturedInput: true,
          canSeeCapturedOutput: true,
          hiddenAttributes: [{ pattern: "secret.*", visibleTo: "Admins" }],
        }),
      ).toBe(false);
    });
  });

  describe("given a viewer under no content protection", () => {
    it("still matches captured input and output", () => {
      const searchContent = canSearchCapturedContent({
        canSeeCapturedInput: true,
        canSeeCapturedOutput: true,
      });

      const sql = freeTextSql(searchContent);

      expect(searchContent).toBe(true);
      expect(sql).toContain("ComputedInput");
      expect(sql).toContain("ComputedOutput");
    });
  });
});
