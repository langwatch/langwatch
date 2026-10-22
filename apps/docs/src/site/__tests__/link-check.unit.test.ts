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

  /** @scenario "Build the documentation under a base path" */
  it("checks a /docs build against its mount and flags links that escape it", () => {
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
        '<link rel="canonical" href="https://langwatch.ai/docs/guide"><a href="https://langwatch.ai/docs/gone">Public</a><a href="/docs/old">Old</a><a href="/docs/guide#install">Guide</a><a href="guide">Relative</a><a href="/guide">Unprefixed</a><a href="/docs/missing">Missing</a>' +
          '<video src="/media/x.mp4" poster="/docs/media/x.jpg"></video><img src="https://cdn.example/a.png" srcset="/docs/a-1.webp 1x, /images/a-2.webp 2x">',
      );
      const report = checkLinks({ outDir: fixture.docsRoot, basePath: "/docs" });
      expect(report.issues).toEqual([
        { source: "/", href: "/media/x.mp4", code: "outside-base-path" },
        { source: "/", href: "/images/a-2.webp", code: "outside-base-path" },
        { source: "/", href: "https://langwatch.ai/docs/gone", code: "missing-target" },
        { source: "/", href: "/guide", code: "outside-base-path" },
        { source: "/", href: "/docs/missing", code: "missing-target" },
      ]);
    } finally {
      fixture.dispose();
    }
  });
});

describe("when a page names a skill prompt fragment", () => {
  /** @scenario "Ship a skill prompt's rendered body as its own fragment" */
  it("checks the fragment's links against the page and never as a page of its own", () => {
    const fixture = docsFixture({ config: {} });
    try {
      mkdirSync(path.join(fixture.docsRoot, "assets"));
      writeFileSync(path.join(fixture.docsRoot, "redirects.json"), "{}");
      writeFileSync(
        path.join(fixture.docsRoot, "assets/skill-prompt-0123456789abcdef.html"),
        '<h2 id="step">Step</h2><a href="#intro">Intro</a><a href="#elsewhere">Gone</a>',
      );
      writeFileSync(
        path.join(fixture.docsRoot, "index.html"),
        '<h1 id="intro">Intro</h1><a href="#step">Step</a><details><div data-docs-prompt-fragment="/assets/skill-prompt-0123456789abcdef.html"></div></details>',
      );
      const report = checkLinks({ outDir: fixture.docsRoot });
      expect(report.pages).toBe(1);
      expect(report.issues).toEqual([
        { source: "/", href: "#elsewhere", code: "missing-fragment" },
      ]);
    } finally {
      fixture.dispose();
    }
  });
});
