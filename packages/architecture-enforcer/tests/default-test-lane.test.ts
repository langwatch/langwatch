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

  describe("when the default lane collects a file that starts a container", () => {
    /** @scenario "A shared test lane that starts a container is reported" */
    it.each([
      [
        "a testcontainers class",
        'import { RedisContainer } from "@testcontainers/redis";\nawait new RedisContainer("redis").start();',
      ],
      [
        "the ClickHouse endpoint starter",
        'import { startTestClickHouseEndpoints } from "@langwatch/clickhouse-client/testing";\nawait startTestClickHouseEndpoints({ suite: "s", names: ["a"], environment: {} });',
      ],
      [
        "a helper module that calls the starter",
        'import { startStore } from "./support/store.harness.ts";\nawait startStore();',
      ],
      [
        "a namespace import of the helper module",
        'import * as store from "./support/store.harness.ts";\nawait store.startStore();',
      ],
      [
        "a renamed `export { x } from` re-export",
        'import { boot } from "./support/named-barrel.ts";\nawait boot();',
      ],
      [
        "an `export * from` re-export",
        'import { startStore } from "./support/star-barrel.ts";\nawait startStore();',
      ],
    ])("reports the file when it starts one through %s", (_name, test) => {
      workspace({
        "tools/probe/package.json": manifest("vitest run"),
        "tools/probe/src/support/store.harness.ts": [
          'import { startTestClickHouseEndpoints } from "@langwatch/clickhouse-client/testing";',
          "export const startStore = () => startTestClickHouseEndpoints({ suite: 's', names: [], environment: {} });",
        ].join("\n"),
        "tools/probe/src/support/named-barrel.ts":
          'export { startStore as boot } from "./store.harness.ts";',
        "tools/probe/src/support/star-barrel.ts": 'export * from "./store.harness.ts";',
        "tools/probe/src/store.integration.test.ts": test,
      });

      expect(lint().map((violation) => violation.message)).toEqual([
        expect.stringContaining("src/store.integration.test.ts"),
      ]);
    });
  });

  describe("when no file in the default lane starts a container", () => {
    /** @scenario "A shared test lane that leaves its container suites to test:integration passes" */
    it.each([
      [
        "the starters live only in files the lane excludes",
        'vitest run --exclude "**/*.integration.test.ts"',
        'import { startStore } from "./support/store.harness.ts";\nawait startStore();',
      ],
      [
        "a file imports a constant from a module that also starts containers",
        "vitest run",
        'import { STORE_IMAGE } from "./support/store.harness.ts";\nexport const image = STORE_IMAGE;',
      ],
    ])("passes when %s", (_name, test, source) => {
      workspace({
        "tools/probe/package.json": manifest(test),
        "tools/probe/src/support/store.harness.ts": [
          'import { RedisContainer } from "@testcontainers/redis";',
          'export const STORE_IMAGE = "redis:alpine";',
          "export async function startStore() {",
          "  return new RedisContainer(STORE_IMAGE).start();",
          "}",
        ].join("\n"),
        "tools/probe/src/store.integration.test.ts": source,
      });

      expect(lint()).toEqual([]);
    });

    it("passes when the package-suites job leaves the package to a job of its own", () => {
      workspace({
        ".github/package-suites.excluded": "# header\n@langwatch/probe  # runs in its own job\n",
        "tools/probe/package.json": manifest("vitest run"),
        "tools/probe/src/store.integration.test.ts":
          'import { RedisContainer } from "@testcontainers/redis";\nawait new RedisContainer("redis").start();',
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
