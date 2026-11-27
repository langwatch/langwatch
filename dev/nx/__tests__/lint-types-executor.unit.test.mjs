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
  void it("fails every project when an oxlint process could not run", () => {
    const err = "oxlint -c .oxlintrc.types.jsonc exited 2:\nthread panicked\n";
    const results = taskResults({ tasks, roots, status: 1, out: "", err });
    assert.ok(Object.values(results).every((result) => !result.success));
  });
});
