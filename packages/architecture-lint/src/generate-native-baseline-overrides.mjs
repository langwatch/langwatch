#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// `max-depth` and `complexity` are native oxlint rules: they cannot read
// `oxlint-baseline.json` the way a `defineRule` plugin rule does, so they
// still need a config override. This generates the two overrides -- one file
// list per rule, both fully "off" -- from the baseline file, so the file
// list is produced, not hand-maintained. Run after editing the baseline:
//
//   node packages/architecture-lint/src/generate-native-baseline-overrides.mjs
//
// and paste the two objects it prints into `.oxlintrc.architecture.json`'s
// `overrides` array, replacing the previous generated pair.

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const baselinePath = join(root, "packages/architecture-lint/src/oxlint-baseline.json");

const NATIVE_RULES = ["max-depth", "complexity"];

function overrideFor(rule, files) {
  return {
    files: [...files].sort(),
    rules: { [rule]: "off" },
  };
}

export function generateNativeBaselineOverrides(baselineDocument) {
  const filesByRule = new Map(NATIVE_RULES.map((rule) => [rule, new Set()]));
  for (const entry of baselineDocument.entries) {
    const separator = entry.key.indexOf("|");
    const rule = entry.key.slice(0, separator);
    const file = entry.key.slice(separator + 1);
    if (filesByRule.has(rule)) filesByRule.get(rule).add(file);
  }

  return NATIVE_RULES.map((rule) => overrideFor(rule, filesByRule.get(rule)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const overrides = generateNativeBaselineOverrides(baseline);
  process.stdout.write(overrides.map((o) => JSON.stringify(o, null, 2)).join(",\n") + "\n");
}
