import { describe, expect, it } from "vitest";

import { linkify } from "../linkify.ts";

describe("linkify", () => {
  describe("given a text body with a URL in a sentence", () => {
    /** @scenario "URLs in a plain-text body are links, not characters to copy" */
    it("makes the URL a link and leaves the full stop as text", () => {
      expect(linkify({ text: "Open https://app.local/verify?a=1 to continue." })).toEqual([
        { kind: "text", value: "Open " },
        { kind: "link", value: "https://app.local/verify?a=1" },
        { kind: "text", value: " to continue." },
      ]);
    });

    /** @scenario "URLs in a plain-text body are links, not characters to copy" */
    it("trims the closing punctuation a sentence leaves on the URL", () => {
      expect(linkify({ text: "(see https://app.local/x)." })).toEqual([
        { kind: "text", value: "(see " },
        { kind: "link", value: "https://app.local/x" },
        { kind: "text", value: ")." },
      ]);
    });
  });

  describe("given a text body that contains markup", () => {
    /** @scenario "URLs in a plain-text body are links, not characters to copy" */
    it("keeps the markup as text", () => {
      expect(linkify({ text: "<script>alert(1)</script> and https://app.local/x" })).toEqual([
        { kind: "text", value: "<script>alert(1)</script> and " },
        { kind: "link", value: "https://app.local/x" },
      ]);
    });
  });
});
