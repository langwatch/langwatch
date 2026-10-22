// dev/nx/import-graph.mjs and dev/nx/test-changed.mjs,
// bound to specs/tooling/test-changed.feature.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";

import { buildImportGraph, reachedFrom, scanSpecifiers } from "../import-graph.mjs";
import { changedSince, checkNamed, defaultBase, planRuns, readPackages } from "../test-changed.mjs";

const FILES = {
  "package.json": { name: "@langwatch/workspace", private: true },
  "packages/time/package.json": {
    name: "@langwatch/time",
    exports: { ".": { types: "./dist/index.d.ts", default: "./src/index.ts" } },
    scripts: { test: "vitest run" },
  },
  "packages/time/vitest.config.ts": `export default { test: { setupFiles: ["./vitest.setup.ts"] } };\n`,
  "packages/time/vitest.setup.ts": "globalThis.ready = true;\n",
  "packages/time/src/index.ts": `export { clock } from "./clock.js";\n`,
  "packages/time/src/clock.ts": "export const clock = () => 1;\n",
  "packages/time/src/shape.ts": "export type Shape = { at: number };\n",
  "packages/time/src/__tests__/clock.unit.test.ts": `import { clock } from "../clock";\n`,
  "packages/time/src/__tests__/shape.unit.test.ts": `import type { Shape } from "../shape";\n`,
  "modules/trace/process/package.json": {
    name: "@langwatch/identity-process",
    imports: { "#*": { types: "./dist/*.d.ts", default: "./src/*.ts" } },
    scripts: { test: "vitest run --exclude '**/*.integration.test.ts'" },
  },
  "modules/trace/process/src/span.ts": `import { clock } from "@langwatch/time";\nexport const span = clock;\n`,
  "modules/trace/process/src/rules/limit.ts": "export const limit = 3;\n",
  "modules/trace/process/src/__tests__/span.unit.test.ts": `import { span } from "#span";\n`,
  "modules/trace/process/src/__tests__/limit.unit.test.ts": `import { limit } from "#rules/limit";\n`,
  "modules/auth/notes.md": "read from disk by the identity tests\n",
  "sdks/typescript/package.json": { name: "langwatch", scripts: { test: "vitest run" } },
  "sdks/typescript/tsconfig.json": `{\n  // paths, as the SDK declares them\n  "compilerOptions": { "paths": { "@/*": ["./src/*"] } },\n}\n`,
  "sdks/typescript/src/client.ts": "export const client = 1;\n",
  "sdks/typescript/src/__tests__/client.unit.test.ts": `import { client } from "@/client";\n`,
  "dev/scripts/package.json": { name: "@langwatch/dev-scripts" },
  "dev/scripts/__tests__/clock.unit.test.mjs": `import { clock } from "../../../packages/time/src/clock.ts";\n`,
};

function write({ root, file, content }) {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  const text = typeof content === "string" ? content : JSON.stringify(content);
  writeFileSync(join(root, file), text);
}

function fixtureRepo() {
  const root = mkdtempSync(join(tmpdir(), "test-changed-"));
  for (const [file, content] of Object.entries(FILES)) write({ root, file, content });
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["add", "-A"], { cwd: root });

  return root;
}

function plan({ root, changed, withReads }) {
  const graph = buildImportGraph({ root });
  const packages = readPackages({
    files: graph.files,
    readText: (file) => readFileSync(join(root, file), "utf8"),
  });

  const reached = reachedFrom({ graph, changed });

  return planRuns({ graph, packages, changed, reached, withReads });
}

const summary = (runs) => runs.map(({ dir, whole, files }) => ({ dir, whole, files }));

