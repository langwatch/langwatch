import { existsSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

// One answer to "what file am I standing in", computed once per file and read
// by every rule. It replaces five helpers that each asked a slice of the same
// question with their own regex: `normalizedFilename`, `isStrictServiceModule`,
// `classifyFile`, `strictFeatureSource` and `prismaPackageOf`.

// @typedef {string} FeatureRole See grammar/feature-layout-policy for roles.
// @typedef {string} PackageKind See grammar/feature-layout-policy for kinds.

/** @typedef {object} FileClassification - File metadata for the feature-layout classifier. */

const FEATURE_SOURCE =
  /^(enterprise\/)?modules\/([^/]+)\/(contract|process|browser|browser-kit)\/(.+)$/;
const APPLICATION_SOURCE = /^apps\/([^/]+)\/src\/(.+)$/;
const ENTERPRISE_COMPOSITION_SOURCE =
  /^enterprise\/packages\/composition\/(api|worker)\/src\/(.+)$/;
const SHARED_PACKAGE_SOURCE = /^packages\/(config|design-system)\/src\/(.+)$/;
const SHARED_PACKAGE = /^packages\/(config|design-system|eventing|group-queue)\//;
const PACKAGE_SOURCE_OR_TESTS = /^(src|tests)\//;
const SERVICE_MODULE = /^(enterprise\/)?modules\/[^/]+\/process\/src\/services\/.+\.service\.ts$/;
const PRISMA_REPOSITORY_SEAM =
  /^(?:enterprise\/)?modules\/[^/]+\/process\/src\/repositories\/prisma\/.+\.repository\.ts$/;
const MODULE_PACKAGE =
  /^(enterprise\/)?modules\/([^/]+)\/(contract|process|browser|browser-kit)(?:\/|$)/;
const MODULE_ROLES = ["contract", "process", "browser", "browser-kit"];
const PROCESS_LAYERS = new Set([
  "services",
  "repositories",
  "channels",
  "transport",
  "rules",
  "eventing",
]);
const TEST_FILE = /\.(?:test|spec|unit|integration|e2e)\.[cm]?[jt]sx?$/;
const TEST_DIRECTORY = /(?:^|\/)(?:__tests__|__mocks__|tests)(?:\/|$)/;

const APPLICATION_ROOTS = new Set(["ui", "api", "worker", "server"]);

const classificationCache = new Map();
const modulePackageCache = new Map();

/** The absolute path of the file a rule is looking at. */
export function normalizedFilename(context) {
  const filename = context.physicalFilename || context.filename;
  return isAbsolute(filename) ? filename : resolve(context.cwd, filename);
}

/** A forward-slash path relative to the workspace root, on every platform. */
export function workspacePathOf(cwd, filename) {
  return relative(cwd, filename).split(sep).join("/");
}

function strictSourceOf({ enterprise, feature, relative: packageRelative, role }) {
  if (role !== "contract" && role !== "process" && role !== "browser") return undefined;
  if (!packageRelative?.startsWith("src/")) return undefined;
  const sourcePath = packageRelative.slice("src/".length);
  if (TEST_DIRECTORY.test(sourcePath)) return undefined;

  return {
    enterprise,
    feature,
    name: sourcePath.slice(sourcePath.lastIndexOf("/") + 1),
    role,
    sourcePath,
  };
}

function layerOf({ role, sourcePath }) {
  if (role !== "process" || !sourcePath) return undefined;
  const first = sourcePath.slice(0, sourcePath.indexOf("/"));

  return PROCESS_LAYERS.has(first) ? first : undefined;
}

function classifyPath(cwd, filename) {
  const workspacePath = workspacePathOf(cwd, filename);
  const isTest = TEST_FILE.test(workspacePath) || TEST_DIRECTORY.test(workspacePath);
  const modulePackage = workspacePath.match(MODULE_PACKAGE);
  const base = {
    enterprise: false,
    feature: undefined,
    filename,
    isPrismaSeam: PRISMA_REPOSITORY_SEAM.test(workspacePath),
    isProduction: !isTest,
    isServiceModule: SERVICE_MODULE.test(workspacePath),
    isTest,
    kind: undefined,
    layer: undefined,
    module: modulePackage?.[2],
    moduleEnterprise: Boolean(modulePackage?.[1]),
    relative: undefined,
    role: "other",
    sourcePath: undefined,
    strictSource: undefined,
    workspacePath,
  };

  const feature = workspacePath.match(FEATURE_SOURCE);
  if (feature) {
    const enterprise = Boolean(feature[1]);
    const packageRelative = feature[4];
    if (!PACKAGE_SOURCE_OR_TESTS.test(packageRelative)) return base;

    const classification = {
      ...base,
      enterprise,
      feature: feature[2],
      kind: feature[3],
      relative: packageRelative,
      role: feature[3],
      sourcePath: packageRelative.startsWith("src/")
        ? packageRelative.slice("src/".length)
        : undefined,
    };
    classification.layer = layerOf(classification);
    classification.strictSource = strictSourceOf(classification);

    return classification;
  }

  const application = workspacePath.match(APPLICATION_SOURCE);
  if (application && APPLICATION_ROOTS.has(application[1])) {
    return {
      ...base,
      kind: "application",
      relative: `src/${application[2]}`,
      sourcePath: application[2],
    };
  }

  const composition = workspacePath.match(ENTERPRISE_COMPOSITION_SOURCE);
  if (composition) {
    return {
      ...base,
      kind: "enterprise-composition",
      relative: `src/${composition[2]}`,
      sourcePath: composition[2],
    };
  }

  if (SHARED_PACKAGE.test(workspacePath)) return sharedPackageOf(base, workspacePath);

  return base;
}

function sharedRoleOf(workspacePath) {
  if (workspacePath.startsWith("packages/design-system/")) return "design-system";
  if (workspacePath.startsWith("packages/config/")) return "config";

  return "framework";
}

function sharedPackageOf(base, workspacePath) {
  const shared = workspacePath.match(SHARED_PACKAGE_SOURCE);
  const role = sharedRoleOf(workspacePath);
  if (!shared) return { ...base, role };

  return { ...base, kind: shared[1], relative: `src/${shared[2]}`, role, sourcePath: shared[2] };
}

/**
 * The classification of the file a rule is looking at, memoised per workspace
 * root and file so every rule pays for it once instead of once each.
 *
 * @returns {FileClassification}
 */
export function classify(context) {
  const filename = normalizedFilename(context);
  const key = `${context.cwd}|${filename}`;
  const cached = classificationCache.get(key);
  if (cached) return cached;

  const classification = classifyPath(context.cwd, filename);
  classificationCache.set(key, classification);

  return classification;
}

function directoriesOf(path) {
  if (!existsSync(path)) return [];

  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function catalogueRootsOf(cwd) {
  const cataloguePath = join(cwd, "modules", "catalogue.json");
  if (!existsSync(cataloguePath)) return [];
  const catalogue = JSON.parse(readFileSync(cataloguePath, "utf8"));

  return (catalogue.features ?? []).map((feature) => feature.root).filter(Boolean);
}

function moduleRootsOf(cwd) {
  const scanned = ["modules", "enterprise/modules"].flatMap((parent) =>
    directoriesOf(join(cwd, parent)).map((name) => `${parent}/${name}`),
  );

  return [...new Set([...catalogueRootsOf(cwd), ...scanned])];
}

function readModulePackage(cwd, moduleRoot, role) {
  const root = `${moduleRoot}/${role}`;
  const manifestPath = join(cwd, root, "package.json");
  if (!existsSync(manifestPath)) return undefined;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

  return {
    enterprise: moduleRoot.startsWith("enterprise/"),
    exports: new Set(Object.keys(manifest.exports ?? {})),
    module: moduleRoot.slice(moduleRoot.lastIndexOf("/") + 1),
    name: manifest.name,
    role,
    root,
  };
}

/**
 * Every module package in the workspace by package name: the catalogue's roots
 * plus both module trees, one package per role folder that has a package.json.
 */
export function modulePackages(cwd) {
  const cached = modulePackageCache.get(cwd);
  if (cached) return cached;

  const packages = new Map();
  for (const moduleRoot of moduleRootsOf(cwd)) {
    for (const role of MODULE_ROLES) {
      const pkg = readModulePackage(cwd, moduleRoot, role);
      if (pkg?.name) packages.set(pkg.name, pkg);
    }
  }
  modulePackageCache.set(cwd, packages);

  return packages;
}

/** The module package a bare specifier names, with the subpath it asks for. */
export function modulePackageOf(cwd, specifier) {
  const [scope, name] = specifier.split("/");
  const packageName = scope?.startsWith("@") ? `${scope}/${name}` : scope;
  const pkg = modulePackages(cwd).get(packageName);
  if (!pkg) return undefined;

  return { pkg, subpath: `.${specifier.slice(packageName.length)}` };
}

/** Drops every memo. Only the fixture harness needs this. */
export function resetClassificationCache() {
  classificationCache.clear();
  modulePackageCache.clear();
}
