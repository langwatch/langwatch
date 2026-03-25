#!/usr/bin/env npx tsx
/**
 * Preview script for diff-based test selection.
 *
 * Shows which scenario tests would run based on the current git diff,
 * without actually executing them.
 *
 * Usage:
 *   pnpm test:select              # Show what would run
 *   EVALS_ALL=1 pnpm test:select  # Show that all tests would run
 *   EVALS_BASE=develop pnpm test:select  # Compare against a different branch
 */

import { TOUCHFILES, GLOBAL_TOUCHFILES } from "../helpers/touchfiles";
import {
  getChangedFiles,
  selectTests,
  buildGrepPattern,
} from "../helpers/test-selection";

const isEvalsAll = process.env.EVALS_ALL === "1";
const baseBranch = process.env.EVALS_BASE ?? "main";
const allTestNames = Object.keys(TOUCHFILES).sort();
const totalTests = allTestNames.length;

if (isEvalsAll) {
  console.log("EVALS_ALL=1: running all tests regardless of diff\n");
  console.log(`All tests (${totalTests}):`);
  for (const name of allTestNames) {
    console.log(`  \u2713 ${name}`);
  }
  console.log(`\nRun with: pnpm test:e2e`);
  process.exit(0);
}

const changedFiles = getChangedFiles(baseBranch);

console.log(`Base branch: ${baseBranch}`);
console.log(`Changed files: ${changedFiles.length}`);
for (const file of changedFiles) {
  console.log(`  ${file}`);
}
console.log();

const selected = selectTests(changedFiles, TOUCHFILES, GLOBAL_TOUCHFILES);
const skipped = totalTests - selected.length;

if (selected.length > 0) {
  console.log(`Selected tests (${selected.length} of ${totalTests}):`);
  for (const name of selected) {
    console.log(`  \u2713 ${name}`);
  }
} else {
  console.log(`Selected tests (0 of ${totalTests}): none`);
}

console.log(`\nSkipped tests: ${skipped} (no matching changes)`);

const grepPattern = buildGrepPattern(selected);
if (grepPattern) {
  console.log(`\nGrep pattern: ${grepPattern}`);
}

console.log(`\nRun with: pnpm test:e2e`);
console.log(`Override: EVALS_ALL=1 pnpm test:e2e`);
