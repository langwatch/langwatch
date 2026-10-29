import { describe, expect, it } from "vitest";

import { inlineText, localHref, parseInline } from "../model/inline.ts";

describe("docs.json inline Markdown", () => {
  describe("when a banner links a bold label to a docs page", () => {
    /** @scenario "Show the authored announcement beside the release update" */
    it("keeps emphasis around the link and makes the docs address site-relative", () => {
      const nodes = parseInline({
        source:
          "**[Get started](https://langwatch.ai/docs/skills/directory):** Set up `evals` by asking.",
      });
      expect(nodes).toEqual([
        {
          type: "strong",
          children: [
            {
              type: "link",
              href: "/skills/directory",
              children: [{ type: "text", value: "Get started" }],
            },
            { type: "text", value: ":" },
          ],
        },
        { type: "text", value: " Set up " },
        { type: "code", value: "evals" },
        { type: "text", value: " by asking." },
      ]);
      expect(inlineText({ nodes })).toBe("Get started: Set up evals by asking.");
    });
  });

  describe("when the Markdown is incomplete", () => {
    /** @scenario "Explain a missing page with the authored copy" */
    it("keeps unmatched markers as text", () => {
      expect(parseInline({ source: "a ** b [c] (d) `e" })).toEqual([
        { type: "text", value: "a ** b [c] (d) `e" },
      ]);
    });
  });

  describe("when a link names another host", () => {
    /** @scenario "Explain a missing page with the authored copy" */
    it("leaves it absolute and rewrites both documentation hosts", () => {
      expect(localHref({ href: "https://github.com/langwatch" })).toBe(
        "https://github.com/langwatch",
      );
      expect(localHref({ href: "https://docs.langwatch.ai/llms.txt" })).toBe("/llms.txt");
      expect(localHref({ href: "https://langwatch.ai/docs" })).toBe("/");
      expect(localHref({ href: "https://langwatch.ai/docsearch" })).toBe(
        "https://langwatch.ai/docsearch",
      );
    });
  });
});
