#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Generate config overrides for native oxlint rules (`max-depth`, `complexity`,
// `no-nested-ternary`) that cannot read `oxlint-baseline.json`. Run after editing
// baseline and paste output into `dev/lint/oxlint.baseline.jsonc`'s `overrides` array.
//
// node packages/architecture-enforcer/src/generate-native-baseline-overrides.mjs

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const baselinePath = join(root, "packages/architecture-enforcer/src/oxlint-baseline.json");

const NATIVE_RULES = ["max-depth", "complexity", "no-nested-ternary"];

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
