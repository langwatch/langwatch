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

const LEVEL = { none: 0, read: 1, write: 2 } as const;

/**
 * Every `permissions:` map in a file, top-level and per job, merged to the highest level asked per
 * scope. Throws on a map it cannot read in full, so a stray line never reads as "asks for nothing".
 */
const requested = (text: string): Map<string, keyof typeof LEVEL> => {
  const asked = new Map<string, keyof typeof LEVEL>();
  const blocks = [...text.matchAll(/^( *)permissions:\n((?:\1 +.*\n|[ \t]*\n)*)/gm)];
  const keys = text.match(/^ *permissions:/gm)?.length ?? 0;
  assert.equal(blocks.length, keys, "a `permissions:` key is not followed by a map this can read");
  for (const [, , lines] of blocks) {
    for (const line of lines.split("\n")) {
      if (line.trim() === "" || line.trim().startsWith("#")) continue;
      const entry = /^\s+([a-z-]+): (none|read|write)$/.exec(line);
      assert.ok(entry, `unreadable line in a permissions map: ${line}`);
      const [, scope, level] = entry;
      const have = asked.get(scope) ?? "none";
      if (LEVEL[level as keyof typeof LEVEL] > LEVEL[have]) {
        asked.set(scope, level as keyof typeof LEVEL);
      }
    }
  }
  return asked;
};

/**
 * The jobs of nightly.yml that call a reusable workflow: job name -> called file and the job's own
 * grant.
 */
const calls = (
  text: string,
): { job: string; file: string; granted: Map<string, keyof typeof LEVEL> }[] => {
  const jobs = text.split(/^jobs:\n/m)[1] ?? "";
  return jobs.split(/^(?= {2}[\w-]+:\s*$)/m).flatMap((block) => {
    const file = /^ {4}uses: \.\/\.github\/workflows\/(.+)$/m.exec(block)?.[1];
    const job = /^ {2}([\w-]+):/m.exec(block)?.[1];
    if (!file || !job) return [];
    const own = /^ {4}permissions:\n((?: {6}.+\n)+)/m.exec(block)?.[0] ?? "";
    return [{ job, file, granted: requested(own.replace(/^ {4}/gm, "")) }];
  });
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

  void describe("when the permissions of each call are read", () => {
    /** @scenario "Each nightly call grants every permission its called workflow asks for" */
    void it("grants at least what the called workflow's jobs request", () => {
      const found = calls(nightly);
      assert.ok(found.length >= Object.keys(ABSORBED).length, "no calls found");
      for (const { job, file, granted } of found) {
        for (const [scope, level] of requested(read(file))) {
          const has = granted.get(scope) ?? "none";
          assert.ok(
            LEVEL[has] >= LEVEL[level],
            `${job} grants ${scope}: ${has} but ${file} requests ${scope}: ${level}`,
          );
        }
      }
    });
  });
});
