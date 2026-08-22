import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { dedupeNewestReleaseSection, newestReleaseCommitShas } from "./dedupe-release-notes.ts";

const sha = (value: string): string => value.repeat(40 / value.length);

const entry = (title: string, commit: string, pullRequest?: number): string => {
  const pullRequestLink = pullRequest
    ? ` ([#${pullRequest}](https://github.com/langwatch/langwatch/issues/${pullRequest}))`
    : "";
  return `* ${title}${pullRequestLink} ([${commit.slice(0, 7)}](https://github.com/langwatch/langwatch/commit/${commit}))`;
};

describe("dedupeNewestReleaseSection", () => {
  it("keeps the entry linked to the canonical squash subject PR", () => {
    const duplicate = sha("a");
    const content = [
      "# Changelog",
      "",
      "## [3.16.0] (2026-08-21)",
      "",
      "### Features",
      entry("body conventional commit", duplicate, 7346),
      entry("squash subject", duplicate, 7347),
      "",
      "## [3.15.0] (2026-08-01)",
      entry("historical entry", duplicate, 7000),
      "",
    ].join("\n");

    const result = dedupeNewestReleaseSection(content, { [duplicate]: 7347 });

    assert.match(result.content, /squash subject/);
    assert.doesNotMatch(result.content, /body conventional commit/);
    assert.match(result.content, /historical entry/);
    assert.deepEqual(result.removedCommitShas, [duplicate]);
  });

  it("prefers a PR-linked entry when the commit subject has no PR reference", () => {
    const duplicate = sha("b");
    const content = [
      "## [1.0.0] (2026-08-21)",
      entry("unlinked body", duplicate),
      entry("linked subject", duplicate, 42),
    ].join("\n");

    const result = dedupeNewestReleaseSection(content, {});

    assert.match(result.content, /linked subject/);
    assert.doesNotMatch(result.content, /unlinked body/);
  });

  it("is a no-op for unique entries and for a second run", () => {
    const one = sha("c");
    const two = sha("d");
    const content = [
      "# Changelog",
      "",
      "## [1.0.0] (2026-08-21)",
      entry("one", one, 1),
      entry("two", two, 2),
      "",
    ].join("\n");

    const first = dedupeNewestReleaseSection(content, {});
    const second = dedupeNewestReleaseSection(first.content, {});

    assert.equal(first.content, content);
    assert.equal(second.content, content);
    assert.deepEqual(newestReleaseCommitShas(content), [one, two]);
  });
});
