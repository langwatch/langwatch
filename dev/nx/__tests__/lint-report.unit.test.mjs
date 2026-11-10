import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseReport } from "../lint.mjs";

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
