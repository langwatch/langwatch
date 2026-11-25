import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

import {
  check,
  closureOf,
  isCovered,
  readLogs,
  suggestRow,
  uncachedProjects,
  type Member,
} from "./check-test-reads.ts";

const members = new Map<string, Member>([
  ["@fix/app", { root: "modules/app/process", dependencies: ["@fix/lib", "vitest"] }],
  ["@fix/lib", { root: "packages/lib", dependencies: ["@fix/time"] }],
  ["@fix/time", { root: "packages/time", dependencies: [] }],
  ["@fix/harness", { root: "packages/harness", dependencies: [] }],
]);
const directories = new Set(["docs", "docs/guides", "modules"]);
const absent = new Set(["modules/pnpm-workspace.yaml"]);

const run = ({
  paths,
  reads = {},
  name = "@fix/app",
}: {
  paths: string[];
  reads?: Record<string, string[]>;
  name?: string;
}) =>
  check({
    recorded: new Map([[name, new Set(paths)]]),
    members,
    reads,
    sharedGlobals: ["pnpm-workspace.yaml"],
    uncached: new Set(["@fix/harness"]),
    ignoredOf: (paths) => new Set(paths.filter((path) => path.startsWith(".vitest-tmp/"))),
    kindOf: (path) => {
      if (absent.has(path)) return undefined;
      return directories.has(path) ? "directory" : "file";
    },
  });

void describe("given the reads a package's cached tests made", () => {
  void describe("when every read is hashed by its cache key", () => {
    void it("passes", () => {
      const errors = run({
        paths: [
          "packages/lib/src/index.ts",
          "packages/time/src/clock.ts",
          "pnpm-workspace.yaml",
          "docs/guides/setup.mdx",
          "docs",
          "packages/lib/.storybook/main.ts",
          "modules/pnpm-workspace.yaml",
          ".vitest-tmp/binary",
        ],
        reads: { "@fix/app": ["docs/guides/**/*"] },
      });
      assert.deepEqual(errors, []);
    });
  });

  void describe("when a test reads an undeclared file", () => {
    void it("fails with the whole row to paste", () => {
      const errors = run({
        paths: ["feature-map.json", "specs/a/one.feature", "specs/a/two.feature"],
        reads: { "@fix/app": ["docs/**/*"] },
      });
      assert.match(errors[0] ?? "", /^::error::@fix\/app's tests read 3 path\(s\)/);
      assert.equal(errors[1], '  "@fix/app": ["docs/**/*", "feature-map.json", "specs/a/**/*"],');
      assert.ok(errors.includes("    read: specs/a/one.feature"));
    });
  });

  void describe("when a test reads a dependency's test file", () => {
    void it("fails, because ^production leaves test files out", () => {
      const errors = run({ paths: ["packages/lib/src/lib.test.ts"] });
      assert.equal(errors[1], '  "@fix/app": ["packages/lib/src/lib.test.ts"],');
    });
  });

  void describe("when a test walks a directory no declared area touches", () => {
    void it("asks for the directory's whole area", () => {
      const errors = run({ paths: ["modules"], name: "@fix/lib" });
      assert.equal(errors[1], '  "@fix/lib": ["modules/**/*"],');
    });
  });

  void describe("when the package's tests are uncached or not a workspace member", () => {
    void it("ignores them", () => {
      assert.deepEqual(run({ paths: ["anything.txt"], name: "@fix/harness" }), []);
      assert.deepEqual(run({ paths: ["anything.txt"], name: "@fix/gone" }), []);
    });
  });
});

void describe("given the dependency graph", () => {
  void it("walks it transitively, skipping external packages", () => {
    assert.deepEqual([...closureOf({ name: "@fix/app", members })].toSorted(), [
      "@fix/lib",
      "@fix/time",
    ]);
  });
});

void describe("given a directory read", () => {
  void it("counts it covered when it holds a declared area", () => {
    const covered = isCovered({
      path: "docs",
      isDirectory: true,
      ownRoot: "packages/x",
      dependencyRoots: [],
      globs: ["docs/pricing.mdx"],
    });
    assert.equal(covered, true);
  });
});

void describe("given the hook's log directory", () => {
  void it("merges each package's worker logs", () => {
    const dir = mkdtempSync(join(tmpdir(), "test-reads-"));
    writeFileSync(join(dir, "@fix__app.101.log"), "docs/a.md\ndocs/b.md\n");
    writeFileSync(join(dir, "@fix__app.102.log"), "docs/a.md\n");
    writeFileSync(join(dir, "langwatch.7.log"), "skills/x.md\n");
    const logs = readLogs(dir);
    assert.deepEqual([...(logs.get("@fix/app") ?? [])], ["docs/a.md", "docs/b.md"]);
    assert.deepEqual([...(logs.get("langwatch") ?? [])], ["skills/x.md"]);
    assert.equal(readLogs(join(dir, "missing")).size, 0);
  });
});

void describe("given nx.json's test target defaults", () => {
  void it("finds the projects whose tests are never cached", () => {
    const uncached = uncachedProjects({
      targetDefaults: {
        test: [{ cache: true }, { filter: { projects: ["@fix/harness"] }, cache: false }],
        "test:unit": { cache: true },
      },
    });
    assert.deepEqual([...uncached], ["@fix/harness"]);
  });
});

void describe("given uncovered reads", () => {
  void it("keeps the existing globs first and adds each new one once", () => {
    const row = suggestRow({
      name: "@fix/app",
      existing: ["docs/**/*"],
      uncovered: [
        { path: "docs/guides", isDirectory: true },
        { path: "apps/worker/src", isDirectory: true },
        { path: "apps/worker/src/main.ts", isDirectory: false },
      ],
    });
    assert.equal(row, '"@fix/app": ["docs/**/*", "docs/guides/**/*", "apps/worker/**/*"],');
  });
});

void describe("given the hook loaded into a test worker", () => {
  const root = resolve(import.meta.dirname, "../..");
  const hook = join(root, "dev/nx/test-reads-hook.cjs");
  const run = (script: string) => {
    const out = mkdtempSync(join(tmpdir(), "hook-reads-"));
    spawnSync(process.execPath, ["--require", hook, "-e", script], {
      cwd: join(root, "packages/csv"),
      env: {
        ...process.env,
        TEST_READS_OUT: out,
        VITEST_WORKER_ID: "1",
        npm_package_name: "@fix/app",
        npm_lifecycle_event: "test",
      },
    });
    return readdirSync(out)
      .flatMap((file) => readFileSync(join(out, file), "utf8").split("\n"))
      .filter((line) => line !== "");
  };

  void it("records a read outside the package", () => {
    assert.deepEqual(run('require("node:fs").statSync("../../package.json")'), ["package.json"]);
  });

  void it("never records its own file", () => {
    assert.deepEqual(run(`require("node:fs").statSync(${JSON.stringify(hook)})`), []);
  });
});

void describe("given the declared reads table", () => {
  void it("names each package once, since a repeated key silently replaces the first", () => {
    const source = readFileSync(
      join(import.meta.dirname, "../../dev/nx/test-reads-plugin.mjs"),
      "utf8",
    );
    const keys = [...source.matchAll(/^ {2}"?([@\w/-]+)"?: \[/gm)].map((match) => match[1]);
    assert.deepEqual(
      keys.filter((key, index) => keys.indexOf(key) !== index),
      [],
    );
  });
});
