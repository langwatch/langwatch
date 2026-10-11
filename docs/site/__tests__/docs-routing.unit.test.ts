import { describe, expect, it } from "vitest";

import { readRedirects, resolveRedirect } from "../docs-routing.mjs";
import { docsFixture } from "./docs.fixture.ts";

describe("when redirects have destination queries and fragments", () => {
  /** @scenario "Preserve redirect queries and destination fragments" */
  it("preserves incoming parameters without overwriting destination values", () => {
    const fixture = docsFixture({
      config: {
        redirects: [
          { source: "/old/", destination: "/guide?view=new#install" },
          { source: "/external", destination: "https://example.com/help#start" },
        ],
      },
    });
    try {
      const redirects = readRedirects({ docsRoot: fixture.docsRoot });
      expect(
        resolveRedirect({ pathname: "/old/", search: "?view=old&from=search", redirects }),
      ).toBe("/guide?view=new&from=search#install");
      expect(
        resolveRedirect({ pathname: "/external", search: "?q=hello%20world", redirects }),
      ).toBe("https://example.com/help?q=hello+world#start");
      expect(resolveRedirect({ pathname: "/unknown", search: "", redirects })).toBeNull();
    } finally {
      fixture.dispose();
    }
  });
});
