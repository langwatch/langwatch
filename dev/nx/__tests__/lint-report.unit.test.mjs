import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseReport, widenedScope } from "../lint.mjs";

void describe("parseReport", () => {
  /** @scenario "A lint run whose every path is ignored has no problems" */
  void it("reads the diagnostics of a json report", () => {
    const out = JSON.stringify({ diagnostics: [{ message: "x" }], number_of_files: 1 });
    assert.deepEqual(parseReport(out), [{ message: "x" }]);
  });

  /** @scenario "A lint run whose every path is ignored has no problems" */
  void it("reads a run whose every path was ignored as no problems", () => {
    const out = `No files found to lint. Please check your paths and ignore patterns.\n${JSON.stringify({ diagnostics: [], number_of_files: 0 })}`;
    assert.deepEqual(parseReport(out), []);
  });

  /** @scenario "A lint run whose every path is ignored has no problems" */
  void it("returns undefined when oxlint printed an error instead", () => {
    assert.equal(parseReport("thread panicked"), undefined);
  });
});
void describe("widenedScope", () => {
  const roots = ["a", "b", "c", "d"];

  /** @scenario "A type-aware scope past half the projects lints every project" */
  void it("lints every project once a change reaches more than half of them", () => {
    assert.deepEqual(widenedScope({ roots, reached: ["a", "b", "c"] }), roots);
  });

  /** @scenario "A type-aware scope past half the projects lints every project" */
  void it("keeps a scope of half the projects or fewer", () => {
    assert.deepEqual(widenedScope({ roots, reached: ["a", "c"] }), ["a", "c"]);
  });
});
