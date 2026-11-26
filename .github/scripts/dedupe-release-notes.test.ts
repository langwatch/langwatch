import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, describe, it } from "node:test";

import { dedupeChangelog, extractPrNumbers, extractSha } from "./dedupe-release-notes.ts";

const scriptPath = resolve(import.meta.dirname, "dedupe-release-notes.ts");

after(() => {
  rmSync(join(tmpdir(), "dedupe-release-notes-tests"), {
    recursive: true,
    force: true,
  });
});

const tempDir = (): string => {
  const root = join(tmpdir(), "dedupe-release-notes-tests");
  mkdirSync(root, { recursive: true });
  return mkdtempSync(join(root, "case-"));
};

// The pairs below mirror the shapes #7206 diagnosed in the released 3.16.0
// section: a body-derived entry without a pull-request link beside its
// subject-derived twin, and one commit whose body names a different pull
// request than the subject that merged it.
const bodyEntry = (text: string, sha: string): string =>
  `* ${text} ([${sha.slice(0, 7)}](https://github.com/langwatch/langwatch/commit/${sha}))\n`;

const subjectEntry = (text: string, pr: number, sha: string): string =>
  `* ${text} ([#${pr}](https://github.com/langwatch/langwatch/issues/${pr})) ([${sha.slice(0, 7)}](https://github.com/langwatch/langwatch/commit/${sha}))\n`;

