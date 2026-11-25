// When release-please refreshes the release pull requests. Line-based, like
// nightly-workflows.test.ts: the CI scripts job installs no YAML library.
// Spec: specs/ci/release-pr-refresh.feature

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const workflow = readFileSync(
  join(import.meta.dirname, "..", "workflows", "release-please-sdks.yml"),
  "utf8",
);

const triggers = [
  ...(/^on:\n((?:(?: {2}.*|\s*)\n)+)/m.exec(workflow)?.[1] ?? "").matchAll(/^ {2}([a-z_]+):/gm),
].map((match) => match[1]);

/** The release-please job's `if:`, evaluated for a push with this commit title. */
const runsOnPush = (title: string): boolean => {
  const condition = /^ {2}release-please:\n {4}if: "(.+)"$/m.exec(workflow)?.[1];
  assert.ok(condition, "release-please job has no if:");
  const prefix = /startsWith\(github\.event\.head_commit\.message, '(.+?)'\)/.exec(condition)?.[1];
  assert.ok(prefix, "the if: does not check the commit title");
  assert.match(condition, /^github\.event_name != 'push' \|\| startsWith/);
  return title.startsWith(prefix);
};

void describe("given the release-please workflow", () => {
  void describe("when its triggers are read", () => {
    /** @scenario "Release pull requests refresh every 4 hours and can be refreshed by hand" */
    void it("is scheduled every 4 hours and can be dispatched", () => {
      assert.deepEqual(triggers.toSorted(), ["push", "schedule", "workflow_dispatch"]);
      assert.match(workflow, /^ {4}- cron: "\d+ \*\/4 \* \* \*"$/m);
    });
  });

  void describe("when a merge to main starts it", () => {
    /** @scenario "A merge to main does not refresh the release pull requests" */
    void it("skips release-please for an ordinary merge", () => {
      assert.equal(runsOnPush("fix(trace): keep a search to its project (#8990)"), false);
    });

    /** @scenario "Merging a release pull request publishes the release at once" */
    void it("runs release-please for a merged release pull request", () => {
      assert.equal(runsOnPush("chore(main): release langwatch 3.22.0 (#8951)"), true);
    });
  });
});
