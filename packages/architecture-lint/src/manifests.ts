import type {
  ArchitectureViolation,
  ClassifiedPackage,
  PackageManifest,
} from "./types";

function exportKeys(exportsValue: unknown): string[] {
  if (
    !exportsValue ||
    typeof exportsValue !== "object" ||
    Array.isArray(exportsValue)
  ) {
    return [];
  }
  return Object.keys(exportsValue as Record<string, unknown>);
}

function isZod4Range(value: string | undefined): boolean {
  return value !== undefined && /(?:^|[^\d])4(?:\.|$)/.test(value);
}

export function manifestDependencies(
  manifest: PackageManifest,
): Record<string, string> {
  return {
    ...manifest.dependencies,
    ...manifest.peerDependencies,
    ...manifest.optionalDependencies,
  };
}

export function lintManifests(
  packages: ClassifiedPackage[],
): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));

  for (const pkg of packages) {
    const keys = exportKeys(pkg.manifest.exports);
    if (keys.length === 0) {
      violations.push({
        policy: "public-exports",
        file: pkg.manifestPath,
        message: "Package must declare an explicit exports map.",
      });
    }
    for (const key of keys) {
      if (key.includes("*") || key === "./src" || key.startsWith("./src/")) {
        violations.push({
          policy: "public-exports",
          file: pkg.manifestPath,
          specifier: key,
          message: `Export \"${key}\" is not a deliberate public entry point.`,
          allowed: "Name each supported capability explicitly.",
        });
      }
      if (/repositor|prisma/i.test(key)) {
        violations.push({
          policy: "public-exports",
          file: pkg.manifestPath,
          specifier: key,
          message: `Private implementation surface \"${key}\" cannot be exported.`,
        });
      }
    }

    if (pkg.kind === "contract") {
      const zodVersion = manifestDependencies(pkg.manifest).zod;
      if (!isZod4Range(zodVersion)) {
        violations.push({
          policy: "schema-runtime",
          file: pkg.manifestPath,
          specifier: "zod",
          message: `Feature contracts must use Zod 4; found ${JSON.stringify(zodVersion)}.`,
          allowed: 'Declare "zod": "^4.4.3" and import schemas from "zod".',
        });
      }
    }

    for (const dependency of Object.keys(manifestDependencies(pkg.manifest))) {
      const target = byName.get(dependency);
      if (!target) continue;
      if (!pkg.enterprise && target.enterprise) {
        violations.push({
          policy: "enterprise-direction",
          file: pkg.manifestPath,
          specifier: dependency,
          message: "A core package cannot depend on an enterprise package.",
        });
      }
      if (
        pkg.feature &&
        target.feature &&
        pkg.feature !== target.feature &&
        target.kind !== "contract"
      ) {
        violations.push({
          policy: "cross-feature",
          file: pkg.manifestPath,
          specifier: dependency,
          message: `Feature \"${pkg.feature}\" cannot depend on ${target.kind} package \"${target.name}\".`,
          allowed: `Depend on ${target.enterprise ? `@langwatch/enterprise-${target.feature}-contract` : `@langwatch/${target.feature}-contract`}.`,
        });
      }
      if (
        pkg.kind === "contract" &&
        target.feature === pkg.feature &&
        target.kind !== "contract"
      ) {
        violations.push({
          policy: "package-role",
          file: pkg.manifestPath,
          specifier: dependency,
          message:
            "A contract package cannot depend on its implementation packages.",
        });
      }
      if (pkg.kind === "web" && target.kind === "server") {
        violations.push({
          policy: "package-role",
          file: pkg.manifestPath,
          specifier: dependency,
          message: "A web package cannot depend on a feature server package.",
        });
      }
      if (pkg.kind === "server" && target.kind === "web") {
        violations.push({
          policy: "package-role",
          file: pkg.manifestPath,
          specifier: dependency,
          message: "A server package cannot depend on a feature web package.",
        });
      }
    }
  }

  return violations;
}

export function exportedSubpaths(pkg: ClassifiedPackage): Set<string> {
  return new Set(exportKeys(pkg.manifest.exports));
}
