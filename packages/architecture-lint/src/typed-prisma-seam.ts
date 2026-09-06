import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { ArchitectureViolation } from "./types";

/**
 * The typed Prisma seam.
 *
 * Two shapes were common in this repo before the seam was settled, and both
 * turned the strongest type in the composition path — the `PrismaClient` — into
 * an untyped `object` that was cast back a layer later. The pattern reads:
 *
 *   static create(database: object): X {
 *     return new X(database as PrismaClient);
 *   }
 *
 * Every one of them is a place where the composition root already held a real
 * `PrismaClient`, threw the type away to reach a repository through an adapter,
 * and had the repository claim the type back at the seam. It works, and it
 * hides a class of mistakes: a caller can hand an `object` that ISN'T a
 * `PrismaClient`, and the failure only shows up when a method is called.
 *
 * The settled shape: the composition passes its typed `PrismaClient` to the
 * Postgres adapter, which passes it to the repository, which uses it directly.
 * Nothing above the adapter needs to know a repository exists; nothing below
 * the adapter needs an untyped seam.
 *
 * This rule catches the two shapes that recreate the old convention:
 *   1. `as PrismaClient` cast anywhere in feature server source
 *   2. `database: object` on the parameter list of a `.create(` in an adapter
 *      or repository file
 *
 * Existing offenders are baselined; the file list is authoritative, and a new
 * file lands red until it stops casting.
 *
 * See `dev/docs/best_practices/service-repository-adapter-port.md` for the
 * shape this rule enforces.
 */
const BASELINE_FILE = "typed-prisma-seam-baseline.json";

const baselinePathSchema = z
  .string()
  .regex(/^packages\/(?:enterprise\/)?features\/[^/]+\/server\/src\/.+\.ts$/);

const baselineSchema = z
  .object({
    version: z.literal(0),
    files: z.array(baselinePathSchema),
  })
  .strict()
  .superRefine((baseline, context) => {
    const seen = new Set<string>();
    for (const [index, file] of baseline.files.entries()) {
      if (seen.has(file)) {
        context.addIssue({
          code: "custom",
          message: `duplicate baseline entry ${file}`,
          path: ["files", index],
        });
      }

      seen.add(file);
      const previous = baseline.files[index - 1];
      const comparison = previous?.localeCompare(file);
      if (index > 0 && !(comparison !== undefined && comparison < 0)) {
        context.addIssue({
          code: "custom",
          message: "typed-prisma-seam baseline must be sorted",
          path: ["files", index],
        });
      }
    }
  });

export function readTypedPrismaSeamBaselineFile(file: string): {
  exists: boolean;
  files: readonly string[];
  violations: ArchitectureViolation[];
} {
  if (!existsSync(file)) {
    return { exists: false, files: [], violations: [] };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return {
      exists: true,
      files: [],
      violations: [
        {
          policy: "typed-prisma-seam-baseline",
          file,
          message: `Typed Prisma seam baseline must be valid JSON: ${
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
      files: [],
      violations: [
        {
          policy: "typed-prisma-seam-baseline",
          file,
          message: `Typed Prisma seam baseline is invalid: ${reason}`,
        },
      ],
    };
  }

  return { exists: true, files: parsed.data.files, violations: [] };
}

function baselineFile(root: string): string {
  return join(root, "packages/architecture-lint/src", BASELINE_FILE);
}

export function lintTypedPrismaSeamBaseline(
  root: string,
  baselineReference?: string,
): { violations: ArchitectureViolation[] } {
  const current = readTypedPrismaSeamBaselineFile(baselineFile(root));
  if (!baselineReference) {
    return { violations: current.violations };
  }

  const reference = readTypedPrismaSeamBaselineFile(resolve(root, baselineReference));
  const referenceSet = new Set(reference.files);
  const violations: ArchitectureViolation[] = [...current.violations, ...reference.violations];
  for (const entry of current.files) {
    if (!referenceSet.has(entry)) {
      violations.push({
        policy: "typed-prisma-seam-baseline",
        file: baselineFile(root),
        message: `Baseline entry ${entry} is not in ${baselineReference}; the typed-Prisma-seam baseline is shrink-only.`,
        allowed:
          "Fix the offending file (see dev/docs/best_practices/service-repository-adapter-port.md) and remove it from the baseline; do not add new entries.",
      });
    }
  }

  return { violations };
}
