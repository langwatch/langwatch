import { existsSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  FEATURE_PREFIX,
  SERVICE_MODULE_PATTERN,
  entrySourcePaths,
  optsIntoFeatureLayout,
  stripFeaturePrefix,
} from "../grammar/feature-layout-policy.mjs";

// One answer to "what file am I standing in", computed once per file and read
// by every rule. It replaces five helpers that each asked a slice of the same
// question with their own regex: `normalizedFilename`, `isStrictServiceModule`,
// `classifyFile`, `strictFeatureSource` and `prismaPackageOf`.

// @typedef {string} FeatureRole See grammar/feature-layout-policy for roles.
// @typedef {string} PackageKind See grammar/feature-layout-policy for kinds.

/** @typedef {object} FileClassification - File metadata for the feature-layout classifier. */

const FEATURE_SOURCE = /^(enterprise\/)?modules\/([^/]+)\/(contract|process|browser)\/(.+)$/;
const APPLICATION_SOURCE = /^apps\/([^/]+)\/src\/(.+)$/;
const ENTERPRISE_COMPOSITION_SOURCE =
  /^enterprise\/packages\/composition\/(api|worker)\/src\/(.+)$/;
const SHARED_PACKAGE_SOURCE = /^packages\/(config|design-system)\/src\/(.+)$/;
const SHARED_PACKAGE = /^packages\/(config|design-system|eventing|group-queue)\//;
const PACKAGE_SOURCE_OR_TESTS = /^(src|tests)\//;
const SERVICE_MODULE = new RegExp(
  `^(enterprise/)?modules/[^/]+/process/src/${FEATURE_PREFIX}services/.+\\.service\\.ts$`,
);
const PRISMA_REPOSITORY_SEAM = new RegExp(
  `^(?:enterprise/)?modules/[^/]+/process/src/${FEATURE_PREFIX}repositories/prisma/.+\\.repository\\.ts$`,
);
const MODULE_PACKAGE = /^(enterprise\/)?modules\/([^/]+)\/(contract|process|browser)(?:\/|$)/;
const CLIENT_SOURCE = /^((?:enterprise\/)?modules\/([^/]+)\/client)\/(.+)$/;
const MODULE_ROLES = ["contract", "process", "browser"];
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
const WORKSPACE_PACKAGE = /^packages\/([^/]+)\/(.+)$/;
// A framework package that opts in has no transport; vocabulary and telemetry are its leaves.
const FRAMEWORK_LAYERS = new Set([
  "services",
  "repositories",
  "channels",
  "rules",
  "eventing",
  "telemetry",
  "vocabulary",
]);
const FRAMEWORK_PRISMA_SEAM = new RegExp(
  `^${FEATURE_PREFIX}repositories/prisma/.+\\.repository\\.ts$`,
);

const APPLICATION_ROOTS = new Set(["ui", "api", "worker", "server"]);

const classificationCache = new Map();
const modulePackageCache = new Map();
const clientRootCache = new Map();
const featureLayoutPackageCache = new Map();
// Every rule classifies the same file in turn: the last answer is checked before a key is built.
let last;

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
  const layerPath = stripFeaturePrefix(sourcePath);
  const first = layerPath.slice(0, layerPath.indexOf("/"));

  return PROCESS_LAYERS.has(first) ? first : undefined;
}

