// Unit and small-integration tests for the crash-rendering layer added to
// dev-supervisor.mjs (specs/setup/dev-supervisor-crash-rendering.feature).
//
// The pure classifiers/collapsers are exercised directly; the two
// end-to-end tests spawn dev-supervisor.mjs itself in --watch mode around a
// throwaway fixture script that writes exactly the raw text Node prints for
// each crash shape, so the wiring (spawnOne -> wireStdout/wireStderr ->
// classify/collapse -> write) is what is under test, not a copy of it.
//
//   node --test dev/scripts/__tests__/dev-supervisor-crash-rendering.unit.test.mjs

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  classifyBootException,
  classifyMissingExport,
  classifyMissingPackage,
  classifyRawCrash,
  collapseStackRecord,
  crashMessage,
  firstAppFrame,
  rawCrashEnabled,
} from "../dev-supervisor.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUPERVISOR = path.join(HERE, "../dev-supervisor.mjs");
const REPO_ROOT = path.resolve(HERE, "../../..");

const MISSING_EXPORT_DUMP =
  `${path.join(REPO_ROOT, "apps/api/src/index.ts")}:180\n` +
  "  createExperimentsRestApp,\n" +
  "  ^\n\n" +
  "SyntaxError: The requested module '@langwatch/experiment-server' does not provide an export named 'createExperimentsRestApp'\n" +
  "    at #asyncInstantiate (node:internal/modules/esm/module_job:302:21)\n";

const MISSING_PACKAGE_DUMP =
  `Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@langwatch/api' imported from ${path.join(REPO_ROOT, "modules/langy/contract/src/setup-skills.trpc.ts")}\n` +
  "    at moduleResolve (node:internal/modules/esm/resolve:1234:5)\n";

/** Runs dev-supervisor.mjs --watch once around a throwaway fixture script,
 * collects its stdout/stderr, and cleans the fixture up. */
