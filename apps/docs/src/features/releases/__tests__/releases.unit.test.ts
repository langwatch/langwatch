import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { approximateTokens } from "../../../lib/page-tokens.ts";
import { pageMarkdown } from "../../discovery/compile.ts";
import { parseReleases, readReleases, withReleaseNotes } from "../compile/releases.ts";

const compare = "https://github.com/langwatch/langwatch/compare/v1...v2";
const source = `# Changelog
## [Unreleased]
* Not shipped
## [2.1.1](${compare}) (2026-10-02)
### Miscellaneous
* Review edits
### Bug Fixes
* **sso:** sign in with your organisation ([#42](https://github.com/langwatch/langwatch/issues/42))
## [2.1.0](${compare}) (2026-10-01)
### Features
* **traces:** inspect requests with {details}
## [2.0.0](${compare}) (2026-09-01)
### Features
* Older release
`;

describe("when a release note links both its pull request and its commit", () => {
  /** @scenario "Read release notes without repeated commit links" */
  it("keeps the pull request link and drops the commit link beside it", () => {
    const pr = "([#8755](https://github.com/langwatch/langwatch/issues/8755))";
    const commit =
      "([945bf9c](https://github.com/langwatch/langwatch/commit/945bf9cba5509b922149f148dd8ff7472cc5f16c))";
    const lone = "([36b234d](https://github.com/langwatch/langwatch/commit/36b234d9eb73))";
    const [entry] = parseReleases({
      source: `## [2.1.1](${compare}) (2026-10-02)\n### Bug Fixes\n* drawer closes ${pr} ${commit}\n* editor shows inputs ${lone}\n`,
    });
    expect(entry?.body).toContain(`* drawer closes ${pr}\n`);
    expect(entry?.body).not.toContain("945bf9c");
    expect(entry?.body).toContain(`* editor shows inputs ${lone}`);
  });
});

const leftOut = "## About this copy";

function changelogProject({ changelog }: { changelog: string }) {
  const project = mkdtempSync(path.join(os.tmpdir(), "docs-releases-budget-"));
  const docsRoot = path.join(project, "docs");
  mkdirSync(docsRoot);
  writeFileSync(path.join(project, "CHANGELOG.md"), changelog);
  writeFileSync(path.join(docsRoot, "docs.json"), "{}");
  writeFileSync(
    path.join(docsRoot, "changelog.mdx"),
    "---\ntitle: Changelog\n---\n<ReleaseNotes />\n\n## Older releases",
  );
  return { docsRoot, dispose: () => rmSync(project, { recursive: true, force: true }) };
}

