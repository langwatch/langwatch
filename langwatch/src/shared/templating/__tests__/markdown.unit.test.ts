import { describe, expect, it } from "vitest";
import { markdownToEmailHtml } from "../markdown";

describe("markdownToEmailHtml", () => {
  describe("when given Markdown headings and links", () => {
    it("renders them to HTML", () => {
      const html = markdownToEmailHtml("# Title\n\n[link](https://example.com)");
      expect(html).toContain("<h1>Title</h1>");
      expect(html).toContain('href="https://example.com"');
    });

    it("forces links to open safely in a new tab", () => {
      const html = markdownToEmailHtml("[x](https://example.com)");
      expect(html).toContain('target="_blank"');
      expect(html).toContain('rel="noopener noreferrer"');
    });
  });

  describe("when the Markdown contains raw HTML scripts", () => {
    it("strips the script tag", () => {
      const html = markdownToEmailHtml(
        "Hello <script>alert('x')</script> world",
      );
      expect(html).not.toContain("<script");
      expect(html).not.toContain("alert(");
    });
  });

  describe("when the Markdown contains an event handler attribute", () => {
    it("strips the handler", () => {
      const html = markdownToEmailHtml('<a href="https://x.com" onclick="evil()">x</a>');
      expect(html).not.toContain("onclick");
    });
  });

  describe("when a link uses a dangerous scheme", () => {
    it("drops the javascript: href", () => {
      const html = markdownToEmailHtml("[x](javascript:alert(1))");
      expect(html).not.toContain("javascript:");
    });
  });
});
