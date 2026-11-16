import { describe, expect, it } from "vitest";

import {
  traceDerivedAttrPrefixes,
  traceReadMapperPorts,
} from "../../../../rules/trace-read-mapper-ports.rules.ts";
import {
  canSearchCapturedContent,
  hiddenAttributeKeyMatcher,
} from "../../../../rules/trace-read-mappers.rules.ts";
import { builtTraceFilter } from "../../../../services/__tests__/fixtures/trace-query-services.fixtures.ts";

const timeRange = { from: 0, to: 1 };

function freeTextSql(searchContent: boolean): string | undefined {
  return builtTraceFilter({ queryText: "shipped", timeRange, searchContent })?.sql;
}

describe("free-text search and the viewer's content visibility", () => {
  describe("given a viewer the captured input is hidden from", () => {
    /** @scenario "Free text matches captured content only for a viewer who may read it" */
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

describe("attribute filters and the viewer's content visibility", () => {
  const isHiddenAttribute = hiddenAttributeKeyMatcher({
    protections: { canSeeCapturedInput: false, canSeeCapturedOutput: true },
    contentPrivacy: traceReadMapperPorts.contentPrivacy,
    derivedPrefixes: traceDerivedAttrPrefixes,
  });

  function attributeFilter(queryText: string) {
    return builtTraceFilter({ queryText, timeRange, isHiddenAttribute });
  }

  describe("given a viewer the captured input is hidden from", () => {
    /** @scenario "An attribute filter on a value the viewer may not read matches nothing" */
    it("matches nothing on a captured-input attribute", () => {
      for (const queryText of [
        'span.attribute.gen_ai.prompt:"shipped"',
        'trace.attribute.langwatch.gen_ai.input.text:"shipped"',
      ]) {
        const filter = attributeFilter(queryText);
        expect(filter?.params).toEqual({ timeFrom: 0, timeTo: 1 });
        expect(filter?.sql).not.toContain("SpanAttributes");
        expect(filter?.sql).not.toContain("shipped");
        expect(filter?.sql).not.toContain("gen_ai");
      }
    });

    it("still filters on an attribute the viewer may read", () => {
      expect(attributeFilter('span.attribute.gen_ai.request.model:"gpt-5"')?.sql).toContain(
        "SpanAttributes",
      );
    });
  });
});
