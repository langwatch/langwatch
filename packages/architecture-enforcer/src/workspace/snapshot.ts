import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import type {
  ApplicationPackageRole,
  ArchitectureViolation,
  ClassifiedPackage,
  EnterpriseCompositionRole,
  FeatureCatalogueEntry,
  FeaturePackageRole,
  PackageManifest,
} from "../types.ts";
import { readFeatureCatalogue } from "./feature-catalogue.ts";
import { forgetFileListings, listFiles } from "./layout.ts";
import {
  forgetWorkspaceModuleResolvers,
  workspaceModuleResolver,
  type WorkspaceModuleResolver,
} from "./module-graph.ts";

const FEATURE_ROLES = new Set<FeaturePackageRole>([
  "contract",
  "process",
  "browser",
  "browser-kit",
]);

const APPLICATION_PACKAGES: readonly {
  role: ApplicationPackageRole;
  path: string;
  name: string;
}[] = [
  { role: "ui", path: "ui", name: "@langwatch/ui" },
  { role: "api", path: "api", name: "@langwatch/platform-api" },
  { role: "worker", path: "worker", name: "@langwatch/worker" },
  { role: "server", path: "server", name: "@langwatch/server" },
];

const ENTERPRISE_COMPOSITION_PACKAGES: readonly {
  role: EnterpriseCompositionRole;
  name: string;
}[] = [
  { role: "api", name: "@langwatch/enterprise-api" },
  { role: "worker", name: "@langwatch/enterprise-worker" },
];

function readManifest(path: string): PackageManifest {
  return JSON.parse(readFileSync(path, "utf8")) as PackageManifest;
}

function directories(path: string): string[] {
  if (!existsSync(path)) return [];

  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
}

