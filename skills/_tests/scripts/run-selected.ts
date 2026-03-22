#!/usr/bin/env npx tsx
/**
 * Wrapper script that runs vitest with diff-based test selection.
 *
 * - EVALS_ALL=1: runs all tests (no grep filtering)
 * - Otherwise: computes changed files, selects affected tests, and passes --grep to vitest
 *
 * This script is invoked by `pnpm test:e2e` and per-agent scripts.
 * Extra arguments are forwarded to vitest (e.g., --reporter).
 */

import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { TOUCHFILES, GLOBAL_TOUCHFILES } from "../helpers/touchfiles";
import {
  getChangedFiles,
  selectTests,
  buildGrepPattern,
} from "../helpers/test-selection";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testsDir = path.resolve(__dirname, "..");

const isEvalsAll = process.env.EVALS_ALL === "1";
const extraArgs = process.argv.slice(2).join(" ");

if (isEvalsAll) {
  console.log("EVALS_ALL=1: running all tests regardless of diff\n");
  const cmd = `npx vitest run --exclude static-validation.test.ts ${extraArgs}`.trim();
  execSync(cmd, { stdio: "inherit", cwd: testsDir });
  process.exit(0);
}

const baseBranch = process.env.EVALS_BASE ?? "main";
const changedFiles = getChangedFiles(baseBranch);

console.log(`Diff-based selection (base: ${baseBranch})`);
console.log(`Changed files: ${changedFiles.length}`);

const selected = selectTests(changedFiles, TOUCHFILES, GLOBAL_TOUCHFILES);
const total = Object.keys(TOUCHFILES).length;

if (selected.length === 0) {
  console.log(
    `\nNo tests affected by the diff (0 of ${total}). Nothing to run.`
  );
  console.log("Override: EVALS_ALL=1 pnpm test:e2e");
  process.exit(0);
}

console.log(`Selected: ${selected.length} of ${total} tests\n`);

const grepPattern = buildGrepPattern(selected);
const cmd =
  `npx vitest run --exclude static-validation.test.ts --grep "${grepPattern}" ${extraArgs}`.trim();

execSync(cmd, { stdio: "inherit", cwd: testsDir });
