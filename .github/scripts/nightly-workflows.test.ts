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