export function discoverClassifiedPackages(root: string): {
  packages: ClassifiedPackage[];
  catalogue: FeatureCatalogueEntry[];
  violations: ArchitectureViolation[];
} {
  const packages: ClassifiedPackage[] = [];
  const violations: ArchitectureViolation[] = [];
  const catalogue = readFeatureCatalogue(root, violations);
  const catalogueByRoot = new Map(catalogue.map((entry) => [join(root, entry.root), entry]));

  const discoverFeatures = (featuresRoot: string, enterprise: boolean) => {
    for (const feature of directories(featuresRoot)) {
      const featureRoot = join(featuresRoot, feature);
      const catalogueEntry = catalogueByRoot.get(featureRoot);

      if (!catalogueEntry) {
        violations.push({
          policy: "feature-catalogue",
          file: featureRoot,
          message: `Feature root ${JSON.stringify(feature)} is not registered in modules/catalogue.json.`,
          allowed:
            "Use the singular catalogue identifier and record new ownership in its ADR and specification.",
        });
      } else if ((catalogueEntry.classification === "enterprise") !== enterprise) {
        violations.push({
          policy: "feature-catalogue",
          file: featureRoot,
          message: `Feature ${JSON.stringify(feature)} is in the wrong core/Enterprise tree for its catalogue classification.`,
        });
      }

      const featureManifest = join(featureRoot, "package.json");

      if (existsSync(featureManifest)) {
        violations.push({
          policy: "feature-layout",
          file: featureManifest,
          message: "A feature ownership directory cannot itself be a package.",
          allowed: "Put package.json inside contract, process, browser, or browser-kit.",
        });
      }

      for (const roleName of directories(featureRoot)) {
        const manifestPath = join(featureRoot, roleName, "package.json");
        if (!existsSync(manifestPath)) continue;

        if (!FEATURE_ROLES.has(roleName as FeaturePackageRole)) {
          violations.push({
            policy: "feature-layout",
            file: manifestPath,
            message: `Unknown feature package role "${roleName}".`,
            allowed:
              "Use contract, process, browser, or browser-kit; documentation belongs at the feature root.",
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
            message: `Package name must be "${expectedName}", found ${JSON.stringify(manifest.name)}.`,
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
          subjects: catalogueEntry?.subjects,
          enterprise,
        });
      }
    }
  };

  discoverFeatures(join(root, "modules"), false);
  discoverFeatures(join(root, "enterprise", "modules"), true);

  const sharedApplicationRoot = join(root, "apps", "shared");

  if (existsSync(sharedApplicationRoot)) {
    violations.push({
      policy: "application-layout",
      file: sharedApplicationRoot,
      message: "apps/shared is not an application or a reusable package boundary.",
      allowed:
        "Put product behaviour in its feature package and shared infrastructure in a deliberately named package.",
    });
  }

  const applicationsRoot = join(root, "apps");

  for (const directory of directories(applicationsRoot)) {
    if (APPLICATION_PACKAGES.some(({ path }) => path === directory)) continue;

    const unexpectedManifest = join(applicationsRoot, directory, "package.json");
    if (!existsSync(unexpectedManifest) || directory === "shared") continue;

    violations.push({
      policy: "application-layout",
      file: unexpectedManifest,
      message: `Unknown application workspace apps/${directory}.`,
      allowed: "The fixed application roots are ui, api, worker, and server.",
    });
  }

  for (const application of APPLICATION_PACKAGES) {
    const applicationRoot = join(root, "apps", application.path);
    const manifestPath = join(applicationRoot, "package.json");
    if (!existsSync(manifestPath)) continue;

    const manifest = readManifest(manifestPath);

    if (manifest.name !== application.name) {
      violations.push({
        policy: "application-layout",
        file: manifestPath,
        message: `Application package at apps/${application.path} must be named "${application.name}", found ${JSON.stringify(manifest.name)}.`,
      });
    }

    packages.push({
      name: manifest.name ?? application.name,
      root: applicationRoot,
      manifestPath,
      manifest,
      kind: "application",
      applicationRole: application.role,
      enterprise: false,
    });
  }

  const devRuntimeRoot = join(root, "tools", "dev-runtime");
  const devRuntimeManifest = join(devRuntimeRoot, "package.json");

  if (existsSync(devRuntimeManifest)) {
    const manifest = readManifest(devRuntimeManifest);

    if (manifest.private !== true) {
      violations.push({
        policy: "application-layout",
        file: devRuntimeManifest,
        message: "tools/dev-runtime must be a private contributor package.",
        allowed: 'Set "private": true; the combined runtime is never shipped.',
      });
    }

    packages.push({
      name: manifest.name ?? "@langwatch/dev-runtime",
      root: devRuntimeRoot,
      manifestPath: devRuntimeManifest,
      manifest,
      kind: "dev-runtime",
      enterprise: false,
    });
  }

  const enterpriseRoot = join(root, "enterprise");
  const enterpriseLicense = join(enterpriseRoot, "LICENSE.md");
  const enterpriseReadme = join(enterpriseRoot, "README.md");
  const enterpriseManifest = join(enterpriseRoot, "package.json");

  const hasEnterprisePackages =
    existsSync(enterpriseManifest) ||
    ENTERPRISE_COMPOSITION_PACKAGES.some(({ role }) =>
      existsSync(join(enterpriseRoot, "packages", "composition", role, "package.json")),
    ) ||
    packages.some((pkg) => pkg.enterprise);

  if (hasEnterprisePackages && !existsSync(enterpriseLicense)) {
    violations.push({
      policy: "enterprise-layout",
      file: enterpriseLicense,
      message:
        "enterprise/LICENSE.md must govern every Enterprise package before source is placed in this tree.",
    });
  }

  if (hasEnterprisePackages && !existsSync(enterpriseReadme)) {
    violations.push({
      policy: "enterprise-layout",
      file: enterpriseReadme,
      message: "enterprise/README.md must explain and catalogue the governed Enterprise tree.",
    });
  }

  if (existsSync(enterpriseLicense)) {
    const licenseText = readFileSync(enterpriseLicense, "utf8");

    if (!/^#\s+LangWatch Enterprise License\s*$/m.test(licenseText)) {
      violations.push({
        policy: "enterprise-license",
        file: enterpriseLicense,
        message: "enterprise/LICENSE.md must contain the LangWatch Enterprise License.",
      });
    }
  }

  if (existsSync(enterpriseManifest)) {
    const manifest = readManifest(enterpriseManifest);

    if (manifest.name !== "@langwatch/enterprise") {
      violations.push({
        policy: "enterprise-layout",
        file: enterpriseManifest,
        message: 'The portable Enterprise catalogue package must be named "@langwatch/enterprise".',
      });
    }

    if (typeof manifest.license !== "string") {
      violations.push({
        policy: "enterprise-license",
        file: enterpriseManifest,
        message:
          "The Enterprise root manifest must identify enterprise/LICENSE.md rather than an Apache license.",
        allowed: 'Use "license": "SEE LICENSE IN LICENSE.md".',
      });
    } else if (!/LICENSE\.md/i.test(manifest.license)) {
      violations.push({
        policy: "enterprise-license",
        file: enterpriseManifest,
        message:
          "The Enterprise root manifest must identify enterprise/LICENSE.md rather than an Apache license.",
        allowed: 'Use "license": "SEE LICENSE IN LICENSE.md".',
      });
    } else if (/Apache-2\.0/i.test(manifest.license)) {
      violations.push({
        policy: "enterprise-license",
        file: enterpriseManifest,
        message:
          "The Enterprise root manifest must identify enterprise/LICENSE.md rather than an Apache license.",
        allowed: 'Use "license": "SEE LICENSE IN LICENSE.md".',
      });
    }

    packages.push({
      name: manifest.name ?? "@langwatch/enterprise",
      root: enterpriseRoot,
      manifestPath: enterpriseManifest,
      manifest,
      kind: "enterprise-root",
      enterprise: true,
    });
  }

  for (const composition of ENTERPRISE_COMPOSITION_PACKAGES) {
    const compositionRoot = join(enterpriseRoot, "packages", "composition", composition.role);
    const manifestPath = join(compositionRoot, "package.json");
    if (!existsSync(manifestPath)) continue;

    const manifest = readManifest(manifestPath);

    if (manifest.name !== composition.name) {
      violations.push({
        policy: "enterprise-layout",
        file: manifestPath,
        message: `Enterprise ${composition.role} composition must be named "${composition.name}", found ${JSON.stringify(manifest.name)}.`,
      });
    }

    packages.push({
      name: manifest.name ?? composition.name,
      root: compositionRoot,
      manifestPath,
      manifest,
      kind: "enterprise-composition",
      enterpriseCompositionRole: composition.role,
      enterprise: true,
    });
  }

  if (existsSync(enterpriseRoot)) {
    for (const directory of directories(enterpriseRoot)) {
      if (directory === "packages" || directory === "modules") continue;

      const unexpectedManifest = join(enterpriseRoot, directory, "package.json");
      if (!existsSync(unexpectedManifest)) continue;

      violations.push({
        policy: "enterprise-layout",
        file: unexpectedManifest,
        message: `Enterprise aggregate package at enterprise/${directory} is outside the fixed package layout.`,
        allowed:
          "Use the portable root, packages/composition/{api,worker,web}, or modules/<module>/{contract,server,web}.",
      });
    }

    const compositionRoot = join(enterpriseRoot, "packages", "composition");

    for (const directory of directories(compositionRoot)) {
      if (ENTERPRISE_COMPOSITION_PACKAGES.some(({ role }) => role === directory)) {
        continue;
      }

      const unexpectedManifest = join(compositionRoot, directory, "package.json");
      if (!existsSync(unexpectedManifest)) continue;

      violations.push({
        policy: "enterprise-layout",
        file: unexpectedManifest,
        message: `Unknown Enterprise composition role "${directory}".`,
        allowed: "Use api, worker, or web.",
      });
    }
  }

  for (const directory of directories(join(root, "packages"))) {
    const manifestPath = join(root, "packages", directory, "package.json");
    if (!existsSync(manifestPath)) continue;

    const manifest = readManifest(manifestPath);
    if (!manifest.name?.startsWith("@langwatch/enterprise")) continue;

    violations.push({
      policy: "enterprise-layout",
      file: manifestPath,
      message: `${manifest.name} is an Enterprise aggregate outside enterprise.`,
      allowed:
        "Use the portable root, packages/composition/{api,worker,web}, or modules/<module>/{contract,server,web}.",
    });
  }

  for (const pkg of packages) {
    if (!pkg.enterprise || pkg.kind === "enterprise-root") continue;

    if (/Apache-2\.0/i.test(pkg.manifest.license ?? "")) {
      violations.push({
        policy: "enterprise-license",
        file: pkg.manifestPath,
        message: "An Enterprise descendant package cannot claim that its source is Apache-2.0.",
        allowed: "Inherit the LangWatch Enterprise license rooted at enterprise/LICENSE.md.",
      });
    }
  }

  const designSystemRoot = join(root, "packages", "design-system");
  const designSystemManifest = join(designSystemRoot, "package.json");

  if (existsSync(designSystemManifest)) {
    const manifest = readManifest(designSystemManifest);

    if (manifest.name !== "@langwatch/design-system") {
      violations.push({
        policy: "feature-layout",
        file: designSystemManifest,
        message: 'The design-system package must be named "@langwatch/design-system".',
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

  const architectureLintRoot = join(root, "packages", "architecture-enforcer");
  const architectureLintManifest = join(architectureLintRoot, "package.json");

  if (existsSync(architectureLintManifest)) {
    const manifest = readManifest(architectureLintManifest);

    packages.push({
      name: manifest.name ?? "@langwatch/architecture-enforcer",
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
        message: `Duplicate package name "${pkg.name}"; first declared by ${existing}.`,
      });
    } else {
      names.set(pkg.name, pkg.manifestPath);
    }
  }

  return { packages, catalogue, violations };
}

/**
 * One reading of the workspace, built once per run and handed to every policy.
 * Before it, nine policies walked the tree for themselves with five different
 * ignore lists, and a file every policy read was parsed once per policy.
 */
export type WorkspaceSnapshot = {
  /** The absolute workspace root every path in the snapshot is relative to. */
  readonly root: string;
  readonly packages: readonly ClassifiedPackage[];
  readonly catalogue: readonly FeatureCatalogueEntry[];
  /** What discovery itself refused: a mis-named package, an unregistered feature root. */
  readonly discoveryViolations: readonly ArchitectureViolation[];
  /** Source files changed against the merge base, for the policies scoped to new code. */
  readonly changedFiles: readonly string[];
  readonly resolver: WorkspaceModuleResolver;
  /** Every file under `directory` the filter accepts, from one walk per directory. */
  files: (options: {
    directory: string;
    accept: (path: string) => boolean;
    ignoredDirectories?: ReadonlySet<string>;
  }) => readonly string[];
};

type SnapshotOptions = {
  root: string;
  changedFiles: readonly string[];
};

export function buildWorkspaceSnapshot({ root, changedFiles }: SnapshotOptions): WorkspaceSnapshot {
  // A snapshot is one reading of the tree, so it starts from the tree as it is
  // now: a fixture written since the last reading must not answer from a
  // listing or a resolution the last reading made.
  forgetFileListings();
  forgetWorkspaceModuleResolvers();

  const resolvedRoot = resolve(root);
  const discovery = discoverClassifiedPackages(resolvedRoot);

  return {
    root: resolvedRoot,
    packages: discovery.packages,
    catalogue: discovery.catalogue,
    discoveryViolations: discovery.violations,
    changedFiles,
    resolver: workspaceModuleResolver({ root: resolvedRoot }),
    files: listFiles,
  };
}
