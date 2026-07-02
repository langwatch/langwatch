import { describe, expect, it } from "vitest";
import { InputCategory } from "../categories";
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
});
