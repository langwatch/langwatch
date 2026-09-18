import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { ArchitectureViolation, ClassifiedPackage, PackageManifest } from "../../types.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";

function exportKeys(exportsValue: unknown): string[] {
  if (!exportsValue || typeof exportsValue !== "object" || Array.isArray(exportsValue)) {
    return [];
  }

  return Object.keys(exportsValue as Record<string, unknown>);
}

type WorkspaceCatalogs = {
  readonly catalog: Readonly<Record<string, string>>;
  readonly catalogs: Readonly<Record<string, Readonly<Record<string, string>>>>;
};

const EMPTY_CATALOGS: WorkspaceCatalogs = { catalog: {}, catalogs: {} };

type CatalogSection = "catalog" | "catalogs" | "other";

/** Which block a top-level (unindented) line opens. */
function topLevelSection(line: string): CatalogSection {
  if (/^catalog:\s*$/.test(line)) return "catalog";

  if (/^catalogs:\s*$/.test(line)) return "catalogs";

  return "other";
}

/** A `catalog:` entry line: two-space indent, `name: range`. */
function applyCatalogLine(line: string, catalog: Record<string, string>): void {
  const entry = /^ {2}(['"]?)([^'":\s]+)\1:\s*(\S.*)$/.exec(line);
  if (entry) catalog[entry[2]!] = entry[3]!.trim();
}

/**
 * A `catalogs:` line: either a two-space-indent named-catalog header, or a
 * four-space-indent `name: range` entry under the most recent header.
 */
function applyCatalogsLine(
  line: string,
  catalogs: Record<string, Record<string, string>>,
  namedCatalog: string | undefined,
): string | undefined {
  const header = /^ {2}(['"]?)([^'":\s]+)\1:\s*$/.exec(line);

  if (header) {
    const name = header[2]!;
    catalogs[name] ??= {};

    return name;
  }

  const entry = /^ {4}(['"]?)([^'":\s]+)\1:\s*(\S.*)$/.exec(line);
  if (entry && namedCatalog) catalogs[namedCatalog]![entry[2]!] = entry[3]!.trim();

  return namedCatalog;
}

/**
 * Hand-parsed, matching `workspaceGlobs` in `workspace/tsconfig-references.ts`:
 * the `catalog:`/`catalogs:` blocks are a flat two/four-space-indented map, so
 * reading them by hand keeps this policy free of a YAML dependency.
 */
function parseWorkspaceCatalogs(text: string): WorkspaceCatalogs {
  const catalog: Record<string, string> = {};
  const catalogs: Record<string, Record<string, string>> = {};

  let section: CatalogSection = "other";
  let namedCatalog: string | undefined;

  for (const line of text.split("\n")) {
    if (/^\s*#/.test(line) || line.trim() === "") continue;

    if (/^\S/.test(line)) {
      section = topLevelSection(line);
      namedCatalog = void 0;
      continue;
    }

    if (section === "catalog") applyCatalogLine(line, catalog);

    if (section === "catalogs") namedCatalog = applyCatalogsLine(line, catalogs, namedCatalog);
  }

  return { catalog, catalogs };
}

const workspaceCatalogsByRoot = new Map<string, WorkspaceCatalogs>();

function readWorkspaceCatalogs(root: string): WorkspaceCatalogs {
  const cached = workspaceCatalogsByRoot.get(root);
  if (cached) return cached;

  const file = join(root, "pnpm-workspace.yaml");

  const parsed = existsSync(file)
    ? parseWorkspaceCatalogs(readFileSync(file, "utf8"))
    : EMPTY_CATALOGS;

  workspaceCatalogsByRoot.set(root, parsed);

  return parsed;
}

/**
 * Resolves pnpm's `catalog:`/`catalog:<name>` protocol to the range it names
 * in `pnpm-workspace.yaml`; any other declared value (an explicit range, or
 * `undefined`) passes through untouched.
 */
function resolveCatalogRange({
  root,
  dependency,
  value,
}: {
  root: string;
  dependency: string;
  value: string | undefined;
}): string | undefined {
  if (value === void 0 || !value.startsWith("catalog:")) return value;

  const { catalog, catalogs } = readWorkspaceCatalogs(root);
  const name = value.slice("catalog:".length);

  return name === "" ? catalog[dependency] : catalogs[name]?.[dependency];
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

  return Boolean(target.enterprise && target.feature && target.kind === "process");
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
function zodRuntimeViolation(
  pkg: ClassifiedPackage,
  root: string,
): ArchitectureViolation | undefined {
  if (!pkg.feature) return undefined;

  const zodVersion = manifestDependencies(pkg.manifest).zod;
  const requiresZod = pkg.kind === "contract";
  const mustDeclareZod4 = requiresZod || zodVersion !== void 0;
  const resolvedZodRange = resolveCatalogRange({ root, dependency: "zod", value: zodVersion });
  if (!mustDeclareZod4 || isZod4Range(resolvedZodRange)) return undefined;

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
  if (pkg.kind !== "browser" || target.kind !== "process") return undefined;

  return {
    policy: "package-role",
    file: pkg.manifestPath,
    specifier: dependency,
    message: "A browser package cannot depend on a feature process package.",
  };
};

const serverWebCheck: DependencyCheck = (pkg, target, dependency) => {
  if (pkg.kind !== "process" || target.kind !== "browser") return undefined;

  return {
    policy: "package-role",
    file: pkg.manifestPath,
    specifier: dependency,
    message: "A process package cannot depend on a feature browser package.",
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
    const runCheck = () => {
      const violation = check(pkg, target, dependency);

      return violation ? [violation] : [];
    };

    if (check !== crossFeatureCheck) return runCheck();

    if (pkg.kind !== "browser") return runCheck();

    if (target.kind !== "browser") return runCheck();

    if (!allowedWebDependencies.has(`${pkg.name}->${target.name}`)) return runCheck();

    return [];
  });

  return runtimeViolation ? [runtimeViolation, ...targetViolations] : targetViolations;
}

/** Every violation for one package: its exports, its Zod runtime, and each declared dependency. */
function violationsForManifest(
  pkg: ClassifiedPackage,
  byName: Map<string, ClassifiedPackage>,
  allowedWebDependencies: ReadonlySet<string>,
  root: string,
): ArchitectureViolation[] {
  const zodViolation = zodRuntimeViolation(pkg, root);
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

  return packages.flatMap((pkg) =>
    violationsForManifest(pkg, byName, allowedWebDependencies, snapshot.root),
  );
}

export function exportedSubpaths(pkg: ClassifiedPackage): Set<string> {
  return new Set(exportKeys(pkg.manifest.exports));
}
