// pr.yml and the product checks it calls. Line-based, like the other guards
// here: the CI scripts job installs no YAML library.
// Spec: specs/ci/one-pull-request-workflow.feature

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { gateFilters } from "./guard-path-filters.ts";
import { ALWAYS, CALLED, buildFilters } from "./pr-workflow-filters.ts";

const workflows = join(import.meta.dirname, "..", "workflows");
const read = (name: string): string => readFileSync(join(workflows, name), "utf8");
const pr = read("pr.yml");

/** The keys directly under the top-level `on:`, two spaces in. */
const triggers = (text: string): string[] => {
  const block = /^on:\n((?:(?: {2}.*|\s*)\n)+)/m.exec(text)?.[1] ?? "";
  return [...block.matchAll(/^ {2}([a-z_]+):/gm)].map((match) => match[1]!);
};

/** The checks main requires, by the ruleset and classic protection (2026-10-23). */
const REQUIRED = [
  "langwatch-app-complete",
  "typecheck",
  "build",
  "e2e-complete",
  "langwatch-nlp-complete",
  "langevals-complete",
  "mcp-javascript-complete",
  "sdk-go-complete",
  "sdk-javascript-complete",
  "docs-complete",
  "codeql-complete",
  "clickhouse-serverless-complete",
];

void describe("given pr.yml's filter", () => {
  const filters = buildFilters(read);

  /** @scenario "Each product check starts only when a change reaches its own paths" */
  void it("holds every path each check's detect-changes step consults, and pr.yml's own", () => {
    for (const [key, file] of Object.entries(CALLED)) {
      const block = new RegExp(`^${key}:\\n((?:  - .*\\n?)+)`, "m").exec(filters)?.[1] ?? "";
      const entries = [...block.matchAll(/^ {2}- '(.+)'$/gm)].map((match) => match[1]);
      const gate = gateFilters(read(file), true);
      assert.equal(gate.kind, "filtered", `${file} has no readable filter`);
      for (const path of gate.kind === "filtered" ? gate.entries : []) {
        assert.ok(entries.includes(path), `${key} misses ${path}`);
      }
      for (const path of ALWAYS) assert.ok(entries.includes(path), `${key} misses ${path}`);
    }
  });
});

void describe("given the product checks pr.yml calls", () => {
  /** @scenario "pr.yml is the only way a pull request starts a product check" */
  void it("each is callable, starts on no pull request itself, and is called on its key", () => {
    for (const [key, file] of Object.entries(CALLED)) {
      const own = triggers(read(file));
      assert.ok(own.includes("workflow_call"), `${file} cannot be called`);
      assert.ok(!own.includes("pull_request"), `${file} still starts on pull_request`);
      assert.ok(!own.includes("merge_group"), `${file} still starts on merge_group`);
      const call = new RegExp(
        `^ {2}${key}:\\n {4}needs: changes\\n {4}if: needs\\.changes\\.outputs\\.${key} == 'true'.*\\n {4}uses: \\./\\.github/workflows/${file.replace(".", "\\.")}$`,
        "m",
      );
      assert.match(pr, call, `pr.yml does not call ${file} on its key`);
    }
  });

  /** @scenario "Called checks never cancel each other" */
  void it("names no concurrency group after the calling workflow", () => {
    for (const file of Object.values(CALLED)) {
      assert.doesNotMatch(read(file), /group:.*\$\{\{\s*github\.workflow\s*\}\}/, file);
    }
  });
});

void describe("given ci-complete", () => {
  /** @scenario "The checks main requires keep reporting" */
  void it("posts every required check from its call, a skipped call counting as passed", () => {
    const posted = [...pr.matchAll(/^ {12}([a-z0-9-]+)=\$\{\{ needs/gm)].map((match) => match[1]);
    assert.deepEqual(posted.toSorted(), REQUIRED.toSorted());
    assert.match(pr, /case "\$result" in success \| skipped\) state=success ;;/);
    const skips = /allowed-skips: (.+)$/m.exec(pr)?.[1]?.split(", ") ?? [];
    assert.deepEqual(skips.toSorted(), Object.keys(CALLED).toSorted());
  });
});

void describe("given a merge queue run", () => {
  /** @scenario "The merge queue runs every product check" */
  void it("forces every key true when the event is not a pull request", () => {
    assert.match(
      pr,
      /if: github\.event_name != 'pull_request'\n {8}id: force\n {8}run: echo "all=true"/,
    );
    for (const key of Object.keys(CALLED)) {
      assert.match(
        pr,
        new RegExp(
          `^ {6}${key}: \\$\\{\\{ steps\\.filter\\.outputs\\.${key} \\|\\| steps\\.force\\.outputs\\.all \\}\\}$`,
          "m",
        ),
      );
    }
  });
});
