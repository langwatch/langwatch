import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const fixture = mkdtempSync(join(tmpdir(), "langwatch-typecheck-"));
const script = fileURLToPath(new URL("../typecheck.mjs", import.meta.url));
const invocation = join(fixture, "invocation.json");
writeFileSync(
  join(fixture, "pnpm"),
  `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
writeFileSync(process.env.TYPECHECK_INVOCATION, JSON.stringify(process.argv.slice(2)));
writeFileSync(process.env.TYPECHECK_INVOCATION + ".environment", JSON.stringify({
  memoryLimit: process.env.GOMEMLIMIT,
}));
process.exitCode = Number(process.env.TYPECHECK_EXIT_CODE ?? 0);
`,
  { mode: 0o755 },
);
writeFileSync(join(fixture, "package.json"), '{"type":"module"}');
after(() => rmSync(fixture, { recursive: true, force: true }));

function run(args, exitCode = 0) {
  rmSync(invocation, { force: true });
  return spawnSync(process.execPath, [script, ...args], {
    cwd: fixture,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${fixture}${delimiter}${process.env.PATH}`,
      TYPECHECK_INVOCATION: invocation,
      TYPECHECK_EXIT_CODE: String(exitCode),
      GOMEMLIMIT: "",
    },
  });
}

test("the default checks all three applications sequentially", () => {
  assert.equal(run([]).status, 0);
  assert.deepEqual(JSON.parse(readFileSync(invocation, "utf8")), [
    "--workspace-concurrency=1",
    "--filter",
    "@langwatch/platform-api",
    "--filter",
    "@langwatch/worker",
    "--filter",
    "@langwatch/ui",
    "typecheck",
  ]);
  const environment = JSON.parse(readFileSync(invocation + ".environment", "utf8"));
  assert.equal(environment.memoryLimit, "");
});

test("a pair selects only those applications and forwards compiler flags", () => {
  assert.equal(run(["worker", "ui", "worker", "--", "--extendedDiagnostics"]).status, 0);
  assert.deepEqual(JSON.parse(readFileSync(invocation, "utf8")), [
    "--workspace-concurrency=1",
    "--filter",
    "@langwatch/worker",
    "--filter",
    "@langwatch/ui",
    "typecheck",
    "--extendedDiagnostics",
  ]);
});

test("a single application preserves a failed check's exit status", () => {
  assert.equal(run(["ui"], 7).status, 7);
  assert.deepEqual(JSON.parse(readFileSync(invocation, "utf8")), [
    "--workspace-concurrency=1",
    "--filter",
    "@langwatch/ui",
    "typecheck",
  ]);
});

test("an unknown application fails before launching a check", () => {
  const result = run(["worker", "u"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown application: u/);
  assert.throws(() => readFileSync(invocation), { code: "ENOENT" });
});

test("fast checks select production checks and preserve compiler flags", () => {
  assert.equal(run(["--fast", "worker", "ui", "--extendedDiagnostics"]).status, 0);
  assert.deepEqual(JSON.parse(readFileSync(invocation, "utf8")), [
    "--workspace-concurrency=1",
    "--filter",
    "@langwatch/worker",
    "--filter",
    "@langwatch/ui",
    "typecheck:fast",
    "--extendedDiagnostics",
  ]);
});

test("fast checks still reject an unknown application", () => {
  const result = run(["--fast", "workre"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown application: workre/);
  assert.throws(() => readFileSync(invocation), { code: "ENOENT" });
});

test("typecheck:one delegates by directory or package name and forwards compiler options", () => {
  const target = mkdtempSync(join(fixture, "package-"));
  writeFileSync(
    join(target, "package.json"),
    JSON.stringify({
      scripts: { typecheck: "prepare-declarations && tsc --noEmit -p tsconfig.typecheck.json" },
    }),
  );
  const one = fileURLToPath(new URL("../typecheck-one.mjs", import.meta.url));
  for (const [input, filters] of [
    [target, []],
    ["@langwatch/trace-server", ["--filter", "@langwatch/trace-server", "--fail-if-no-match"]],
  ]) {
    const result = spawnSync(process.execPath, [one, input, "--extendedDiagnostics"], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fixture}${delimiter}${process.env.PATH}`,
        TYPECHECK_INVOCATION: invocation,
        TYPECHECK_EXIT_CODE: "7",
      },
    });
    assert.equal(result.status, 7, result.stderr);
    assert.deepEqual(JSON.parse(readFileSync(invocation, "utf8")), [
      ...filters,
      "run",
      "typecheck",
      "--extendedDiagnostics",
    ]);
  }
});
