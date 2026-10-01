import sanitizeHtml from "sanitize-html";
import { describe, expect, it } from "vitest";
import { markdownToEmailHtml } from "../markdown";

describe("markdownToEmailHtml", () => {
  describe("when given Markdown headings and links", () => {
    it("renders them to HTML", () => {
      const html = markdownToEmailHtml(
        "# Title\n\n[link](https://example.com)",
      );
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
      const html = markdownToEmailHtml(
        '<a href="https://x.com" onclick="evil()">x</a>',
      );
      expect(html).not.toContain("onclick");
    });
  });

  describe("when a link uses a dangerous scheme", () => {
    it("drops the javascript: href", () => {
      const html = markdownToEmailHtml("[x](javascript:alert(1))");
      expect(html).not.toContain("javascript:");
    });

    it("drops a data:text/html href", () => {
      const html = markdownToEmailHtml(
        "[x](data:text/html,<script>alert(1)</script>)",
      );
      expect(html).not.toContain("data:text/html");
      expect(html).not.toContain("<script");
    });
  });

  describe("when the Markdown embeds an image", () => {
    it("strips markdown image syntax (img is off the allowlist)", () => {
      const html = markdownToEmailHtml(
        "![alt](https://tracker.example/pixel.gif)",
      );
      expect(html).not.toContain("<img");
      expect(html).not.toContain("tracker.example");
    });

    it("strips a raw img tag carrying an onerror handler", () => {
      const html = markdownToEmailHtml('<img src="x" onerror="alert(1)">');
      expect(html).not.toContain("<img");
      expect(html).not.toContain("onerror");
      expect(html).not.toContain("alert(");
    });
  });

  describe("when the Markdown carries a published sanitize-html bypass payload", () => {
    /** @scenario "An SVG animation whose URI list ends in javascript: is stripped" */
    it("strips an SVG SMIL animate whose URI list ends in javascript:", () => {
      const html = markdownToEmailHtml(SMIL_URI_LIST_PAYLOAD);
      expect(html).not.toContain("javascript:");
      expect(html).not.toContain("<animate");
    });

    /** @scenario "Markup smuggled after a literal textarea close with a solidus is stripped" */
    it("strips markup smuggled after a literal </textarea/> close", () => {
      const html = markdownToEmailHtml(TEXTAREA_SOLIDUS_PAYLOAD);
      expect(html).not.toContain("<img");
      expect(html).not.toContain("onerror=");
    });
  });
});

// The payloads of GHSA-g8qq-57p8-ggw5 and GHSA-jxwj-j7wr-gfrw. Both need a
// non-default allowlist to reach the vulnerable path, which the email
// allowlist above never grants, so they are also run against the advisories'
// own configurations. That pins the fix itself on the htmlparser2 major this
// workspace holds sanitize-html to, which is older than the one it ships with.
const SMIL_URI_LIST_PAYLOAD = `<svg><a><animate attributeName="href" values="#safe;javascript:alert('XSS')" dur=".01s" fill="freeze"></animate><text y="30">Click me</text></a></svg>`;
const TEXTAREA_SOLIDUS_PAYLOAD = `<textarea></textarea/><img src=x onerror=alert(1)></textarea>`;

describe("sanitize-html on the pinned htmlparser2 line", () => {
  describe("when SVG animation is allowed and values is scheme-checked", () => {
    it("does not keep a javascript: destination behind a safe fragment", () => {
      const html = sanitizeHtml(SMIL_URI_LIST_PAYLOAD, {
        allowedTags: sanitizeHtml.defaults.allowedTags.concat([
          "svg",
          "animate",
          "text",
        ]),
        allowedAttributes: {
          ...sanitizeHtml.defaults.allowedAttributes,
          animate: ["attributename", "values", "dur", "fill"],
          text: ["y"],
        },
        allowedSchemesAppliedToAttributes:
          sanitizeHtml.defaults.allowedSchemesAppliedToAttributes.concat([
            "values",
          ]),
      });
      expect(html).not.toContain("javascript:");
    });
  });

  describe("when textarea is on the allowlist", () => {
    it("escapes markup that follows a literal </textarea/> close", () => {
      const html = sanitizeHtml(TEXTAREA_SOLIDUS_PAYLOAD, {
        allowedTags: sanitizeHtml.defaults.allowedTags.concat(["textarea"]),
      });
      expect(html).not.toContain("<img");
      expect(html).toContain("&lt;img");
    });
  });
});
