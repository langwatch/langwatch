import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type {
  ArchitectureViolation,
  ClassifiedPackage,
  FeatureLayoutVersion,
  FeaturePackageRole,
  PackageManifest,
} from "./types";

const FEATURE_ROLES = new Set<FeaturePackageRole>([
  "contract",
  "server",
  "web",
]);

function readManifest(path: string): PackageManifest {
  return JSON.parse(readFileSync(path, "utf8")) as PackageManifest;
}

function readLayoutVersion(
  featureRoot: string,
  violations: ArchitectureViolation[],
): FeatureLayoutVersion | undefined {
  const path = join(featureRoot, "feature.json");
  if (!existsSync(path)) {
    violations.push({
      policy: "feature-source-layout",
      file: path,
      message:
        "Feature ownership roots must declare a layoutVersion in feature.json.",
      allowed: "Use layoutVersion 0, the initial strict feature layout.",
    });
    return undefined;
  }

  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    violations.push({
      policy: "feature-source-layout",
      file: path,
      message: `feature.json must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    });
    return undefined;
  }

  const layoutVersion =
    typeof value === "object" && value !== null && "layoutVersion" in value
      ? (value as { layoutVersion?: unknown }).layoutVersion
      : undefined;
  if (layoutVersion !== 0) {
    violations.push({
      policy: "feature-source-layout",
      file: path,
      message: `Unsupported feature layoutVersion ${JSON.stringify(layoutVersion)}.`,
      allowed: "The only supported version is 0, the initial strict layout.",
    });
    return undefined;
  }
  return layoutVersion;
}

function directories(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function discoverClassifiedPackages(root: string): {
  packages: ClassifiedPackage[];
  violations: ArchitectureViolation[];
} {
  const packages: ClassifiedPackage[] = [];
  const violations: ArchitectureViolation[] = [];

  const discoverFeatures = (featuresRoot: string, enterprise: boolean) => {
    for (const feature of directories(featuresRoot)) {
      const featureRoot = join(featuresRoot, feature);
      const layoutVersion = readLayoutVersion(featureRoot, violations);
      const featureManifest = join(featureRoot, "package.json");
      if (existsSync(featureManifest)) {
        violations.push({
          policy: "feature-layout",
          file: featureManifest,
          message: "A feature ownership directory cannot itself be a package.",
          allowed: "Put package.json inside contract, server, or web.",
        });
      }

      for (const roleName of directories(featureRoot)) {
        const manifestPath = join(featureRoot, roleName, "package.json");
        if (!existsSync(manifestPath)) continue;
        if (!FEATURE_ROLES.has(roleName as FeaturePackageRole)) {
          violations.push({
            policy: "feature-layout",
            file: manifestPath,
            message: `Unknown feature package role \"${roleName}\".`,
            allowed:
              "Use contract, server, or web; documentation belongs at the feature root.",
          });
          continue;
        }

        const role = roleName as FeaturePackageRole;
        const manifest = readManifest(manifestPath);
        const expectedName = enterprise
          ? `@langwatch/enterprise-${feature}-${role}`
          : `@langwatch/${feature}-${role}`;
        if (manifest.name !== expectedName) {
          violations.push({
            policy: "feature-layout",
            file: manifestPath,
            message: `Package name must be \"${expectedName}\", found ${JSON.stringify(manifest.name)}.`,
          });
        }
        packages.push({
          name: manifest.name ?? expectedName,
          root: join(featureRoot, role),
          manifestPath,
          manifest,
          kind: role,
          feature,
          featureRoot,
          layoutVersion,
          enterprise,
        });
      }
    }
  };

  discoverFeatures(join(root, "packages", "features"), false);
  discoverFeatures(join(root, "packages", "enterprise", "features"), true);

  const designSystemRoot = join(root, "packages", "design-system");
  const designSystemManifest = join(designSystemRoot, "package.json");
  if (existsSync(designSystemManifest)) {
    const manifest = readManifest(designSystemManifest);
    if (manifest.name !== "@langwatch/design-system") {
      violations.push({
        policy: "feature-layout",
        file: designSystemManifest,
        message:
          'The design-system package must be named "@langwatch/design-system".',
      });
    }
    packages.push({
      name: manifest.name ?? "@langwatch/design-system",
      root: designSystemRoot,
      manifestPath: designSystemManifest,
      manifest,
      kind: "design-system",
      enterprise: false,
    });
  }

  const architectureLintRoot = join(root, "packages", "architecture-lint");
  const architectureLintManifest = join(architectureLintRoot, "package.json");
  if (existsSync(architectureLintManifest)) {
    const manifest = readManifest(architectureLintManifest);
    packages.push({
      name: manifest.name ?? "@langwatch/architecture-lint",
      root: architectureLintRoot,
      manifestPath: architectureLintManifest,
      manifest,
      kind: "tooling",
      enterprise: false,
    });
  }

  const configRoot = join(root, "packages", "config");
  const configManifest = join(configRoot, "package.json");
  if (existsSync(configManifest)) {
    const manifest = readManifest(configManifest);
    packages.push({
      name: manifest.name ?? "@langwatch/config",
      root: configRoot,
      manifestPath: configManifest,
      manifest,
      kind: "config",
      enterprise: false,
    });
  }

  const names = new Map<string, string>();
  for (const pkg of packages) {
    const existing = names.get(pkg.name);
    if (existing) {
      violations.push({
        policy: "feature-layout",
        file: pkg.manifestPath,
        message: `Duplicate package name \"${pkg.name}\"; first declared by ${existing}.`,
      });
    } else {
      names.set(pkg.name, pkg.manifestPath);
    }
  }

  return { packages, violations };
}
