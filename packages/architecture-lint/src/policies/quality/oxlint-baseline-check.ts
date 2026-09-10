import { resolve } from "node:path";
import {
  type BaselineEntry,
  type BaselinePolicy,
  baselinePath,
  readBaseline,
  shrinkCheck,
} from "../../baseline.ts";
import type { ArchitectureViolation } from "../../types.ts";

/**
 * The debt register for the oxlint rules that read `oxlint-baseline.json`.
 * The linter itself decides what still fires, so this side validates the file
 * and refuses growth against the merge base; a stale row is reported where the
 * rules run, not here.
 */
const BASELINE_FILE = "oxlint-baseline.json";

/** The rule half of a `<rule>|<file>` key. */
function ruleOf(key: string): string | undefined {
  const separator = key.indexOf("|");

  return separator === -1 ? void 0 : key.slice(0, separator);
}

export const OXLINT_BASELINE: BaselinePolicy = {
  id: "oxlint",
  file: BASELINE_FILE,
  label: "oxlint baseline",
  keyRule: "A key is `<rule>|<file>`.",
  enforceExpiry: false,
  stale: (entry) => ({
    message: `oxlint baseline entry ${entry.key} no longer fires and must be removed.`,
    allowed: "Delete the stale entry; the register only shrinks.",
  }),
  growth: {
    added: (entry) => ({
      message: `Baseline entry ${entry.key} is not in the merge base; the oxlint baseline is shrink-only.`,
      allowed: "Fix the offending file and remove it from the baseline; do not add new entries.",
    }),
    seeds: (entry, reference) => {
      const rule = ruleOf(entry.key);

      return rule !== void 0 && !reference.some((known) => ruleOf(known.key) === rule);
    },
  },
};

export function oxlintBaselineFile(root: string): string {
  return baselinePath({ root, policy: OXLINT_BASELINE });
}

export function readOxlintBaseline(file: string): {
  exists: boolean;
  entries: BaselineEntry[];
  violations: ArchitectureViolation[];
} {
  return readBaseline({ policy: OXLINT_BASELINE, file });
}

export function lintOxlintBaseline(
  root: string,
  baselineReference?: string,
): { violations: ArchitectureViolation[] } {
  const file = oxlintBaselineFile(root);
  const current = readBaseline({ policy: OXLINT_BASELINE, file });

  if (!baselineReference) return { violations: current.violations };

  const reference = readBaseline({
    policy: OXLINT_BASELINE,
    file: resolve(root, baselineReference),
  });

  // No merge-base copy is the one-time bootstrap the other ratchets already
  // treat as such. Comparing against nothing would call every row an addition.
  if (!reference.exists) return { violations: current.violations };

  return {
    violations: [
      ...current.violations,
      ...reference.violations,
      ...shrinkCheck({
        current: current.entries,
        reference: reference.entries,
        policy: OXLINT_BASELINE,
        file,
      }),
    ],
  };
}
