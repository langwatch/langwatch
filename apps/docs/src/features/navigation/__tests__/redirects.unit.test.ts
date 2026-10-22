import { describe, expect, it } from "vitest";

import { docsFixture } from "../../../testing/docs-fixture.ts";
import {
  isStaticRedirect,
  readRedirects,
  redirectPage,
  redirectTarget,
  resolveRedirect,
} from "../compile/redirects.ts";
import { matchRedirect } from "../model/redirect-match.ts";

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

describe("when the site is published to a host without redirect rules", () => {
  /** @scenario "Serve every configured redirect from a static page" */
  it("publishes a no-JavaScript redirect page for each exact source", () => {
    const html = redirectPage({ destination: "/guide?view=new&from=old#install" });
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toContain(
      '<meta http-equiv="refresh" content="0; url=/guide?view=new&amp;from=old#install">',
    );
    expect(html).toContain(
      '<link rel="canonical" href="https://langwatch.ai/docs/guide?view=new&amp;from=old#install">',
    );
    expect(html).toContain('<a href="/guide?view=new&amp;from=old#install">');
    expect(redirectTarget({ source: "/old/page" })).toBe("old/page/index.html");
    expect(isStaticRedirect({ source: "/old/page" })).toBe(true);
    expect(isStaticRedirect({ source: "/guardrails/:path*" })).toBe(false);
  });
});

describe("when a redirect source is a pattern", () => {
  const redirects = {
    "/guardrails/:path*": "/evaluations/guardrails/overview",
    "/old/:section/page": "/new/:section",
    "/langevals/:path*": "https://github.com/langwatch/langevals",
    "/exact": "/exact-target",
  };

  /** @scenario "Serve every configured redirect from a static page" */
  it("matches parameters and wildcards, and an exact source wins", () => {
    expect(matchRedirect({ path: "/guardrails/a/b", redirects })).toBe(
      "/evaluations/guardrails/overview",
    );
    expect(matchRedirect({ path: "/guardrails", redirects })).toBe(
      "/evaluations/guardrails/overview",
    );
    expect(matchRedirect({ path: "/old/tracing/page", redirects })).toBe("/new/tracing");
    expect(matchRedirect({ path: "/old/tracing/other", redirects })).toBeNull();
    expect(matchRedirect({ path: "/langevals/x", redirects })).toBe(
      "https://github.com/langwatch/langevals",
    );
    expect(matchRedirect({ path: "/exact/", redirects })).toBe("/exact-target");
    expect(resolveRedirect({ pathname: "/guardrails/x", search: "?a=1", redirects })).toBe(
      "/evaluations/guardrails/overview?a=1",
    );
  });
});