async function runWatchedFixture({ body, env = {} }) {
  const fixture = path.join(os.tmpdir(), `dev-supervisor-crash-fixture-${process.pid}-${Date.now()}.mjs`);
  fs.writeFileSync(fixture, body);
  try {
    const child = spawn(process.execPath, [SUPERVISOR, "--watch", "--", process.execPath, fixture], {
      cwd: REPO_ROOT,
      env: { ...process.env, ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    await new Promise((resolve) => child.on("close", resolve));
    return { stdout, stderr };
  } finally {
    fs.rmSync(fixture, { force: true });
  }
}

describe("firstAppFrame", () => {
  it("given a trace under node_modules and a repo frame, picks the repo one", () => {
    const stack =
      "TypeError: boom\n" +
      `    at Object.<anonymous> (${path.join(REPO_ROOT, "node_modules/some-lib/index.js")}:10:3)\n` +
      `    at PromptApp.create (${path.join(REPO_ROOT, "modules/prompt/server/src/app/prompt.app.ts")}:193:31)\n` +
      "    at node:internal/modules/esm/module_job:302:21";
    assert.deepEqual(firstAppFrame(stack), {
      file: "modules/prompt/server/src/app/prompt.app.ts",
      line: "193",
    });
  });

  it("given a trace with only node_modules and internal frames, finds none", () => {
    const stack =
      "Error: boom\n" +
      `    at Object.<anonymous> (${path.join(REPO_ROOT, "node_modules/some-lib/index.js")}:10:3)\n` +
      "    at node:internal/modules/esm/module_job:302:21";
    assert.equal(firstAppFrame(stack), null);
  });

  it("is null for a stack with no frames at all", () => {
    assert.equal(firstAppFrame("Error: boom"), null);
  });
});

describe("collapseStackRecord", () => {
  /** @scenario "A caught boot exception renders as one line, not a header plus a trace" */
  it("given a fatal record with a stack, collapses it to one line naming the first app frame", () => {
    const record = JSON.stringify({
      time: "2026-09-10T03:14:30.066Z",
      level: "fatal",
      service: "langwatch-api",
      msg: "fatal boot failure: Cannot read properties of undefined (reading 'prompts')",
      error: { type: "TypeError", message: "x" },
      stack:
        "TypeError: Cannot read properties of undefined (reading 'prompts')\n" +
        `    at PromptApp.create (${path.join(REPO_ROOT, "modules/prompt/server/src/app/prompt.app.ts")}:193:31)\n` +
        "    at node:internal/process/task_queues:95:5",
    });

    const collapsed = collapseStackRecord(record);
    assert.notEqual(collapsed, null);
    const parsed = JSON.parse(collapsed.collapsed);
    assert.equal(
      parsed.msg,
      "fatal boot failure: Cannot read properties of undefined (reading 'prompts') — at modules/prompt/server/src/app/prompt.app.ts:193",
    );
    assert.equal(parsed.stack, undefined);
    assert.equal(parsed.level, "fatal");
    assert.match(collapsed.rawText, /at PromptApp\.create/);
  });

  it("is null for a record with no stack field", () => {
    assert.equal(collapseStackRecord(JSON.stringify({ level: "info", msg: "listening" })), null);
  });

  it("is null for a line that is not JSON", () => {
    assert.equal(collapseStackRecord("not json at all"), null);
  });
});

describe("classifyMissingExport", () => {
  /** @scenario "A missing named export is one fatal line naming the module and the export" */
  it("given Node's ESM export-mismatch dump, names the module, the export and the location", () => {
    const classified = classifyMissingExport(MISSING_EXPORT_DUMP);
    assert.deepEqual(classified, {
      kind: "missing-export",
      specifier: "@langwatch/experiment-server",
      exportName: "createExperimentsRestApp",
      file: "apps/api/src/index.ts",
      line: "180",
    });
    assert.equal(
      crashMessage(classified),
      "missing export: module '@langwatch/experiment-server' does not export 'createExperimentsRestApp' (imported at apps/api/src/index.ts:180)",
    );
  });

  it("is null for text that is not this shape", () => {
    assert.equal(classifyMissingExport("Error: something else entirely"), null);
  });
});

describe("classifyMissingPackage", () => {
  /** @scenario "A missing package is one fatal line naming the package and the importer" */
  it("given Node's ERR_MODULE_NOT_FOUND dump, names the package and the importing file", () => {
    const classified = classifyMissingPackage(MISSING_PACKAGE_DUMP);
    assert.deepEqual(classified, {
      kind: "missing-package",
      specifier: "@langwatch/api",
      importer: "modules/langy/contract/src/setup-skills.trpc.ts",
    });
    assert.equal(
      crashMessage(classified),
      "missing package: cannot find '@langwatch/api' (imported from modules/langy/contract/src/setup-skills.trpc.ts)",
    );
  });
});

describe("classifyBootException", () => {
  /** @scenario "An uncaught exception is one fatal line naming the error and the first application frame" */
  it("given an uncaught exception's dump, names the error and skips node_modules/internal frames", () => {
    const dump =
      "node:internal/process/promises:288\n" +
      "            triggerUncaughtException(err, true);\n" +
      "            ^\n\n" +
      "TypeError: Cannot read properties of undefined (reading 'x')\n" +
      "    at Object.<anonymous> (/repo/node_modules/some-lib/index.js:10:3)\n" +
      `    at Object.create (${path.join(REPO_ROOT, "modules/prompt/server/src/app/prompt.app.ts")}:193:31)\n` +
      "    at node:internal/modules/esm/module_job:302:21\n";

    const classified = classifyBootException(dump);
    assert.equal(classified.errorType, "TypeError");
    assert.equal(classified.message, "Cannot read properties of undefined (reading 'x')");
    assert.deepEqual(classified.frame, { file: "modules/prompt/server/src/app/prompt.app.ts", line: "193" });
  });

  it("is null for text with no Error banner", () => {
    assert.equal(classifyBootException("just some ordinary output\nnothing to see"), null);
  });
});

describe("classifyRawCrash", () => {
  it("tries the missing-export shape before falling back to the generic one", () => {
    assert.equal(classifyRawCrash(MISSING_EXPORT_DUMP).kind, "missing-export");
    assert.equal(classifyRawCrash(MISSING_PACKAGE_DUMP).kind, "missing-package");
  });

  it("is null for output that matches none of the known shapes", () => {
    assert.equal(classifyRawCrash("hello from a well-behaved process\n"), null);
  });
});

describe("rawCrashEnabled", () => {
  it("is off by default", () => {
    assert.equal(rawCrashEnabled({}), false);
  });

  it("is on for '1' and 'true'", () => {
    assert.equal(rawCrashEnabled({ LANGWATCH_DEV_RAW_CRASH: "1" }), true);
    assert.equal(rawCrashEnabled({ LANGWATCH_DEV_RAW_CRASH: "true" }), true);
  });
});

describe("the watched child's raw crash, end to end", () => {
  /** @scenario "A missing named export is one fatal line naming the module and the export" */
  it("given a child that dumps the ESM export-mismatch shape, renders one fatal line and hides the raw dump", async () => {
    const { stdout, stderr } = await runWatchedFixture({
      body: `process.stderr.write(${JSON.stringify(MISSING_EXPORT_DUMP)});\nprocess.exit(1);\n`,
    });
    assert.match(
      stderr,
      /"level":"fatal","msg":"missing export: module '@langwatch\/experiment-server' does not export 'createExperimentsRestApp' \(imported at apps\/api\/src\/index\.ts:180\)"/,
    );
    assert.doesNotMatch(stderr, /createExperimentsRestApp,/);
    assert.doesNotMatch(stdout, /createExperimentsRestApp,/);
  });

  /** @scenario "LANGWATCH_DEV_RAW_CRASH=1 shows the raw output instead of collapsing it" */
  it("given LANGWATCH_DEV_RAW_CRASH=1, forwards the raw dump unchanged instead of collapsing it", async () => {
    const { stderr } = await runWatchedFixture({
      body: `process.stderr.write(${JSON.stringify(MISSING_EXPORT_DUMP)});\nprocess.exit(1);\n`,
      env: { LANGWATCH_DEV_RAW_CRASH: "1" },
    });
    assert.match(stderr, /createExperimentsRestApp,/);
    assert.doesNotMatch(stderr, /"level":"fatal","msg":"missing export:/);
  });
});