describe("when the repository publishes release notes", () => {
  /** @scenario "Read published release notes" */
  it("selects the newest published versions with authored changes and stable anchors", () => {
    const entries = parseReleases({ source });
    expect(entries.map((entry) => entry.version)).toEqual(["2.1.1", "2.1.0", "2.0.0"]);
    expect(entries[0]).toMatchObject({
      date: "2026-10-02",
      label: "2 Oct 2026",
      summary: "Sign in with your organisation",
      href: "/changelog#release-v211",
      compare,
    });
    expect(entries[1]?.body).toContain("inspect requests with {details}");
  });

  /** @scenario "Read published release notes" */
  it("ignores unreleased, malformed and invalid-date entries without inventing an update", () => {
    expect(parseReleases({ source: "# Changelog\n## Unreleased\n* Not published" })).toEqual([]);
    expect(parseReleases({ source: `## [2.0.0](${compare}) (2026-02-30)\n* Bad date` })).toEqual(
      [],
    );
    expect(
      parseReleases({ source: `## [2.0.0](javascript:alert) (2026-02-01)\n* Unsafe URL` }),
    ).toEqual([]);
  });

  /** @scenario "Read published release notes" */
  it("adds notes only to the changelog while keeping its frontmatter and authored text", () => {
    const project = mkdtempSync(path.join(os.tmpdir(), "docs-releases-"));
    const docsRoot = path.join(project, "docs");
    mkdirSync(docsRoot);
    try {
      expect(readReleases({ docsRoot })).toEqual([]);
      writeFileSync(path.join(project, "CHANGELOG.md"), source);
      const policy = "---\ntitle: Changelog\n---\n## Versioning\nExisting policy";
      const enriched = withReleaseNotes({ source: policy, slug: "changelog", docsRoot });
      expect(enriched).toMatch(/^---\ntitle: Changelog\n---/);
      expect(enriched).toContain("## Release v2.1.1");
      expect(enriched).toContain("Released 2 Oct 2026");
      expect(enriched).toContain("inspect requests with &#123;details&#125;");
      expect(enriched).toContain("## Versioning\nExisting policy");
      expect(withReleaseNotes({ source: policy, slug: "guide", docsRoot })).toBe(policy);
      const placed = withReleaseNotes({
        source: "Intro\n\n<ReleaseNotes />\n\n## Older releases",
        slug: "changelog",
        docsRoot,
      });
      expect(placed.indexOf("Intro")).toBeLessThan(placed.indexOf("## Release v2.1.1"));
      expect(placed.indexOf("## Release v2.1.1")).toBeLessThan(placed.indexOf("## Older releases"));
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

describe("when the newest releases are longer than the page token budget", () => {
  const pageTokens = 2000;
  const note = "* **traces:** a long note\n";
  const notesOf = ({ share }: { share: number }) =>
    note.repeat(Math.ceil((pageTokens * 4 * share) / note.length));
  /** @scenario "Keep the changelog Markdown export within the page token budget" */
  it("exports the newest release and a note, while the page keeps every release", () => {
    const long = notesOf({ share: 2 / 3 });
    const { docsRoot, dispose } = changelogProject({
      changelog:
        `## [3.0.0](${compare}) (2026-11-02)\n### Features\n${long}` +
        `## [2.9.0](${compare}) (2026-10-21)\n### Features\n${long}` +
        `## [2.8.0](${compare}) (2026-10-01)\n### Features\n* Small fix\n`,
    });
    try {
      const markdown = pageMarkdown({
        docsRoot,
        slug: "changelog",
        pageTokens,
      });
      expect(approximateTokens({ text: markdown })).toBeLessThanOrEqual(pageTokens);
      expect(markdown).toContain("## Release v3.0.0");
      expect(markdown).not.toContain("## Release v2.9.0");
      expect(markdown).not.toContain("## Release v2.8.0");
      expect(markdown.indexOf("## Release v3.0.0")).toBeLessThan(markdown.indexOf(leftOut));
      expect(markdown.indexOf(leftOut)).toBeLessThan(markdown.indexOf("## Older releases"));

      const page = withReleaseNotes({
        source: readFileSync(path.join(docsRoot, "changelog.mdx"), "utf8"),
        slug: "changelog",
        docsRoot,
      });
      for (const version of ["3.0.0", "2.9.0", "2.8.0"])
        expect(page).toContain(`## Release v${version}`);
      expect(page).not.toContain(leftOut);
    } finally {
      dispose();
    }
  });

  /** @scenario "Keep the changelog Markdown export within the page token budget" */
  it("keeps no release, only the note, when the newest alone is over the budget", () => {
    const { docsRoot, dispose } = changelogProject({
      changelog:
        `## [3.0.0](${compare}) (2026-11-02)\n### Features\n${notesOf({ share: 1.2 })}` +
        `## [2.9.0](${compare}) (2026-10-21)\n### Features\n* Small fix\n`,
    });
    try {
      const markdown = pageMarkdown({
        docsRoot,
        slug: "changelog",
        pageTokens,
      });
      expect(markdown).not.toContain("## Release v");
      expect(markdown).toContain(leftOut);
      expect(markdown).toContain("repository CHANGELOG");
      expect(approximateTokens({ text: markdown })).toBeLessThanOrEqual(pageTokens);
    } finally {
      dispose();
    }
  });
});

describe("when only some of the older releases fit the page token budget", () => {
  const long = "* **traces:** a long note\n".repeat(200);
  const release = ({ version, day }: { version: string; day: string }) =>
    `## [${version}](${compare}) (2026-10-${day})\n### Features\n${long}`;
  const all =
    release({ version: "3.0.0", day: "21" }) +
    release({ version: "2.9.0", day: "11" }) +
    release({ version: "2.8.0", day: "01" });

  function exportOf({ changelog, pageTokens }: { changelog: string; pageTokens: number }) {
    const { docsRoot, dispose } = changelogProject({ changelog });
    try {
      return pageMarkdown({ docsRoot, slug: "changelog", pageTokens });
    } finally {
      dispose();
    }
  }
  const tokens = ({ text }: { text: string }) => approximateTokens({ text });

  /** @scenario "Keep the changelog Markdown export within the page token budget" */
  it("keeps the newest releases that fit and notes the rest are left out", () => {
    // One token under the untrimmed export: three releases cannot fit, while two plus the note do.
    const twoFit = tokens({ text: exportOf({ changelog: all, pageTokens: Infinity }) }) - 1;
    const markdown = exportOf({ changelog: all, pageTokens: twoFit });
    expect(markdown).toContain("## Release v3.0.0");
    expect(markdown).toContain("## Release v2.9.0");
    expect(markdown).not.toContain("## Release v2.8.0");
    expect(markdown).toContain(leftOut);
    expect(tokens({ text: markdown })).toBeLessThanOrEqual(twoFit);
  });

  /** @scenario "Keep the changelog Markdown export within the page token budget" */
  it("keeps every release and adds no note when they all fit", () => {
    const markdown = exportOf({
      changelog: all,
      pageTokens: tokens({ text: exportOf({ changelog: all, pageTokens: Infinity }) }),
    });
    for (const version of ["3.0.0", "2.9.0", "2.8.0"])
      expect(markdown).toContain(`## Release v${version}`);
    expect(markdown).not.toContain(leftOut);
  });

  /** @scenario "Keep the changelog Markdown export within the page token budget" */
  it("keeps every release and adds no note when the caller sets no budget", () => {
    const { docsRoot, dispose } = changelogProject({ changelog: all });
    try {
      const markdown = pageMarkdown({ docsRoot, slug: "changelog" });
      for (const version of ["3.0.0", "2.9.0", "2.8.0"])
        expect(markdown).toContain(`## Release v${version}`);
      expect(markdown).not.toContain(leftOut);
    } finally {
      dispose();
    }
  });
});

describe("when a page asks for the latest releases", () => {
  /** @scenario "Show what is new on the home page" */
  it("lists the newest releases with version, date and summary, linking to the changelog", () => {
    const project = mkdtempSync(path.join(os.tmpdir(), "docs-whats-new-"));
    const docsRoot = path.join(project, "docs");
    mkdirSync(docsRoot);
    try {
      const page = "## Quick Start\n\n<WhatsNew />\n\n## What is LangWatch?";
      expect(withReleaseNotes({ source: page, slug: "introduction", docsRoot })).not.toContain(
        "WhatsNew",
      );
      writeFileSync(path.join(project, "CHANGELOG.md"), source);
      const home = withReleaseNotes({ source: page, slug: "introduction", docsRoot });
      expect(home).toContain("## What’s new");
      expect(home).toContain(
        "- [v2.1.1](/changelog#release-v211) 2 Oct 2026: Sign in with your organisation",
      );
      expect(home).toContain(
        "[v2.1.0](/changelog#release-v210) 1 Oct 2026: Inspect requests with &#123;details&#125;",
      );
      expect(home).toContain("[Read the changelog](/changelog)");
      expect(home).toMatch(/## Quick Start[\s\S]*What’s new[\s\S]*## What is LangWatch\?/);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
