import { describe, expect, it } from "vitest";
import { InputCategory, MAX_LEADING_MARKERS } from "../categories";
import { categoryForMarkerTag, splitLeadingMarkers } from "../contextMarkers";

describe("categoryForMarkerTag", () => {
  describe("when the tag is a system-reminder", () => {
    it("maps to prior_context, not user input", () => {
      expect(categoryForMarkerTag("system-reminder")).toBe(
        InputCategory.PRIOR_CONTEXT,
      );
    });
  });

  describe("when the tag is mcp-instructions", () => {
    it("maps to MCP tool definitions", () => {
      expect(categoryForMarkerTag("mcp-instructions")).toBe(
        InputCategory.MCP_TOOL_DEFINITIONS,
      );
    });
  });

  describe("when the tag is skill-related", () => {
    it("maps skill to skill_content", () => {
      expect(categoryForMarkerTag("skill")).toBe(InputCategory.SKILL_CONTENT);
    });

    it("maps skills-list to skill_content", () => {
      expect(categoryForMarkerTag("skills-list")).toBe(
        InputCategory.SKILL_CONTENT,
      );
    });

    it("maps a command-name/command-message pair to skill_content", () => {
      expect(categoryForMarkerTag("command-name")).toBe(
        InputCategory.SKILL_CONTENT,
      );
      expect(categoryForMarkerTag("command-message")).toBe(
        InputCategory.SKILL_CONTENT,
      );
    });
  });

  describe("when the tag is unknown", () => {
    it("falls back to prior_context, never user input", () => {
      expect(categoryForMarkerTag("mystery-injected-block")).toBe(
        InputCategory.PRIOR_CONTEXT,
      );
    });
  });
});

describe("splitLeadingMarkers", () => {
  describe("when injected context precedes the real request", () => {
    it("separates the leading markers from the body", () => {
      const { markers, body } = splitLeadingMarkers(
        "<system-reminder>be careful</system-reminder>\nPlease refactor this",
      );
      expect(markers).toHaveLength(1);
      expect(markers[0]?.category).toBe(InputCategory.PRIOR_CONTEXT);
      expect(body).toBe("Please refactor this");
    });

    it("peels multiple consecutive markers of different kinds", () => {
      const { markers, body } = splitLeadingMarkers(
        "<mcp-instructions>use tools</mcp-instructions><skill>testing</skill>real question",
      );
      expect(markers.map((m) => m.category)).toEqual([
        InputCategory.MCP_TOOL_DEFINITIONS,
        InputCategory.SKILL_CONTENT,
      ]);
      expect(body).toBe("real question");
    });
  });

  describe("when there is no leading tag", () => {
    it("returns the whole text as the body with no markers", () => {
      const { markers, body } = splitLeadingMarkers("just a plain message");
      expect(markers).toHaveLength(0);
      expect(body).toBe("just a plain message");
    });
  });

  describe("when a tag appears after prose", () => {
    it("leaves interleaved tags untouched", () => {
      const { markers, body } = splitLeadingMarkers(
        "hello <system-reminder>x</system-reminder>",
      );
      expect(markers).toHaveLength(0);
      expect(body).toBe("hello <system-reminder>x</system-reminder>");
    });
  });

  describe("when the text is many small leading tags (adversarial)", () => {
    it("bounds the peel at the marker cap without losing the body", () => {
      // Adversarial leading-tag spam used to drive an O(n^2) tail-reslice on the
      // synchronous ingest path. The cursor rewrite is linear and the cap bounds
      // the marker array; the untouched remainder (further tags + prose) stays
      // as body, so the real content is never dropped.
      const n = 20_000;
      const { markers, body } = splitLeadingMarkers(
        `${"<a></a>".repeat(n)}the real question`,
      );

      expect(markers.length).toBe(MAX_LEADING_MARKERS);
      expect(body.endsWith("the real question")).toBe(true);
    });
  });

  describe("when leading tags exceed the marker cap", () => {
    it("stops at MAX_LEADING_MARKERS and leaves the rest as the body", () => {
      const overCap = MAX_LEADING_MARKERS + 5;
      const { markers, body } = splitLeadingMarkers(
        `${"<system-reminder>x</system-reminder>".repeat(overCap)}tail`,
      );
      expect(markers).toHaveLength(MAX_LEADING_MARKERS);
      // The un-peeled markers remain at the head of the body, untouched.
      expect(body.startsWith("<system-reminder>x</system-reminder>")).toBe(
        true,
      );
      expect(body.endsWith("tail")).toBe(true);
    });
  });
});
