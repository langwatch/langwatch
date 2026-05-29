import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

/**
 * Email body templates render Liquid → Markdown → HTML. The Markdown output is
 * sanitized to an email-safe tag set: no scripts, no event handlers, no inline
 * styles, links forced to open in a new tab with `rel="noopener noreferrer"`.
 * Customer-authored content flows through here, so the allowlist is the trust
 * boundary.
 */
const EMAIL_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "a",
    "ul",
    "ol",
    "li",
    "blockquote",
    "code",
    "pre",
    "em",
    "strong",
    "del",
    "hr",
    "br",
    "img",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
  ],
  allowedAttributes: {
    a: ["href", "title", "target", "rel"],
    img: ["src", "alt", "title", "width", "height"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", {
      rel: "noopener noreferrer",
      target: "_blank",
    }),
  },
};

export function markdownToEmailHtml(markdownSource: string): string {
  const rawHtml = marked.parse(markdownSource, { async: false });
  return sanitizeHtml(rawHtml, EMAIL_SANITIZE_OPTIONS);
}