void describe("dedupe-release-notes", () => {
  describe("when extracting identifiers from an entry", () => {
    it("reads the full sha out of the trailing commit link", () => {
      const line = subjectEntry("a fix", 7186, "fadc6321ddc9846a1208048b2c05994020b65a7c");
      assert.equal(extractSha(line), "fadc6321ddc9846a1208048b2c05994020b65a7c");
    });

    it("reads the trailing commit link, not a commit linked in the note text", () => {
      const sha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
      const line = subjectEntry(
        "reverts [aaaaaaa](https://github.com/langwatch/langwatch/commit/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa)",
        7186,
        sha,
      );
      assert.equal(extractSha(line), sha);
    });

    it("reads every pull-request link in the entry", () => {
      const line = subjectEntry("a fix", 7186, "fadc6321ddc9846a1208048b2c05994020b65a7c");
      assert.deepEqual(extractPrNumbers(line), [7186]);
    });

    it("answers nothing for an entry without links", () => {
      assert.equal(extractSha("* a note without links\n"), null);
      assert.deepEqual(extractPrNumbers("* a note without links\n"), []);
    });
  });

  describe("when two entries carry one sha and only one links a pull request", () => {
    const content = [
      "# Changelog\n",
      "## [3.16.0](https://github.com/langwatch/langwatch/compare/langwatch@v3.15.0...langwatch@v3.16.0) (2026-08-21)\n",
      "\n",
      "### Bug Fixes\n",
      "\n",
      bodyEntry(
        "**clickhouse:** size the statement bound from the cluster, not one node",
        "fadc6321ddc9846a1208048b2c05994020b65a7c",
      ),
      subjectEntry(
        "**clickhouse:** size the statement bound from the whole cluster, not one node",
        7186,
        "fadc6321ddc9846a1208048b2c05994020b65a7c",
      ),
    ].join("");

    /** @scenario "Two entries naming one sha keep the one carrying a pull-request link" */
    it("keeps the pull-request-linked entry and drops the other", async () => {
      const deduped = await dedupeChangelog(content);
      assert.match(deduped, /whole cluster.*#7186/);
      assert.doesNotMatch(
        deduped,
        /size the statement bound from the cluster, not one node \(\[fadc632/,
      );
      assert.equal(deduped.split("\n").length, content.split("\n").length - 1);
    });
  });

  describe("when two entries carry one sha and name two different pull requests", () => {
    const sha = "2afcf8a7f94486dcae55f6b26883139f6c586582";
    const content = [
      "## [3.16.0](https://github.com/langwatch/langwatch/compare/langwatch@v3.15.0...langwatch@v3.16.0) (2026-08-21)\n",
      "\n",
      "### Bug Fixes\n",
      "\n",
      subjectEntry("**governance:** a walk id keeps the pager latest", 7346, sha),
      subjectEntry("**governance:** a walk id keeps the events pager latest", 7347, sha),
    ].join("");

    /** @scenario "Two entries naming one sha and two pull requests keep the merged one" */
    it("keeps the entry GitHub says the commit merged", async () => {
      const deduped = await dedupeChangelog(content, {
        resolveMergedPrs: async (asked) => (asked === sha ? [7347] : []),
      });
      assert.match(deduped, /#7347/);
      assert.doesNotMatch(deduped, /#7346/);
    });

    it("keeps a pull-request-linked entry when GitHub answers nothing", async () => {
      const deduped = await dedupeChangelog(content, {
        resolveMergedPrs: async () => [],
      });
      assert.equal(
        extractSha(
          deduped.split("\n").find((l) => l.startsWith("* ") && l.includes(sha.slice(0, 7))) ?? "",
        ),
        sha,
      );
      assert.equal(deduped.split("\n").filter((l) => l.includes(sha.slice(0, 7))).length, 1);
    });
  });

  describe("when every entry names a distinct sha", () => {
    const content = [
      "### Features\n",
      "\n",
      subjectEntry("**authz:** one entry", 7151, "4f791c7dc6ed88214b0e083f44f2f6ee21973b09"),
      subjectEntry("**gateway:** another entry", 6420, "7dcd14d9389824c6a114d333ecdec1ad364ff873"),
    ].join("");

    /** @scenario "Entries without a duplicate are left untouched" */
    it("returns the content unchanged", async () => {
      assert.equal(await dedupeChangelog(content), content);
    });
  });

  describe("when the same sha appears in two different sections", () => {
    it("keeps one entry per section rather than collapsing across versions", async () => {
      const sha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      const section = (version: string) =>
        [
          `## [${version}] compare-link\n`,
          "\n",
          subjectEntry("**governance:** the same change", 7000, sha),
          bodyEntry("**governance:** the same change again", sha),
        ].join("");
      const content = `${section("3.16.0")}\n${section("3.15.0")}`;

      const deduped = await dedupeChangelog(content);
      assert.equal([...deduped.matchAll(new RegExp(`/commit/${sha.slice(0, 7)}`, "g"))].length, 2);
      assert.ok(!deduped.includes("the same change again"));
    });
  });

  describe("when lines that are not bullets link a commit", () => {
    const sha = "c3735278a84624fc4e4624b709c740a78ad806ba";
    const commitLink = `([c373527](https://github.com/langwatch/langwatch/commit/${sha}))`;
    const content = [
      "## [3.16.0](https://github.com/langwatch/langwatch/compare/langwatch@v3.15.0...langwatch@v3.16.0) (2026-08-21)\n",
      "\n",
      "### ⚠ BREAKING CHANGES\n",
      "\n",
      `See the storage note in ${commitLink}\n`,
      `See the storage note in ${commitLink}\n`,
      "\n",
      "### Bug Fixes\n",
      "\n",
      `  continued from the entry above ${commitLink}\n`,
      subjectEntry("**charts:** serialize stored-objects PVC consumers", 7196, sha),
    ].join("");

    /** @scenario "Lines that are not release-note bullets are never removed" */
    it("leaves every line in place", async () => {
      assert.equal(await dedupeChangelog(content), content);
    });

    it("reads no sha from a line that is not a bullet", () => {
      assert.equal(extractSha(`See the storage note in ${commitLink}`), null);
      assert.equal(extractSha(`- a formatted bullet ${commitLink}`), sha);
    });
  });

  describe("when asking GitHub which pull request merged the commit fails", () => {
    const sha = "fadc6321ddc9846a1208048b2c05994020b65a7c";
    const content = [
      "## [3.16.0](https://github.com/langwatch/langwatch/compare/langwatch@v3.15.0...langwatch@v3.16.0) (2026-08-21)\n",
      "\n",
      bodyEntry("**clickhouse:** size the statement bound from the cluster, not one node", sha),
      subjectEntry(
        "**clickhouse:** size the statement bound from the whole cluster, not one node",
        7186,
        sha,
      ),
    ].join("");

    /** @scenario "A failed pull-request lookup falls back to the linked entry" */
    it("still succeeds through the CLI and keeps the pull-request-linked entry", () => {
      const dir = tempDir();
      const file = join(dir, "CHANGELOG.md");
      writeFileSync(file, content);

      // Credentials are set, so the CLI asks GitHub; the preloaded fetch rejects every call.
      const result = spawnSync(
        process.execPath,
        [
          "--experimental-strip-types",
          "--import",
          `data:text/javascript,globalThis.fetch=()=>Promise.reject(new Error("connection refused"))`,
          scriptPath,
          file,
        ],
        {
          env: {
            ...process.env,
            GITHUB_TOKEN: "test-token",
            GITHUB_REPOSITORY: "langwatch/langwatch",
          },
        },
      );
      assert.equal(result.status, 0, result.stderr.toString());
      const after = readFileSync(file, "utf8");
      assert.ok(after.includes("#7186"));
      assert.ok(!after.includes("from the cluster, not one node"));
    });
  });

  describe("when run over a changelog file through the CLI", () => {
    const unduplicated =
      "* **ops:** per-migration enrollment on the migrations page ([#7304](https://github.com/langwatch/langwatch/issues/7304)) ([bc515e5](https://github.com/langwatch/langwatch/commit/bc515e528c3bb61cbc188f9accf9629d5ab194))\n";
    const heading =
      "## [3.16.0](https://github.com/langwatch/langwatch/compare/langwatch@v3.15.0...langwatch@v3.16.0) (2026-08-21)\n";
    const duplicatedPair = [
      bodyEntry(
        "**clickhouse:** size the statement bound from the cluster, not one node",
        "fadc6321ddc9846a1208048b2c05994020b65a7c",
      ),
      subjectEntry(
        "**clickhouse:** size the statement bound from the whole cluster, not one node",
        7186,
        "fadc6321ddc9846a1208048b2c05994020b65a7c",
      ),
    ];

    /** @scenario "A whole changelog is rewritten only where it duplicates" */
    it("removes exactly the duplicate lines in every section and preserves every other byte", async () => {
      const dir = tempDir();
      const file = join(dir, "CHANGELOG.md");
      const olderHeading =
        "## [3.15.0](https://github.com/langwatch/langwatch/compare/langwatch@v3.14.0...langwatch@v3.15.0) (2026-08-19)\n";
      const olderSha = "13b40a8509a3eafbb49449fc58d1227f3359cccb";
      const olderKeeper = subjectEntry(
        "**cli:** create the HTTP agent on the spot",
        7156,
        olderSha,
      );
      const olderDuplicate = bodyEntry("**cli:** create the agent when none exists", olderSha);
      const newer = `${heading}\n### Features\n\n${unduplicated}${duplicatedPair.join("")}`;
      const older = `${olderHeading}\n### Features\n\n${olderDuplicate}${olderKeeper}`;
      writeFileSync(file, `# Changelog\n\n${newer}\n${older}`);

      const result = spawnSync(process.execPath, ["--experimental-strip-types", scriptPath, file]);
      assert.equal(result.status, 0, result.stderr.toString());

      const after = readFileSync(file, "utf8");
      const expected = `# Changelog\n\n${heading}\n### Features\n\n${unduplicated}${duplicatedPair[1]}\n${olderHeading}\n### Features\n\n${olderKeeper}`;
      assert.equal(after, expected);
    });

    it("reports a clean changelog without rewriting the file", async () => {
      const dir = tempDir();
      const file = join(dir, "CHANGELOG.md");
      const original = heading + unduplicated;
      writeFileSync(file, original);

      const result = spawnSync(process.execPath, ["--experimental-strip-types", scriptPath, file]);
      assert.equal(result.status, 0, result.stderr.toString());
      assert.match(result.stdout.toString(), /no duplicate entries/);
      assert.equal(readFileSync(file, "utf8"), original);
    });
  });

  describe("when the release workflow runs the pass", () => {
    const workflow = readFileSync(
      resolve(import.meta.dirname, "..", "workflows", "release-please-sdks.yml"),
      "utf8",
    );
    const job = /^ {2}dedupe-release-notes:\n((?: {4}.*\n|\s*\n)+)/m.exec(workflow)?.[1] ?? "";

    /** @scenario "The release workflow checks out the repository before deduplicating" */
    it("checks out with the release token before the dedupe step", () => {
      assert.ok(job, "release-please-sdks.yml has no dedupe-release-notes job");
      const checkout = job.indexOf("uses: actions/checkout@");
      const dedupe = job.indexOf("run: bash .github/scripts/dedupe-release-notes.sh");
      assert.ok(checkout >= 0, "the dedupe job never checks out the repository");
      assert.ok(dedupe > checkout, "the dedupe step runs before the checkout");
      assert.match(job.slice(checkout, dedupe), /token: \$\{\{ secrets\.RELEASE_PLEASE_TOKEN \}\}/);
    });

    it("runs after the manifest stamp, even when the stamp is skipped", () => {
      assert.match(job, /needs: \[release-please, stamp-release-manifest\]/);
      assert.match(
        job,
        /if: \$\{\{ !cancelled\(\) && needs\.release-please\.result == 'success' \}\}/,
      );
    });
  });
});
