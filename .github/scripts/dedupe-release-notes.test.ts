import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";

import {
  dedupeNewestReleaseSection,
  newestReleaseCommitShas,
  subjectPullRequestsFor,
} from "./dedupe-release-notes.ts";

const sha = (value: string): string => value.repeat(40 / value.length);

const entry = ({
  title,
  commit,
  pullRequest,
}: {
  title: string;
  commit: string;
  pullRequest?: number;
}): string => {
  const pullRequestLink = pullRequest
    ? ` ([#${pullRequest}](https://github.com/langwatch/langwatch/issues/${pullRequest}))`
    : "";
  return `* ${title}${pullRequestLink} ([${commit.slice(0, 7)}](https://github.com/langwatch/langwatch/commit/${commit}))`;
};

describe("dedupeNewestReleaseSection", () => {
  /** @scenario "Duplicate commit entries leave one generated release note" */
  it("keeps the entry linked to the canonical squash subject PR", () => {
    const duplicate = sha("a");
    const content = [
      "# Changelog",
      "",
      "## [3.16.0] (2026-08-21)",
      "",
      "### Features",
      entry({ title: "body conventional commit", commit: duplicate, pullRequest: 7346 }),
      entry({ title: "squash subject", commit: duplicate, pullRequest: 7347 }),
      "",
      "## [3.15.0] (2026-08-01)",
      entry({ title: "historical entry", commit: duplicate, pullRequest: 7000 }),
      "",
    ].join("\n");

    const result = dedupeNewestReleaseSection({
      content,
      subjectPullRequests: { [duplicate]: 7347 },
    });

    assert.match(result.content, /squash subject/);
    assert.doesNotMatch(result.content, /body conventional commit/);
    assert.match(result.content, /historical entry/);
    assert.deepEqual(result.removedCommitShas, [duplicate]);
  });

  it("prefers a PR-linked entry when the commit subject has no PR reference", () => {
    const duplicate = sha("b");
    const content = [
      "## [1.0.0] (2026-08-21)",
      entry({ title: "unlinked body", commit: duplicate }),
      entry({ title: "linked subject", commit: duplicate, pullRequest: 42 }),
    ].join("\n");

    const result = dedupeNewestReleaseSection({ content, subjectPullRequests: {} });

    assert.match(result.content, /linked subject/);
    assert.doesNotMatch(result.content, /unlinked body/);
  });

  it("leaves unique entries unchanged", () => {
    const one = sha("c");
    const two = sha("d");
    const content = [
      "# Changelog",
      "",
      "## [1.0.0] (2026-08-21)",
      entry({ title: "one", commit: one, pullRequest: 1 }),
      entry({ title: "two", commit: two, pullRequest: 2 }),
      "",
    ].join("\n");

    const result = dedupeNewestReleaseSection({ content, subjectPullRequests: {} });

    assert.equal(result.content, content);
    assert.deepEqual(result.removedCommitShas, []);
    assert.deepEqual(newestReleaseCommitShas(content), [one, two]);
  });

  it("is idempotent after removing duplicate entries", () => {
    const duplicate = sha("e");
    const content = [
      "## [1.0.0] (2026-08-21)",
      entry({ title: "first generated entry", commit: duplicate }),
      entry({ title: "duplicate generated entry", commit: duplicate }),
    ].join("\n");

    const first = dedupeNewestReleaseSection({ content, subjectPullRequests: {} });
    const second = dedupeNewestReleaseSection({
      content: first.content,
      subjectPullRequests: {},
    });

    assert.doesNotMatch(first.content, /duplicate generated entry/);
    assert.deepEqual(first.removedCommitShas, [duplicate]);
    assert.equal(second.content, first.content);
    assert.deepEqual(second.removedCommitShas, []);
  });

  /** @scenario "Duplicate removal preserves following changelog sections" */
  it("preserves subsection headings after a removed entry", () => {
    const duplicate = sha("f");
    const other = sha("1");
    const content = [
      "## [1.0.0] (2026-08-21)",
      "### Features",
      entry({ title: "first generated entry", commit: duplicate }),
      entry({ title: "duplicate generated entry", commit: duplicate }),
      "### Fixes",
      entry({ title: "unrelated fix", commit: other }),
    ].join("\n");

    const result = dedupeNewestReleaseSection({ content, subjectPullRequests: {} });

    assert.match(result.content, /^### Fixes$/m);
    assert.match(result.content, /unrelated fix/);
    assert.doesNotMatch(result.content, /duplicate generated entry/);
  });

  /** @scenario "Incomplete changelogs remain unchanged" */
  it("keeps changelogs without a generated release section unchanged", () => {
    const content = "# Changelog\n\nNo releases have been generated yet.\n";

    const result = dedupeNewestReleaseSection({ content, subjectPullRequests: {} });

    assert.deepEqual(result, { content, removedCommitShas: [] });
  });

  /** @scenario "Incomplete changelogs remain unchanged" */
  it("skips entries without a commit SHA", () => {
    const commit = sha("2");
    const content = [
      "## [1.0.0] (2026-08-21)",
      "* Entry with a missing commit link",
      entry({ title: "valid entry", commit }),
    ].join("\n");

    const result = dedupeNewestReleaseSection({ content, subjectPullRequests: {} });

    assert.equal(result.content, content);
    assert.deepEqual(result.removedCommitShas, []);
    assert.deepEqual(newestReleaseCommitShas(content), [commit]);
  });
});

describe("subjectPullRequestsFor", () => {
  /** @scenario "An unavailable commit subject does not stop generated release notes" */
  it("skips an unavailable commit subject", () => {
    const missingCommit = sha("0");
    const existingCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const warnings: string[] = [];

    const result = subjectPullRequestsFor({
      commitShas: [missingCommit, existingCommit],
      cwd: process.cwd(),
      warn: (message) => warnings.push(message),
    });

    assert.equal(result[missingCommit], undefined);
    assert.ok(Object.hasOwn(result, existingCommit));
    assert.match(warnings[0]!, new RegExp(missingCommit));
  });
});
