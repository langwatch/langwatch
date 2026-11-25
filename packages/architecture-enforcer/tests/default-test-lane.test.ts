import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { lintDefaultTestLanes } from "../src/policies/quality/default-test-lane.ts";
import { snapshotOf } from "./workspace.ts";

let root = "";

function write(path: string, content: string): void {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function workspace(files: Record<string, string>): void {
  root = mkdtempSync(join(tmpdir(), "default-test-lane-"));
  write("pnpm-workspace.yaml", 'packages:\n  - "tools/*"\n');
  for (const [path, content] of Object.entries(files)) write(path, content);
}

function manifest(test: string): string {
  return JSON.stringify({ name: "@langwatch/probe", scripts: { test } });
}

function lint() {
  return lintDefaultTestLanes(snapshotOf({ root, packages: [] }));
}

describe("default test lanes", () => {
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = "";
  });

  describe("when the default lane reaches a scenario suite", () => {
    /** @scenario "A default test lane that collects a scenario suite is reported" */
    it("reports the scenario file the lane collects", () => {
      workspace({
        "tools/probe/package.json": manifest("vitest run"),
        "tools/probe/vitest.config.ts": "export default { test: {} };",
        "tools/probe/_tests/live.scenario.test.ts": "",
        "tools/probe/_tests/pure.test.ts": "",
      });

      const violations = lint();

      expect(violations.map((violation) => violation.message)).toEqual([
        expect.stringContaining("_tests/live.scenario.test.ts"),
      ]);
    });
  });

  describe("when the default lane keeps scenario suites out", () => {
    /** @scenario "A default lane that excludes or never includes its scenarios passes" */
    it.each([
      [
        "an exclude glob",
        'export default { test: { exclude: ["**/*.scenario.test.ts"] } };',
        "vitest run",
      ],
      [
        "a unit-only include",
        'export default { test: { include: ["src/**/*.unit.test.ts"] } };',
        "vitest run",
      ],
      [
        "an --exclude flag",
        "export default { test: {} };",
        'vitest run --exclude "**/*.scenario.test.ts"',
      ],
    ])("passes with %s", (_name, config, test) => {
      workspace({
        "tools/probe/package.json": manifest(test),
        "tools/probe/vitest.config.ts": config,
        "tools/probe/_tests/live.scenario.test.ts": "",
      });

      expect(lint()).toEqual([]);
    });
  });

  describe("when the default lane waits longer than two minutes per test", () => {
    /** @scenario "A default test lane with a timeout above two minutes is reported" */
    it("reports the evaluated timeout", () => {
      workspace({
        "tools/probe/package.json": manifest("vitest run"),
        "tools/probe/vitest.config.ts": "export default { test: { testTimeout: 60 * 60 * 1000 } };",
      });

      expect(lint().map((violation) => violation.message)).toEqual([
        expect.stringContaining("3600000"),
      ]);
    });

    it("reads the lane named by --config, not the default file", () => {
      workspace({
        "tools/probe/package.json": manifest("vitest run --config vitest.unit.config.ts"),
        "tools/probe/vitest.unit.config.ts": "export default { test: { testTimeout: 10_000 } };",
        "tools/probe/vitest.config.ts": "export default { test: { testTimeout: 3_600_000 } };",
      });

      expect(lint()).toEqual([]);
    });
  });
});
