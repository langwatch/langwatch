import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseReport, routeFlags, widenedScope } from "../lint.mjs";

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
void describe("routeFlags", () => {
  /** @scenario "Lint runs replay through Nx except a lint of the working tree" */
  void it("lints a --changed run directly, never through Nx", () => {
    assert.deepEqual(routeFlags(["--changed"]), { route: "direct", types: false });
    assert.deepEqual(routeFlags(["--changed", "--types"]), { route: "direct", types: true });
  });

  /** @scenario "Lint runs replay through Nx except a lint of the working tree" */
  void it("sends a full or --base run through Nx", () => {
    assert.deepEqual(routeFlags([]), { route: "nx", types: false, base: undefined });
    assert.deepEqual(routeFlags(["--types", "--base", "abc123"]), {
      route: "nx",
      types: true,
      base: "abc123",
    });
  });

  /** @scenario "Lint runs replay through Nx except a lint of the working tree" */
  void it("lints the paths Nx hands back, dropping flags and the --base value", () => {
    const flags = ["--resolved", "--types", "--base", "abc123", "apps/api", "packages/time"];
    assert.deepEqual(routeFlags(flags), {
      route: "resolved",
      types: true,
      paths: ["apps/api", "packages/time"],
    });
  });
});
