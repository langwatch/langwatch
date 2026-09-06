import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { ArchitectureViolation } from "./types.ts";

/**
 * The debt register for the oxlint rules that read `oxlint-baseline.json`
 * directly (`cognitive-complexity`, `condition-shape`, `nested-ternary`) and
 * the two native rules a generated config override still carries for
 * (`max-depth`, `complexity`). One entry per exempted file, keyed `rule|file`
 * with a `measured` date -- an entry missing one is refused, exactly as
 * `typed-prisma-seam-baseline.json` refuses an unsorted or duplicate file.
 *
 * Shrink-only against the merge base, same pattern as
 * `lintTypedPrismaSeamBaseline`: a file may leave the baseline (fixed) but
 * never join it silently.
 */
const BASELINE_FILE = "oxlint-baseline.json";

const baselineEntrySchema = z
  .object({
    key: z.string().regex(/^[a-z-]+\|.+$/),
    measured: z.string().min(1),
  })
  .strict();

const baselineSchema = z
  .object({
    version: z.literal(0),
    entries: z.array(baselineEntrySchema),
  })
  .strict()
  .superRefine((baseline, context) => {
    const seen = new Set<string>();
    for (const [index, entry] of baseline.entries.entries()) {
      if (seen.has(entry.key)) {
        context.addIssue({
          code: "custom",
          message: `duplicate baseline entry ${entry.key}`,
          path: ["entries", index],
        });
      }

      seen.add(entry.key);
      const previous = baseline.entries[index - 1];
      if (index > 0 && !(previous !== undefined && previous.key < entry.key)) {
        context.addIssue({
          code: "custom",
          message: "oxlint baseline must be sorted",
          path: ["entries", index],
        });
      }
    }
  });

export function readOxlintBaselineFile(file: string): {
  exists: boolean;
  keys: readonly string[];
  violations: ArchitectureViolation[];
} {
  if (!existsSync(file)) {
    return { exists: false, keys: [], violations: [] };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return {
      exists: true,
      keys: [],
      violations: [
        {
          policy: "oxlint-baseline",
          file,
          message: `oxlint baseline must be valid JSON: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      ],
    };
  }

  const parsed = baselineSchema.safeParse(raw);
  if (!parsed.success) {
    const reason = parsed.error.issues.at(0)?.message ?? "invalid baseline";

    return {
      exists: true,
      keys: [],
      violations: [
        {
          policy: "oxlint-baseline",
          file,
          message: `oxlint baseline is invalid: ${reason}`,
        },
      ],
    };
  }

  return { exists: true, keys: parsed.data.entries.map((entry) => entry.key), violations: [] };
}

function baselineFile(root: string): string {
  return join(root, "packages/architecture-lint/src", BASELINE_FILE);
}

export function lintOxlintBaseline(
  root: string,
  baselineReference?: string,
): { violations: ArchitectureViolation[] } {
  const current = readOxlintBaselineFile(baselineFile(root));
  if (!baselineReference) {
    return { violations: current.violations };
  }

  const reference = readOxlintBaselineFile(resolve(root, baselineReference));
  const referenceSet = new Set(reference.keys);
  const violations: ArchitectureViolation[] = [...current.violations, ...reference.violations];
  for (const key of current.keys) {
    if (!referenceSet.has(key)) {
      violations.push({
        policy: "oxlint-baseline",
        file: baselineFile(root),
        message: `Baseline entry ${key} is not in ${baselineReference}; the oxlint baseline is shrink-only.`,
        allowed: "Fix the offending file and remove it from the baseline; do not add new entries.",
      });
    }
  }

  return { violations };
}
