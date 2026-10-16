import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

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

describe("when the repository publishes release notes", () => {
  /** @scenario "Read published release notes" */
  it("selects the newest two published versions with authored changes and stable anchors", () => {
    const entries = parseReleases({ source });
    expect(entries.map((entry) => entry.version)).toEqual(["2.1.1", "2.1.0"]);
    expect(entries[0]).toMatchObject({
      date: "2026-10-02",
      label: "2 Oct 2026",
      summary: "Sign in with your organisation",
      href: "/self-hosting/releases#release-v211",
      compare,
    });
    expect(entries[1].body).toContain("inspect requests with {details}");
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
  it("adds notes only to the release page while keeping its frontmatter and support policy", () => {
    const project = mkdtempSync(path.join(os.tmpdir(), "docs-releases-"));
    const docsRoot = path.join(project, "docs");
    mkdirSync(docsRoot);
    try {
      expect(readReleases({ docsRoot })).toEqual([]);
      writeFileSync(path.join(project, "CHANGELOG.md"), source);
      const policy = "---\ntitle: Releases and support\n---\n## Versioning\nExisting policy";
      const enriched = withReleaseNotes({
        source: policy,
        slug: "self-hosting/releases",
        docsRoot,
      });
      expect(enriched).toMatch(/^---\ntitle: Releases and support\n---/);
      expect(enriched).toContain("## Release v2.1.1");
      expect(enriched).toContain("Released 2 Oct 2026");
      expect(enriched).toContain("inspect requests with &#123;details&#125;");
      expect(enriched).toContain("## Versioning\nExisting policy");
      expect(enriched).not.toContain("Older release");
      expect(withReleaseNotes({ source: policy, slug: "guide", docsRoot })).toBe(policy);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
