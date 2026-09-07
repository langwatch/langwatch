import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { ArchitectureViolation, ClassifiedPackage } from "./types.ts";

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
    value.some(
      (pattern) =>
        typeof pattern === "string" && /^(?:\*\*\/)?tests(?:\/\*\*(?:\/\*)?)?$/.test(pattern),
    )
  );
}

/** One violation for a strict-contract package's build config, or `undefined` when it is fine. */
function violationForPackage(pkg: ClassifiedPackage): ArchitectureViolation | undefined {
  if (pkg.kind !== "contract" || pkg.layoutVersion !== 0) return undefined;

  const file = join(pkg.root, "tsconfig.build.json");
  const hasBuildScript = typeof pkg.manifest.scripts?.build === "string";
  if (!hasBuildScript && !existsSync(file)) return undefined;

  if (!existsSync(file)) {
    return {
      policy: "contract-build-config",
      file,
      message: "Strict contract declaration build config is missing.",
    };
  }

  let rawConfig: unknown;
  try {
    rawConfig = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {
      policy: "contract-build-config",
      file,
      message: "Strict contract declaration build config must be valid JSON.",
    };
  }

  const result = buildConfigSchema.safeParse(rawConfig);

  if (!result.success) {
    return {
      policy: "contract-build-config",
      file,
      message: "Strict contract declaration build config must be a JSON object.",
    };
  }

  const config = result.data;
  const isSourceOnlyBuild =
    config.compilerOptions?.rootDir === "src" &&
    sourceOnlyInclude(config.include) &&
    excludesTests(config.exclude);
  if (isSourceOnlyBuild) return undefined;

  return {
    policy: "contract-build-config",
    file,
    message:
      "Strict contract declaration builds require rootDir src, source-only include, and an explicit tests exclusion.",
    allowed: "Keep declaration builds independent from package test roots.",
  };
}

/**
 * Declaration builds for strict contracts are source-only programs.
 * A test file entering one reintroduces TS5011 when a package has tests outside src.
 */
export function lintStrictContractBuildConfigs(
  _root: string,
  packages: ClassifiedPackage[],
): ArchitectureViolation[] {
  return packages.flatMap((pkg) => {
    const violation = violationForPackage(pkg);

    return violation ? [violation] : [];
  });
}
