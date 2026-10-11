import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { docsFixture } from "../../testing/docs-fixture.ts";
import { checkLinks } from "../link-check.ts";

describe("when built pages contain local links and redirects", () => {
  /** @scenario "Detect broken local links and fragments" */
  it("reports broken targets and anchors without flagging valid links", () => {
    const fixture = docsFixture({ config: {} });
    try {
      mkdirSync(path.join(fixture.docsRoot, "guide"));
      writeFileSync(
        path.join(fixture.docsRoot, "redirects.json"),
        JSON.stringify({ "/old": "/guide#install" }),
      );
      writeFileSync(
        path.join(fixture.docsRoot, "guide/index.html"),
        '<h1 id="install">Install</h1>',
      );
      writeFileSync(
        path.join(fixture.docsRoot, "index.html"),
        '<a href="/old?from=home">Old</a><a href="/guide#install">Guide</a><a href="/guide#absent">Anchor</a><a href="/missing">Missing</a><a href="/missing.pdf">File</a><a href="https://example.com/page">External</a>',
      );
      const report = checkLinks({ outDir: fixture.docsRoot });
      expect(report.pages).toBe(2);
      expect(report.issues).toEqual([
        { source: "/", href: "/guide#absent", code: "missing-fragment" },
        { source: "/", href: "/missing", code: "missing-target" },
        { source: "/", href: "/missing.pdf", code: "missing-target" },
      ]);
    } finally {
      fixture.dispose();
    }
  });
});
