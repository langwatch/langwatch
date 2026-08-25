import type { ArchitectureViolation, ClassifiedPackage, PackageManifest } from "./types";

function exportKeys(exportsValue: unknown): string[] {
  if (!exportsValue || typeof exportsValue !== "object" || Array.isArray(exportsValue)) {
    return [];
  }
  return Object.keys(exportsValue as Record<string, unknown>);
}

function isZod4Range(value: string | undefined): boolean {
  return value !== undefined && /(?:^|[^\d])4(?:\.|$)/.test(value);
}

function isEnterpriseRuntimeDependency(name: string): boolean {
  return [
    /^node:/,
    /^react(?:\/|$)/,
    /^react-dom(?:\/|$)/,
    /^@chakra-ui(?:\/|$)/,
    /^hono(?:\/|$)/,
    /^@hono(?:\/|$)/,
    /^@trpc(?:\/|$)/,
    /^@prisma(?:\/|$)/,
    /^@langwatch\/prisma-client(?:\/|$)/,
    /^@langwatch\/api(?:\/|$)/,
  ].some((pattern) => pattern.test(name));
}

function compatibleEnterpriseCompositionTarget(
  pkg: ClassifiedPackage,
  target: ClassifiedPackage,
): boolean {
  if (target.kind === "contract") return true;
  if (!target.enterprise || !target.feature) return false;
  if (pkg.enterpriseCompositionRole === "web") return target.kind === "web";
  return target.kind === "server";
}

function matchingEnterpriseComposition(
  pkg: ClassifiedPackage,
  target: ClassifiedPackage,
): boolean {
  if (target.kind !== "enterprise-composition") return true;
  if (pkg.kind !== "application") return false;
  if (pkg.applicationRole === "ui") {
    return target.enterpriseCompositionRole === "web";
  }
  if (pkg.applicationRole === "api") {
    return target.enterpriseCompositionRole === "api";
  }
  if (pkg.applicationRole === "worker") {
    return target.enterpriseCompositionRole === "worker";
  }
  return false;
}

export function manifestDependencies(manifest: PackageManifest): Record<string, string> {
  return {
    ...manifest.dependencies,
    ...manifest.peerDependencies,
    ...manifest.optionalDependencies,
  };
}

export function lintManifests(packages: ClassifiedPackage[]): ArchitectureViolation[] {
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

    if (pkg.feature) {
      const zodVersion = manifestDependencies(pkg.manifest).zod;
      const requiresZod = pkg.kind === "contract";
      if ((requiresZod || zodVersion !== undefined) && !isZod4Range(zodVersion)) {
        violations.push({
          policy: "retired-package-runtime",
          file: pkg.manifestPath,
          specifier: "zod",
          message: `Feature packages cannot use the retired Zod runtime; found ${JSON.stringify(zodVersion)}.`,
          allowed: 'Declare the repository Zod 4 range and import schemas from "zod".',
        });
      }
    }

    for (const dependency of Object.keys(manifestDependencies(pkg.manifest))) {
      const target = byName.get(dependency);
      if (pkg.kind === "enterprise-root" && isEnterpriseRuntimeDependency(dependency)) {
        violations.push({
          policy: "enterprise-composition",
          file: pkg.manifestPath,
          specifier: dependency,
          message:
            "The portable Enterprise catalogue cannot depend on runtime, transport, persistence, or UI packages.",
          allowed: "Depend only on portable feature contracts.",
        });
      }
      if (!target) continue;
      if (pkg.kind === "application" && target.kind === "application" && target !== pkg) {
        violations.push({
          policy: "application-boundary",
          file: pkg.manifestPath,
          specifier: dependency,
          message: `Application ${pkg.applicationRole} cannot depend on application ${target.applicationRole}.`,
          allowed:
            "Move reusable behaviour to its owning feature or infrastructure package.",
        });
      }
      if (
        target.kind === "enterprise-composition" &&
        !matchingEnterpriseComposition(pkg, target)
      ) {
        violations.push({
          policy: "enterprise-composition",
          file: pkg.manifestPath,
          specifier: dependency,
          message: `${pkg.name} cannot depend on the ${target.enterpriseCompositionRole} Enterprise composition package.`,
          allowed:
            pkg.kind === "application"
              ? `Use only the Enterprise composition matching apps/${pkg.applicationRole}.`
              : "Only the matching application composition root may consume this package.",
        });
      }
      if (
        pkg.kind === "enterprise-composition" &&
        target.kind === "enterprise-composition"
      ) {
        violations.push({
          policy: "enterprise-composition",
          file: pkg.manifestPath,
          specifier: dependency,
          message:
            "Enterprise API, worker, and web composition packages cannot depend on one another.",
        });
      }
      if (
        pkg.kind === "enterprise-composition" &&
        target.feature &&
        !compatibleEnterpriseCompositionTarget(pkg, target)
      ) {
        violations.push({
          policy: "enterprise-composition",
          file: pkg.manifestPath,
          specifier: dependency,
          message: `The ${pkg.enterpriseCompositionRole} Enterprise composition cannot import ${target.kind} surface ${target.name}.`,
          allowed:
            pkg.enterpriseCompositionRole === "web"
              ? "Depend only on portable contracts and Enterprise web surfaces."
              : `Depend only on portable contracts and Enterprise ${pkg.enterpriseCompositionRole} or server installers.`,
        });
      }
      if (pkg.kind === "enterprise-root" && target.kind !== "contract") {
        violations.push({
          policy: "enterprise-composition",
          file: pkg.manifestPath,
          specifier: dependency,
          message:
            "The portable Enterprise catalogue cannot depend on implementation or composition packages.",
          allowed: "Depend only on portable feature contracts.",
        });
      }
      if (
        !pkg.enterprise &&
        target.enterprise &&
        !(
          pkg.kind === "application" &&
          target.kind === "enterprise-composition" &&
          matchingEnterpriseComposition(pkg, target)
        )
      ) {
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
          message: "A contract package cannot depend on its implementation packages.",
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
