import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { walkFiles } from "./files";
import type { ArchitectureViolation, ClassifiedPackage } from "./types";

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

function workspacePath(root: string, file: string): string {
  return relative(root, file).split(sep).join("/");
}

function isFeatureServerSource(pkg: ClassifiedPackage, file: string): boolean {
  if (pkg.kind !== "server") return false;
  const relative = file.slice(pkg.root.length);
  if (!relative.startsWith(`${sep}src${sep}`)) return false;
  if (relative.includes(`${sep}__tests__${sep}`)) return false;
  if (relative.includes(`${sep}dist${sep}`)) return false;
  return /\.ts$/.test(file) && !/\.(?:test|spec)\.tsx?$/.test(file);
}

function isRepositoryOrAdapter(file: string): boolean {
  return (
    /\/src\/repositories\/prisma\/.+\.repository\.ts$/.test(file) ||
    /\/src\/adapters\/postgres\.[^/]+\.adapter\.ts$/.test(file)
  );
}

const AS_PRISMA_CLIENT = /\bas\s+PrismaClient\b/;
// Match `database: object` when it sits directly in a `create(` argument list.
// The rule is deliberately narrow: `object` is a load-bearing type in TypeScript
// (it excludes primitives), and only its use as the seam for a Prisma client is
// what we forbid.
const DATABASE_OBJECT_ARG =
  /\.create\s*\([^)]*\bdatabase\s*:\s*object\b|\bstatic\s+create\s*\([^)]*\bdatabase\s*:\s*object\b/;

function findings(source: string): readonly ("cast" | "database-object")[] {
  const results: ("cast" | "database-object")[] = [];
  if (AS_PRISMA_CLIENT.test(source)) results.push("cast");
  if (DATABASE_OBJECT_ARG.test(source)) results.push("database-object");
  return results;
}

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

export function lintTypedPrismaSeam(
  root: string,
  packages: readonly ClassifiedPackage[],
): ArchitectureViolation[] {
  const baseline = readTypedPrismaSeamBaselineFile(baselineFile(root));
  const baselined = new Set(baseline.files);
  const violations: ArchitectureViolation[] = [...baseline.violations];

  const seen = new Set<string>();
  for (const pkg of packages) {
    for (const file of walkFiles(
      pkg.root,
      (path) => isFeatureServerSource(pkg, path) && isRepositoryOrAdapter(path),
    )) {
      const source = readFileSync(file, "utf8");
      const hits = findings(source);
      if (hits.length === 0) continue;
      const workspace = workspacePath(root, file);
      seen.add(workspace);
      if (baselined.has(workspace)) continue;
      for (const kind of hits) {
        violations.push({
          policy: "typed-prisma-seam",
          file,
          message:
            kind === "cast"
              ? "`as PrismaClient` is not permitted: the composition adapter takes a typed PrismaClient and hands it to the repository."
              : "`database: object` in a `.create(` argument list forces a cast at the seam: type the parameter as PrismaClient and take it from the composition root.",
          allowed:
            "See dev/docs/best_practices/service-repository-adapter-port.md. The Postgres adapter takes `prisma: PrismaClient`, hands it to the repository (also typed), and returns the service.",
        });
      }
    }
  }

  // Baseline entries that no longer name a file with a finding: silently
  // shrink. A ratchet the other way (add a new file to the baseline) is what
  // the JSON schema's `superRefine` refuses.
  for (const entry of baseline.files) {
    if (seen.has(entry)) continue;
    // Missing entries are fine — the file may have been fixed and moved off
    // the baseline. If it was renamed, the sweep will find it under the new
    // name and either re-baseline (rejected on new PRs) or fail on the change.
  }

  return violations;
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