function featureClassification({ base, feature }) {
  const packageRelative = feature[4];
  if (!PACKAGE_SOURCE_OR_TESTS.test(packageRelative)) return base;

  const classification = {
    ...base,
    enterprise: Boolean(feature[1]),
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

function classifyPath(cwd, filename) {
  const workspacePath = workspacePathOf(cwd, filename);
  const isTest = TEST_FILE.test(workspacePath) || TEST_DIRECTORY.test(workspacePath);
  const modulePackage = workspacePath.match(MODULE_PACKAGE);
  const client = modulePackage ? undefined : clientPackageOf(cwd, workspacePath);
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
    module: modulePackage?.[2] ?? client?.module,
    moduleEnterprise: Boolean(modulePackage?.[1]) || Boolean(client?.enterprise),
    relative: undefined,
    role: "other",
    sourcePath: undefined,
    strictSource: undefined,
    workspacePath,
  };

  const feature = workspacePath.match(FEATURE_SOURCE);
  if (feature) return featureClassification({ base, feature });

  if (client && PACKAGE_SOURCE_OR_TESTS.test(client.relative)) {
    return {
      ...base,
      enterprise: client.enterprise,
      feature: client.module,
      kind: "client",
      relative: client.relative,
      role: "client",
      sourcePath: client.relative.startsWith("src/")
        ? client.relative.slice("src/".length)
        : undefined,
    };
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

  const framework = featureLayoutPackageOf(cwd, workspacePath);
  if (framework) return frameworkClassification({ base, framework });

  if (SHARED_PACKAGE.test(workspacePath)) return sharedPackageOf(base, workspacePath);

  return base;
}

/** A `packages/*` package whose manifest opts into the feature layout (ADR-181), or undefined. */
function featureLayoutPackageOf(cwd, workspacePath) {
  const match = workspacePath.match(WORKSPACE_PACKAGE);
  if (!match) return undefined;
  const key = `${cwd}|${match[1]}`;
  if (!featureLayoutPackageCache.has(key)) {
    featureLayoutPackageCache.set(key, readFeatureLayoutPackage({ cwd, directory: match[1] }));
  }
  const pkg = featureLayoutPackageCache.get(key);

  return pkg && { ...pkg, relative: match[2] };
}

function readFeatureLayoutPackage({ cwd, directory }) {
  const manifestPath = join(cwd, "packages", directory, "package.json");
  if (!existsSync(manifestPath)) return undefined;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!optsIntoFeatureLayout(manifest)) return undefined;

  return { directory, entries: entrySourcePaths(manifest.exports) };
}

function frameworkLayerOf(sourcePath) {
  const layerPath = stripFeaturePrefix(sourcePath);
  const first = layerPath.slice(0, layerPath.indexOf("/"));

  return FRAMEWORK_LAYERS.has(first) ? first : undefined;
}

/**
 * An opted-in framework file: the module flags read over its `src/`, with no
 * `feature` or `module` of its own, so the rules that mean "a module" still skip it.
 */
function frameworkClassification({ base, framework }) {
  const { directory, entries, relative: packageRelative } = framework;
  if (!PACKAGE_SOURCE_OR_TESTS.test(packageRelative)) return { ...base, role: "framework" };
  const sourcePath = packageRelative.startsWith("src/")
    ? packageRelative.slice("src/".length)
    : undefined;
  const strict = sourcePath !== undefined && !TEST_DIRECTORY.test(sourcePath);

  return {
    ...base,
    isPrismaSeam: Boolean(sourcePath && FRAMEWORK_PRISMA_SEAM.test(sourcePath)),
    isServiceModule: Boolean(sourcePath && SERVICE_MODULE_PATTERN.test(sourcePath)),
    kind: "framework",
    layer: sourcePath ? frameworkLayerOf(sourcePath) : undefined,
    relative: packageRelative,
    role: "framework",
    sourcePath,
    strictSource: strict
      ? {
          enterprise: false,
          entry: entries.has(sourcePath),
          feature: directory,
          name: sourcePath.slice(sourcePath.lastIndexOf("/") + 1),
          role: "framework",
          sourcePath,
        }
      : undefined,
  };
}

/** A module's client package: its derived hooks and lent tokens (ARCHITECTURE.md §3.4). */
function clientPackageOf(cwd, workspacePath) {
  const match = workspacePath.match(CLIENT_SOURCE);
  if (!match || !clientRootsOf(cwd).has(match[1])) return undefined;

  return {
    enterprise: workspacePath.startsWith("enterprise/"),
    module: match[2],
    relative: match[3],
  };
}

function clientRootsOf(cwd) {
  const cached = clientRootCache.get(cwd);
  if (cached) return cached;
  const roots = new Set();
  for (const pkg of modulePackages(cwd).values()) {
    if (pkg.role === "client") roots.add(pkg.root);
  }
  clientRootCache.set(cwd, roots);

  return roots;
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
  const given = context.physicalFilename || context.filename;
  if (last && given === last.given && context.cwd === last.cwd) return last.classification;
  const filename = normalizedFilename(context);
  const key = `${context.cwd}|${filename}`;
  const cached = classificationCache.get(key);
  const classification = cached ?? classifyPath(context.cwd, filename);
  if (!cached) classificationCache.set(key, classification);
  last = { classification, cwd: context.cwd, given };

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

function readModulePackage({ cwd, moduleRoot, folder }) {
  const root = `${moduleRoot}/${folder}`;
  const manifestPath = join(cwd, root, "package.json");
  if (!existsSync(manifestPath)) return undefined;
  const role = packageRoleOf(folder);
  // Any other folder is no module package: the enforcer refuses it as a feature-layout violation.
  if (role === undefined) return undefined;
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

/** `client` is its own role (§3.4, §10.1; Alex, 2026-10-06); any other folder has no role. */
function packageRoleOf(folder) {
  if (MODULE_ROLES.includes(folder)) return folder;

  return folder === "client" ? "client" : undefined;
}

/**
 * Every module package in the workspace by package name: the catalogue's roots
 * plus both module trees, one package per folder that has a package.json and
 * one of the four roles.
 */
export function modulePackages(cwd) {
  const cached = modulePackageCache.get(cwd);
  if (cached) return cached;

  const packages = new Map();
  for (const moduleRoot of moduleRootsOf(cwd)) {
    for (const folder of directoriesOf(join(cwd, moduleRoot))) {
      const pkg = readModulePackage({ cwd, moduleRoot, folder });
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
  clientRootCache.clear();
  featureLayoutPackageCache.clear();
  last = undefined;
}
