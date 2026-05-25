import { describe, expect, it } from "vitest";
import { splitLeadingContextBlocks } from "../leadingContext";

describe("splitLeadingContextBlocks", () => {
  describe("when a context block precedes the human text", () => {
    /** @scenario "Leading agent context is separated from the human message" */
    it("separates the leading block from the trailing prose", () => {
      const input =
        "<system-reminder>\nThe following skills are available\n</system-reminder>\n\nhi";
      const { context, body } = splitLeadingContextBlocks(input);
      expect(context).toBe(
        "<system-reminder>\nThe following skills are available\n</system-reminder>",
      );
      expect(body).toBe("hi");
    });

    it("peels multiple consecutive leading blocks", () => {
      const input =
        "<system-reminder>a</system-reminder>\n<mcp-instructions>b</mcp-instructions>\n\nwhat is 2+2?";
      const { context, body } = splitLeadingContextBlocks(input);
      expect(context).toContain("<system-reminder>a</system-reminder>");
      expect(context).toContain("<mcp-instructions>b</mcp-instructions>");
      expect(body).toBe("what is 2+2?");
    });

    it("handles attributes on the opening tag", () => {
      const input = '<system-reminder priority="high">ctx</system-reminder>\n\nyo';
      const { context, body } = splitLeadingContextBlocks(input);
      expect(context).toBe(
        '<system-reminder priority="high">ctx</system-reminder>',
      );
      expect(body).toBe("yo");
    });
  });

  describe("when the message is only a context block", () => {
    it("returns the context with an empty body", () => {
      const input = "<system-reminder>only context here</system-reminder>";
      const { context, body } = splitLeadingContextBlocks(input);
      expect(context).toBe("<system-reminder>only context here</system-reminder>");
      expect(body).toBe("");
    });
  });

  describe("when there is no leading context", () => {
    it("returns the original text untouched as the body", () => {
      const input = "just a normal message";
      const { context, body } = splitLeadingContextBlocks(input);
      expect(context).toBe("");
      expect(body).toBe("just a normal message");
    });

    /** @scenario "Tags that follow the human text are left untouched" */
    it("does not strip tags that come after real prose", () => {
      const input = "here is some xml <config>x</config> for you";
      const { context, body } = splitLeadingContextBlocks(input);
      expect(context).toBe("");
      expect(body).toBe(input);
    });

    it("leaves a malformed (unclosed) leading tag in place", () => {
      const input = "<system-reminder>no closing tag and then hi";
      const { context, body } = splitLeadingContextBlocks(input);
      expect(context).toBe("");
      expect(body).toBe(input);
    });
  });

  describe("when the body itself contains later tags", () => {
    it("strips only the leading block and keeps the body's own tags", () => {
      const input =
        "<system-reminder>ctx</system-reminder>\n\ncompare <a>1</a> and <b>2</b>";
      const { context, body } = splitLeadingContextBlocks(input);
      expect(context).toBe("<system-reminder>ctx</system-reminder>");
      expect(body).toBe("compare <a>1</a> and <b>2</b>");
    });
  });
});
