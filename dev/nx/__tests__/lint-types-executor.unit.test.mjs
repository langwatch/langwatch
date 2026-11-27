import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { splitReport, taskResults } from "../executors/lint-types.mjs";

const roots = ["packages/time", "modules/trace/process", "modules/trace/contract"];
const tasks = [
  { id: "time:lint:types" },
  { id: "process:lint:types" },
  { id: "contract:lint:types" },
];
const out = [
  "packages/time/src/calendar.ts:10:3: Unused oxlint-disable directive [x]",
  "  help: delete it",
  "modules/trace/contract/src/a.ts:1:1: Floating promise [y]",
  "",
  "2 problem(s)",
  "",
].join("\n");

void describe("lint:types batch report", () => {
  /** @scenario "Type-aware lint batches the projects Nx did not replay" */
  void it("gives each diagnostic and its help to the project that owns the file", () => {
    const byRoot = splitReport({ out, roots });
    assert.deepEqual(byRoot.get("packages/time"), [
      "packages/time/src/calendar.ts:10:3: Unused oxlint-disable directive [x]",
      "  help: delete it",
    ]);
    assert.deepEqual(byRoot.get("modules/trace/process"), []);
    assert.equal(byRoot.get("modules/trace/contract").length, 1);
  });

  /** @scenario "Type-aware lint batches the projects Nx did not replay" */
  void it("fails only the projects with findings", () => {
    const results = taskResults({ tasks, roots, status: 1, out, err: "" });
    assert.equal(results["time:lint:types"].success, false);
    assert.equal(results["process:lint:types"].success, true);
    assert.equal(results["contract:lint:types"].success, false);
    assert.match(results["process:lint:types"].terminalOutput, /^0 problem\(s\)/);
  });

  /** @scenario "Type-aware lint batches the projects Nx did not replay" */
  void it("reads a file name with a space as its project's finding", () => {
    const spaced = "packages/time/src/calendar copy.ts:1:1: Floating promise [y]\n\n1 problem(s)\n";
    const results = taskResults({ tasks, roots, status: 1, out: spaced, err: "" });
    assert.equal(results["time:lint:types"].success, false);
    assert.equal(results["process:lint:types"].success, true);
  });

  /** @scenario "Type-aware lint batches the projects Nx did not replay" */
  void it("fails every project when a failing run has no finding a project owns", () => {
    const stray = "elsewhere/a.ts:1:1: Floating promise [y]\n\n1 problem(s)\n";
    const results = taskResults({ tasks, roots, status: 1, out: stray, err: "" });
    assert.ok(Object.values(results).every((result) => !result.success));
  });

  /** @scenario "Type-aware lint batches the projects Nx did not replay" */
  void it("fails every project when the findings it read fall short of the reported count", () => {
    const cut = "packages/time/src/calendar.ts:1:1: Floating promise [y]\n\n3 problem(s)\n";
    const results = taskResults({ tasks, roots, status: 1, out: cut, err: "" });
    assert.ok(Object.values(results).every((result) => !result.success));
  });

  /** @scenario "Type-aware lint batches the projects Nx did not replay" */
  void it("fails every project when an oxlint process could not run", () => {
    const err = "oxlint -c .oxlintrc.types.jsonc exited 2:\nthread panicked\n";
    const results = taskResults({ tasks, roots, status: 1, out: "", err });
    assert.ok(Object.values(results).every((result) => !result.success));
    assert.match(results["time:lint:types"].terminalOutput, /thread panicked/);
    assert.doesNotMatch(results["process:lint:types"].terminalOutput, /thread panicked/);
  });
});