void describe("test:changed", () => {
  /** @scenario "An edit runs the test files that import it, in every package" */
  void it("runs each package's reached tests through its own test script, the edited one first", () => {
    const root = fixtureRepo();
    const result = plan({ root, changed: ["packages/time/src/clock.ts"] });

    assert.deepEqual(summary(result.runs), [
      { dir: "packages/time", whole: false, files: ["src/__tests__/clock.unit.test.ts"] },
      {
        dir: "modules/trace/process",
        whole: false,
        files: ["src/__tests__/span.unit.test.ts"],
      },
    ]);
    assert.equal(result.runs[1].script, "vitest run --exclude '**/*.integration.test.ts'");
  });

  /** @scenario "A type-only import does not reach a test" */
  void it("leaves out a test that imports the file only as a type", () => {
    const root = fixtureRepo();
    const result = plan({ root, changed: ["packages/time/src/shape.ts"] });

    assert.deepEqual(result.runs, []);
    assert.deepEqual(scanSpecifiers({ file: "a.ts", text: `import type { A } from "./a";\n` }), []);
    assert.deepEqual(
      scanSpecifiers({
        file: "a.ts",
        text: `import { type A, b } from "./b";\nexport type { C } from "./c";\n`,
      }),
      ["./b"],
    );
  });

  /** @scenario "Subpath imports and tsconfig paths are followed" */
  void it("follows # subpath imports and tsconfig paths", () => {
    const root = fixtureRepo();
    const subpath = plan({ root, changed: ["modules/trace/process/src/rules/limit.ts"] });
    const paths = plan({ root, changed: ["sdks/typescript/src/client.ts"] });

    assert.deepEqual(summary(subpath.runs), [
      {
        dir: "modules/trace/process",
        whole: false,
        files: ["src/__tests__/limit.unit.test.ts"],
      },
    ]);
    assert.deepEqual(summary(paths.runs), [
      { dir: "sdks/typescript", whole: false, files: ["src/__tests__/client.unit.test.ts"] },
    ]);
  });

  /** @scenario "A changed Vitest config or setup file runs its whole suite" */
  void it("runs the whole suite whose setup file changed, after the reached files", () => {
    const root = fixtureRepo();
    const changed = ["packages/time/vitest.setup.ts", "modules/trace/process/src/span.ts"];
    const result = plan({ root, changed });

    assert.deepEqual(summary(result.runs), [
      {
        dir: "modules/trace/process",
        whole: false,
        files: ["src/__tests__/span.unit.test.ts"],
      },
      { dir: "packages/time", whole: true, files: [] },
    ]);
    assert.deepEqual(result.runs[1].because, ["packages/time/vitest.config.ts"]);
  });

  /** @scenario "A file a package's tests read from disk is listed, and runs its whole suite on request" */
  void it("lists a suite that reads the changed file, and runs it whole with --reads", () => {
    const root = fixtureRepo();
    const listed = plan({ root, changed: ["modules/auth/notes.md"] });
    const run = plan({ root, changed: ["modules/auth/notes.md"], withReads: true });

    assert.deepEqual(listed.runs, []);
    assert.deepEqual(summary(listed.readers), [
      { dir: "modules/trace/process", whole: true, files: [] },
    ]);
    assert.deepEqual(summary(run.runs), [{ dir: "modules/trace/process", whole: true, files: [] }]);
  });

  /** @scenario "A test file no Vitest package owns is listed, not run" */
  void it("lists a reached node:test file instead of running it", () => {
    const root = fixtureRepo();
    const result = plan({ root, changed: ["packages/time/src/clock.ts"] });

    assert.deepEqual(result.notVitest, ["dev/scripts/__tests__/clock.unit.test.mjs"]);
  });

  /** @scenario "With no files named, the change is what differs from the merge base" */
  void it("collects committed, staged, unstaged and untracked files since the base", () => {
    const root = fixtureRepo();
    const commit = (message) =>
      execFileSync(
        "git",
        ["-c", "commit.gpgsign=false", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", message],
        { cwd: root },
      );
    commit("base");
    const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    write({ root, file: "packages/time/src/clock.ts", content: "export const clock = () => 2;\n" });
    execFileSync("git", ["add", "-A"], { cwd: root });
    commit("committed edit");
    write({ root, file: "packages/time/src/index.ts", content: "export {};\n" });
    execFileSync("git", ["add", "packages/time/src/index.ts"], { cwd: root });
    write({ root, file: "packages/time/src/shape.ts", content: "export type Shape = {};\n" });
    write({ root, file: "packages/time/src/new.ts", content: "export const n = 1;\n" });

    assert.deepEqual(changedSince({ base, cwd: root }), [
      "packages/time/src/clock.ts",
      "packages/time/src/index.ts",
      "packages/time/src/new.ts",
      "packages/time/src/shape.ts",
    ]);
  });

  /** @scenario "With no files named, the change is what differs from the merge base" */
  void it("falls back to HEAD as the base when origin/main does not exist", () => {
    const root = fixtureRepo();
    execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "base"], { cwd: root });

    assert.equal(defaultBase({ cwd: root }), "HEAD");
  });

  /** @scenario "An argument that is not a file or a known option is refused" */
  void it("refuses unknown options and files that exist nowhere, and allows deleted files", () => {
    const root = fixtureRepo();
    execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "base"], { cwd: root });
    const known = (file) => file === "packages/time/src/clock.ts";

    assert.deepEqual(checkNamed({ named: ["packages/time/src/clock.ts"], known, cwd: root }), []);
    assert.deepEqual(checkNamed({ named: ["modules/auth/notes.md"], known, cwd: root }), []);
    assert.equal(checkNamed({ named: ["--base=origin/main", "-l"], known, cwd: root }).length, 2);
    assert.equal(checkNamed({ named: ["src/clock.ts"], known, cwd: root }).length, 1);
    execFileSync("git", ["rm", "-q", "packages/time/src/shape.ts"], { cwd: root });
    assert.deepEqual(checkNamed({ named: ["packages/time/src/shape.ts"], known, cwd: root }), []);
  });

  /** @scenario "The graph rescans only the files that changed since the last run" */
  void it("reads again only the changed file, and nothing when nothing changed", () => {
    const root = fixtureRepo();
    const cacheFile = join(root, "node_modules/.cache/graph.json");
    const first = buildImportGraph({ root, cacheFile });
    const unchanged = buildImportGraph({ root, cacheFile });
    write({
      root,
      file: "packages/time/src/clock.ts",
      content: "export const clock = () => 22;\n",
    });
    const edited = buildImportGraph({ root, cacheFile });

    assert.equal(first.stats.rescanned, 14);
    assert.deepEqual([unchanged.stats.rescanned, unchanged.stats.resolved], [0, 0]);
    assert.deepEqual([edited.stats.rescanned, edited.stats.resolved], [1, 1]);
    assert.deepEqual(edited.imports, first.imports);
  });
});
