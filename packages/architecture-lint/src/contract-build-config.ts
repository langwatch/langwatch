import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { ArchitectureViolation, ClassifiedPackage } from "./types";

const buildConfigSchema = z
  .object({
    compilerOptions: z
      .object({
        rootDir: z.unknown().optional(),
      })
      .passthrough()
      .optional(),
    include: z.unknown().optional(),
    exclude: z.unknown().optional(),
  })
  .passthrough();

function sourceOnlyInclude(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((pattern) => typeof pattern === "string" && pattern.startsWith("src/"))
  );
}

function excludesTests(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.some((pattern) => typeof pattern === "string" && pattern.startsWith("tests"))
  );
}

/**
 * Declaration builds for strict contracts are source-only programs.
 * A test file entering one reintroduces TS5011 when a package has tests outside src.
 */
export function lintStrictContractBuildConfigs(
  _root: string,
  packages: ClassifiedPackage[],
): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  for (const pkg of packages) {
    if (pkg.kind !== "contract" || pkg.layoutVersion !== 0) {
      continue;
    }

    const file = join(pkg.root, "tsconfig.build.json");
    const hasBuildScript = typeof pkg.manifest.scripts?.build === "string";
    if (!hasBuildScript && !existsSync(file)) {
      continue;
    }

    if (!existsSync(file)) {
      violations.push({
        policy: "contract-build-config",
        file,
        message: "Strict contract declaration build config is missing.",
      });
      continue;
    }

    let rawConfig: unknown;
    try {
      rawConfig = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      violations.push({
        policy: "contract-build-config",
        file,
        message: "Strict contract declaration build config must be valid JSON.",
      });
      continue;
    }

    const result = buildConfigSchema.safeParse(rawConfig);
    if (!result.success) {
      violations.push({
        policy: "contract-build-config",
        file,
        message: "Strict contract declaration build config must be a JSON object.",
      });
      continue;
    }

    const config = result.data;
    if (
      config.compilerOptions?.rootDir !== "src" ||
      !sourceOnlyInclude(config.include) ||
      !excludesTests(config.exclude)
    ) {
      violations.push({
        policy: "contract-build-config",
        file,
        message:
          "Strict contract declaration builds require rootDir src, source-only include, and an explicit tests exclusion.",
        allowed: "Keep declaration builds independent from package test roots.",
      });
    }
  }

  return violations;
}
