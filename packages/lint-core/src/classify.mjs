import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

// One answer to "what file am I standing in", computed once per file and read
// by every rule. It replaces five helpers that each asked a slice of the same
// question with their own regex: `normalizedFilename`, `isStrictServiceModule`,
// `classifyFile`, `strictFeatureSource` and `prismaPackageOf`.

/**
 * @typedef {"contract" | "server" | "web" | "config" | "design-system" | "framework" | "other"} FeatureRole
 * The role a file plays in the feature-package grammar. `other` is everything
 * outside a feature package, which the boundary rules read as "an importer we
 * do not police the inside of".
 */

/**
 * @typedef {"contract" | "server" | "web" | "application" | "enterprise-composition" | "config" | "design-system"} PackageKind
 * The workspace package a file belongs to, for the rules that ask what kind of
 * package they stand in rather than what feature role it plays.
 */

/**
 * @typedef {object} StrictFeatureSource
 * @property {string | undefined} feature
 * @property {boolean} enterprise
 * @property {FeatureRole} role
 * @property {string} sourcePath Path below `src/`, e.g. `services/agent.service.ts`.
 * @property {string} name Basename, e.g. `agent.service.ts`.
 */

/**
 * @typedef {object} FileClassification
 * @property {string} filename Absolute path of the linted file.
 * @property {string} workspacePath Forward-slash path relative to the workspace root.
 * @property {FeatureRole} role
 * @property {PackageKind | undefined} kind
 * @property {string | undefined} feature
 * @property {boolean} enterprise
 * @property {number | undefined} layoutVersion
 * @property {string | undefined} relative Path below the package root, e.g. `src/x.ts`.
 * @property {string | undefined} sourcePath Path below `src/`, undefined outside `src/`.
 * @property {boolean} isTest
 * @property {boolean} isProduction
 * @property {boolean} isServiceModule
 * @property {boolean} isPrismaSeam
 * @property {StrictFeatureSource | undefined} strictSource
 */

const FEATURE_SOURCE = /^packages\/(enterprise\/)?features\/([^/]+)\/(contract|server|web)\/(.+)$/;
const APPLICATION_SOURCE = /^apps\/([^/]+)\/src\/(.+)$/;
const ENTERPRISE_COMPOSITION_SOURCE =
  /^packages\/enterprise\/composition\/(api|worker)\/src\/(.+)$/;
const SHARED_PACKAGE_SOURCE = /^packages\/(config|design-system)\/src\/(.+)$/;
const SHARED_PACKAGE = /^packages\/(config|design-system|eventing|group-queue)\//;
const PACKAGE_SOURCE_OR_TESTS = /^(src|tests)\//;
const SERVICE_MODULE =
  /^packages\/(enterprise\/)?features\/[^/]+\/server\/src\/services\/.+\.service\.ts$/;
const PRISMA_REPOSITORY_SEAM =
  /^packages\/(?:enterprise\/)?features\/[^/]+\/server\/src\/repositories\/prisma\/.+\.repository\.ts$/;
const POSTGRES_ADAPTER_SEAM =
  /^packages\/(?:enterprise\/)?features\/[^/]+\/server\/src\/adapters\/postgres\.[^/]+\.adapter\.ts$/;
const TEST_FILE = /\.(?:test|spec|unit|integration|e2e)\.[cm]?[jt]sx?$/;
const TEST_DIRECTORY = /(?:^|\/)(?:__tests__|__mocks__|tests)(?:\/|$)/;

const APPLICATION_ROOTS = new Set(["ui", "api", "worker", "server"]);

const layoutVersionCache = new Map();
const classificationCache = new Map();

/** The absolute path of the file a rule is looking at. */
export function normalizedFilename(context) {
  const filename = context.physicalFilename || context.filename;
  return isAbsolute(filename) ? filename : resolve(context.cwd, filename);
}

/** A forward-slash path relative to the workspace root, on every platform. */
export function workspacePathOf(cwd, filename) {
  return relative(cwd, filename).split(sep).join("/");
}

function featureLayoutVersion(cwd, enterprise, feature) {
  const key = `${cwd}:${enterprise ? "enterprise:" : "core:"}${feature}`;
  if (layoutVersionCache.has(key)) return layoutVersionCache.get(key);
  const root = enterprise
    ? join(cwd, "packages", "enterprise", "features", feature)
    : join(cwd, "packages", "features", feature);
  const path = join(root, "feature.json");
  let version;
  if (existsSync(path)) {
    try {
      const value = JSON.parse(readFileSync(path, "utf8"));
      if (value.layoutVersion === 0) version = value.layoutVersion;
    } catch {
      version = undefined;
    }
  }
  layoutVersionCache.set(key, version);
  return version;
}

function strictSourceOf({ enterprise, feature, layoutVersion, relative: packageRelative, role }) {
  if (role !== "contract" && role !== "server" && role !== "web") return undefined;
  if (layoutVersion !== 0) return undefined;
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

function classifyPath(cwd, filename) {
  const workspacePath = workspacePathOf(cwd, filename);
  const isTest = TEST_FILE.test(workspacePath) || TEST_DIRECTORY.test(workspacePath);
  const prismaSeam =
    PRISMA_REPOSITORY_SEAM.test(workspacePath) || POSTGRES_ADAPTER_SEAM.test(workspacePath);
  const base = {
    enterprise: false,
    feature: undefined,
    filename,
    isPrismaSeam: prismaSeam,
    isProduction: !isTest,
    isServiceModule: SERVICE_MODULE.test(workspacePath),
    isTest,
    kind: undefined,
    layoutVersion: undefined,
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
      layoutVersion: featureLayoutVersion(cwd, enterprise, feature[2]),
      relative: packageRelative,
      role: feature[3],
      sourcePath: packageRelative.startsWith("src/")
        ? packageRelative.slice("src/".length)
        : undefined,
    };
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

  if (SHARED_PACKAGE.test(workspacePath)) {
    const shared = workspacePath.match(SHARED_PACKAGE_SOURCE);
    const role = workspacePath.startsWith("packages/design-system/")
      ? "design-system"
      : workspacePath.startsWith("packages/config/")
        ? "config"
        : "framework";
    if (!shared) return { ...base, role };

    return { ...base, kind: shared[1], relative: `src/${shared[2]}`, role, sourcePath: shared[2] };
  }

  return base;
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

/** Drops every memo. Only the fixture harness needs this. */
export function resetClassificationCache() {
  classificationCache.clear();
  layoutVersionCache.clear();
}
