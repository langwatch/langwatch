import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

/**
 * Email templates render Liquid → Markdown → HTML, sanitized to an email-safe
 * allowlist; `<img>` is excluded to prevent tracking pixel metadata leakage.
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
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
  ],
  allowedAttributes: {
    a: ["href", "title", "target", "rel"],
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
