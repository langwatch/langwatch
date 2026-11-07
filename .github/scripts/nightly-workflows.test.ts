// What the nightly suite's workflow files promise about when they run and what
// they may cancel. Line-based, like the other guards here: the CI scripts job
// installs nothing, so there is no YAML library to lean on.
// Spec: specs/ci/nightly-suite.feature

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const workflows = join(import.meta.dirname, "..", "workflows");
const read = (name: string): string => readFileSync(join(workflows, name), "utf8");

/** The keys directly under the top-level `on:`, two spaces in. */
const triggers = (text: string): string[] => {
  const block = /^on:\n((?:(?: {2}.*|\s*)\n)+)/m.exec(text)?.[1] ?? "";
  return [...block.matchAll(/^ {2}([a-z_]+):/gm)].map((match) => match[1]);
};

const ABSORBED: Record<string, string[]> = {
  "codebase-health.yml": ["workflow_dispatch"],
  "migration-compat.yml": ["pull_request", "workflow_dispatch"],
  "npx-server-smoke.yml": ["workflow_dispatch", "push"],
  "gateway-matrix.yaml": ["workflow_dispatch", "pull_request"],
};

void describe("given the nightly workflow", () => {
  const nightly = read("nightly.yml");

  void describe("when its triggers are read", () => {
    /** @scenario "The nightly starts at 01:00 UTC and can be started by hand" */
    void it("is scheduled at 01:00 UTC and can be dispatched", () => {
      assert.deepEqual(triggers(nightly).toSorted(), ["schedule", "workflow_dispatch"]);
      assert.match(nightly, /^ {4}- cron: "0 1 \* \* \*"$/m);
    });
  });

  void describe("when the workflows it absorbed are read", () => {
    /** @scenario "The older nightly workflows run inside it and no longer schedule themselves" */
    void it("calls each, none schedules itself, and each keeps its other triggers", () => {
      for (const [name, kept] of Object.entries(ABSORBED)) {
        const own = triggers(read(name));
        assert.ok(own.includes("workflow_call"), `${name} is not reusable`);
        assert.ok(!own.includes("schedule"), `${name} still schedules itself`);
        for (const trigger of kept) assert.ok(own.includes(trigger), `${name} lost ${trigger}`);
        assert.match(
          nightly,
          new RegExp(`uses: \\./\\.github/workflows/${name.replace(".", "\\.")}$`, "m"),
        );
      }
    });
  });

  void describe("when the concurrency settings are read", () => {
    /** @scenario "A nightly run never cancels another run" */
    void it("has no cancelling group, and a called one cancels only for a pull request or push", () => {
      assert.doesNotMatch(nightly, /^concurrency:/m);
      assert.doesNotMatch(nightly, /cancel-in-progress: true/);
      for (const name of Object.keys(ABSORBED)) {
        const setting = /^ {2}cancel-in-progress: (.+)$/m.exec(read(name))?.[1] ?? "false";
        const onlyForPullRequestsOrPushes =
          setting === "false" || /github\.event_name == '(pull_request|push)'/.test(setting);
        assert.ok(onlyForPullRequestsOrPushes, `${name} cancels with ${setting}`);
      }
    });
  });
});

/** One job's block of a workflow: from its key, two spaces in, to the next job's. */
const jobBlock = (text: string, job: string): string =>
  new RegExp(`^ {2}${job}:\\n((?:(?: {3,}.*|\\s*)\\n)+)`, "m").exec(text)?.[1] ?? "";

void describe("given the nightly flaky-test hunt", () => {
  const hunt = jobBlock(read("nightly.yml"), "flaky-hunt");

  void describe("when its legs are read", () => {
    /** @scenario "The nightly flaky-test hunt runs browser suites on a leg of their own" */
    void it("runs the numbered shards without browser suites and one browser leg per run", () => {
      const shards = /^ {8}shard: \[([\d, ]+)\]$/m.exec(hunt)?.[1].split(",") ?? [];
      const runs = /^ {8}run: \[([\d, ]+)\]$/m.exec(hunt)?.[1].split(",").map(Number) ?? [];
      assert.ok(shards.length > 1, "the hunt lists no shards");
      assert.match(hunt, new RegExp(`^ {8}total: \\[${shards.length}\\]$`, "m"));
      assert.match(hunt, /^ {8}lanes: \[no-browser\]$/m);
      const browserRuns = [
        ...hunt.matchAll(/^ {10}- shard: browser\n {12}lanes: browser\n {12}run: (\d+)$/gm),
      ].map((match) => Number(match[1]));
      assert.deepEqual(browserRuns.toSorted(), runs.toSorted(), "one browser leg per run index");
      assert.match(hunt, /^ {10}PACKAGE_SUITES_LANES: \$\{\{ matrix\.lanes \}\}$/m);
      assert.match(
        hunt,
        /^ {10}PACKAGE_SUITES_SHARD: \$\{\{ matrix\.lanes != 'browser' && format\('\{0\}\/\{1\}', matrix\.shard, matrix\.total\) \|\| '' \}\}$/m,
      );
      assert.match(
        hunt,
        /^ {10}name: flaky-results-\$\{\{ matrix\.shard \}\}-\$\{\{ matrix\.run \}\}$/m,
      );
    });
  });
});
