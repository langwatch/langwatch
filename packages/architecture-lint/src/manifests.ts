import type { WorkspaceSnapshot } from "./workspace/snapshot.ts";
import type { ArchitectureViolation, ClassifiedPackage, PackageManifest } from "./types.ts";

function exportKeys(exportsValue: unknown): string[] {
  if (!exportsValue || typeof exportsValue !== "object" || Array.isArray(exportsValue)) {
    return [];
  }

  return Object.keys(exportsValue as Record<string, unknown>);
}

function isZod4Range(value: string | undefined): boolean {
  return value !== void 0 && /(?:^|[^\d])4(?:\.|$)/.test(value);
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

function compatibleEnterpriseCompositionTarget(target: ClassifiedPackage): boolean {
  if (target.kind === "contract") return true;

  return Boolean(target.enterprise && target.feature && target.kind === "server");
}

function matchingEnterpriseComposition(pkg: ClassifiedPackage, target: ClassifiedPackage): boolean {
  if (target.kind !== "enterprise-composition") return true;

  if (pkg.kind !== "application") return false;

  return pkg.applicationRole === target.enterpriseCompositionRole;
}

export function manifestDependencies(manifest: PackageManifest): Record<string, string> {
  return {
    ...manifest.dependencies,
    ...manifest.peerDependencies,
    ...manifest.optionalDependencies,
  };
}

/** Violations for a package's own `exports` map: presence, and each key's shape. */
function exportViolations(pkg: ClassifiedPackage): ArchitectureViolation[] {
  const keys = exportKeys(pkg.manifest.exports);
  const violations: ArchitectureViolation[] = [];
  if (keys.length === 0) {
    violations.push({
      policy: "public-exports",
      file: pkg.manifestPath,
      message: "Package must declare an explicit exports map.",
    });
  }

  for (const key of keys) {
    const isUndeliberatePublicEntry =
      key.includes("*") || key === "./src" || key.startsWith("./src/");
    if (isUndeliberatePublicEntry) {
      violations.push({
        policy: "public-exports",
        file: pkg.manifestPath,
        specifier: key,
        message: `Export "${key}" is not a deliberate public entry point.`,
        allowed: "Name each supported capability explicitly.",
      });
    }

    if (/repositor|prisma/i.test(key)) {
      violations.push({
        policy: "public-exports",
        file: pkg.manifestPath,
        specifier: key,
        message: `Private implementation surface "${key}" cannot be exported.`,
      });
    }
  }

  return violations;
}

/** The retired-Zod-runtime violation for a feature package, or `undefined` when it is fine. */
function zodRuntimeViolation(pkg: ClassifiedPackage): ArchitectureViolation | undefined {
  if (!pkg.feature) return undefined;

  const zodVersion = manifestDependencies(pkg.manifest).zod;
  const requiresZod = pkg.kind === "contract";
  const mustDeclareZod4 = requiresZod || zodVersion !== void 0;
  if (!mustDeclareZod4 || isZod4Range(zodVersion)) return undefined;

  return {
    policy: "retired-package-runtime",
    file: pkg.manifestPath,
    specifier: "zod",
    message: `Feature packages cannot use the retired Zod runtime; found ${JSON.stringify(zodVersion)}.`,
    allowed: 'Declare the repository Zod 4 range and import schemas from "zod".',
  };
}

/** Enterprise-catalogue-runtime-dependency violation, regardless of whether the target resolves. */
function enterpriseRuntimeViolation(
  pkg: ClassifiedPackage,
  dependency: string,
): ArchitectureViolation | undefined {
  if (pkg.kind !== "enterprise-root" || !isEnterpriseRuntimeDependency(dependency))
    return undefined;

  return {
    policy: "enterprise-composition",
    file: pkg.manifestPath,
    specifier: dependency,
    message:
      "The portable Enterprise catalogue cannot depend on runtime, transport, persistence, or UI packages.",
    allowed: "Depend only on portable feature contracts.",
  };
}

type DependencyCheck = (
  pkg: ClassifiedPackage,
  target: ClassifiedPackage,
  dependency: string,
) => ArchitectureViolation | undefined;

const applicationBoundaryCheck: DependencyCheck = (pkg, target, dependency) => {
  if (pkg.kind !== "application" || target.kind !== "application" || target === pkg) {
    return undefined;
  }

  return {
    policy: "application-boundary",
    file: pkg.manifestPath,
    specifier: dependency,
    message: `Application ${pkg.applicationRole} cannot depend on application ${target.applicationRole}.`,
    allowed: "Move reusable behaviour to its owning feature or infrastructure package.",
  };
};

const enterpriseCompositionMismatchCheck: DependencyCheck = (pkg, target, dependency) => {
  if (target.kind !== "enterprise-composition" || matchingEnterpriseComposition(pkg, target)) {
    return undefined;
  }

  return {
    policy: "enterprise-composition",
    file: pkg.manifestPath,
    specifier: dependency,
    message: `${pkg.name} cannot depend on the ${target.enterpriseCompositionRole} Enterprise composition package.`,
    allowed:
      pkg.kind === "application"
        ? `Use only the Enterprise composition matching apps/${pkg.applicationRole}.`
        : "Only the matching application composition root may consume this package.",
  };
};

const enterpriseCompositionPairCheck: DependencyCheck = (pkg, target, dependency) => {
  if (pkg.kind !== "enterprise-composition" || target.kind !== "enterprise-composition") {
    return undefined;
  }

  return {
    policy: "enterprise-composition",
    file: pkg.manifestPath,
    specifier: dependency,
    message: "Enterprise API and worker composition packages cannot depend on one another.",
  };
};

const enterpriseCompositionTargetCheck: DependencyCheck = (pkg, target, dependency) => {
  const isIncompatibleTarget =
    pkg.kind === "enterprise-composition" &&
    target.feature &&
    !compatibleEnterpriseCompositionTarget(target);
  if (!isIncompatibleTarget) return undefined;

  return {
    policy: "enterprise-composition",
    file: pkg.manifestPath,
    specifier: dependency,
    message: `The ${pkg.enterpriseCompositionRole} Enterprise composition cannot import ${target.kind} surface ${target.name}.`,
    allowed: `Depend only on portable contracts and Enterprise ${pkg.enterpriseCompositionRole} or server installers.`,
  };
};

const enterpriseRootTargetCheck: DependencyCheck = (pkg, target, dependency) => {
  if (pkg.kind !== "enterprise-root" || target.kind === "contract") return undefined;

  return {
    policy: "enterprise-composition",
    file: pkg.manifestPath,
    specifier: dependency,
    message:
      "The portable Enterprise catalogue cannot depend on implementation or composition packages.",
    allowed: "Depend only on portable feature contracts.",
  };
};

const enterpriseDirectionCheck: DependencyCheck = (pkg, target, dependency) => {
  const isMatchingApplicationComposition =
    pkg.kind === "application" &&
    target.kind === "enterprise-composition" &&
    matchingEnterpriseComposition(pkg, target);
  const crossesIntoEnterprise =
    !pkg.enterprise && target.enterprise && !isMatchingApplicationComposition;
  if (!crossesIntoEnterprise) return undefined;

  return {
    policy: "enterprise-direction",
    file: pkg.manifestPath,
    specifier: dependency,
    message: "A core package cannot depend on an enterprise package.",
  };
};

const crossFeatureCheck: DependencyCheck = (pkg, target, dependency) => {
  const isForeignFeature = pkg.feature !== target.feature;
  const isImplementationTarget = target.kind !== "contract";
  const hasFeaturePair = pkg.feature && target.feature;
  if (!hasFeaturePair || !isForeignFeature || !isImplementationTarget) return undefined;

  return {
    policy: "cross-feature",
    file: pkg.manifestPath,
    specifier: dependency,
    message: `Feature "${pkg.feature}" cannot depend on ${target.kind} package "${target.name}".`,
    allowed: `Depend on ${target.enterprise ? `@langwatch/enterprise-${target.feature}-contract` : `@langwatch/${target.feature}-contract`}.`,
  };
};

const contractImplementationCheck: DependencyCheck = (pkg, target, dependency) => {
  const dependsOnOwnImplementation =
    pkg.kind === "contract" && target.feature === pkg.feature && target.kind !== "contract";
  if (!dependsOnOwnImplementation) return undefined;

  return {
    policy: "package-role",
    file: pkg.manifestPath,
    specifier: dependency,
    message: "A contract package cannot depend on its implementation packages.",
  };
};

const webServerCheck: DependencyCheck = (pkg, target, dependency) => {
  if (pkg.kind !== "web" || target.kind !== "server") return undefined;

  return {
    policy: "package-role",
    file: pkg.manifestPath,
    specifier: dependency,
    message: "A web package cannot depend on a feature server package.",
  };
};

const serverWebCheck: DependencyCheck = (pkg, target, dependency) => {
  if (pkg.kind !== "server" || target.kind !== "web") return undefined;

  return {
    policy: "package-role",
    file: pkg.manifestPath,
    specifier: dependency,
    message: "A server package cannot depend on a feature web package.",
  };
};

const DEPENDENCY_TARGET_CHECKS: DependencyCheck[] = [
  applicationBoundaryCheck,
  enterpriseCompositionMismatchCheck,
  enterpriseCompositionPairCheck,
  enterpriseCompositionTargetCheck,
  enterpriseRootTargetCheck,
  enterpriseDirectionCheck,
  crossFeatureCheck,
  contractImplementationCheck,
  webServerCheck,
  serverWebCheck,
];

/** Violations for one declared dependency of a package, given the package index by name. */
function dependencyViolations(
  pkg: ClassifiedPackage,
  dependency: string,
  byName: Map<string, ClassifiedPackage>,
  allowedWebDependencies: ReadonlySet<string>,
): ArchitectureViolation[] {
  const runtimeViolation = enterpriseRuntimeViolation(pkg, dependency);
  const target = byName.get(dependency);
  if (!target) return runtimeViolation ? [runtimeViolation] : [];

  const targetViolations = DEPENDENCY_TARGET_CHECKS.flatMap((check) => {
    if (
      check === crossFeatureCheck &&
      pkg.kind === "web" &&
      target.kind === "web" &&
      allowedWebDependencies.has(`${pkg.name}->${target.name}`)
    ) {
      return [];
    }

    const violation = check(pkg, target, dependency);
    return violation ? [violation] : [];
  });

  return runtimeViolation ? [runtimeViolation, ...targetViolations] : targetViolations;
}

/** Every violation for one package: its exports, its Zod runtime, and each declared dependency. */
function violationsForManifest(
  pkg: ClassifiedPackage,
  byName: Map<string, ClassifiedPackage>,
  allowedWebDependencies: ReadonlySet<string>,
): ArchitectureViolation[] {
  const zodViolation = zodRuntimeViolation(pkg);
  const dependencies = Object.keys(manifestDependencies(pkg.manifest));

  return [
    ...exportViolations(pkg),
    ...(zodViolation ? [zodViolation] : []),
    ...dependencies.flatMap((dependency) =>
      dependencyViolations(pkg, dependency, byName, allowedWebDependencies),
    ),
  ];
}

export function lintManifests(
  snapshot: WorkspaceSnapshot,
  allowedWebDependencies: ReadonlySet<string> = new Set(),
): ArchitectureViolation[] {
  const packages = snapshot.packages;

  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));

  return packages.flatMap((pkg) => violationsForManifest(pkg, byName, allowedWebDependencies));
}

export function exportedSubpaths(pkg: ClassifiedPackage): Set<string> {
  return new Set(exportKeys(pkg.manifest.exports));
}
