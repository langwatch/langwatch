// The strict feature layout grammar: what a source file inside a feature
// package may be called and where it may sit. The oxlint rules
// `feature-source-filename`, `feature-source-layout` and
// `feature-source-subject` decide with these; the CLI imports the same
// patterns for the checks that need the whole package graph.

export const NAME = "[a-z0-9]+(?:-[a-z0-9]+)*";
const NAME_RE = new RegExp(`^${NAME}$`);

export const CANONICAL_ARTIFACTS = new Set([
  "adapter",
  "app",
  "api",
  "channel",
  "commands",
  "errors",
  "events",
  "intent",
  "migration",
  "port",
  "process",
  "projection",
  "queries",
  "repository",
  "rules",
  "service",
  "store",
  "subscriber",
  "task",
]);

export const TEST_LEVELS = new Set(["unit", "integration", "e2e"]);

/**
 * A test lives in a `__tests__` directory beside the code it covers. The
 * grammar below describes production source; a test is named for the
 * behaviour it pins, so anything under `__tests__` is exempt at any depth.
 */
export const TEST_DIRECTORY = /(?:^|\/)__tests__\//;

export const SERVER_QUALIFIED_ARTIFACTS = new Set([
  "adapter",
  "channel",
  "mapper",
  "repository",
  "store",
]);
export const SERVER_ARCHITECTURAL_QUALIFIERS = [
  "clickhouse",
  "eventing",
  "in-memory",
  "ledger",
  "memory",
  "postgres",
  "prisma",
  "redis",
  "routed",
];

/**
 * The tiers a channel implementation may sit in. The folder name and the
 * filename's first qualifier are the same word, so a file cannot claim one
 * tier while living in another.
 */
export const CHANNEL_TIERS = ["eventing", "http", "memory", "redis", "ses", "slack", "sqs"];
const CHANNEL_TIER = CHANNEL_TIERS.join("|");

/** The feature API token has one portable home; other API modules are transports. */
export function isFeatureApiContract(sourcePath, feature) {
  return sourcePath === `${feature}.api.ts`;
}

export const CONTRACT_ARTIFACT = new RegExp(
  `^${NAME}\\.(?:app|commands|errors|events|queries|service)\\.ts$`,
);
export const SERVER_ONLY_CONTRACT_ARTIFACT =
  /\.(?:adapter|api|mapper|migration|port|projection|repository|store)\.ts$/;
export const CONTRACT_ARTIFACT_SUFFIX = /\.(?:app|commands|errors|events|queries|service)\.ts$/;

// This list is closed. A server source file is one of these shapes or it is not
// allowed: there is no folder for a name that states a technique rather than a
// role. Owned state is a repository, messages to something the module does not
// own are a channel, behaviour is a service, a client the process supplies is a
// member of the module's Infrastructure beside the app.
export const SERVER_PATTERNS = [
  /^index\.ts$/,
  new RegExp(`^${NAME}\\.server\\.ts$`),
  // A feature app groups its public services; transport adapters stay outside it.
  new RegExp(`^app/${NAME}\\.app\\.ts$`),
  new RegExp(`^services/${NAME}\\.service\\.ts$`),
  new RegExp(`^repositories/${NAME}(?:\\.${NAME})?\\.repository\\.ts$`),
  // A feature can select a repository bundle by persistence backend.
  new RegExp(`^repositories/${NAME}(?:-repositories)?\\.registry\\.ts$`),
  new RegExp(`^repositories/${NAME}(?:\\.${NAME})?\\.repositories\\.ts$`),
  new RegExp(
    `^repositories/(${NAME})/(?:${NAME}|\\1\\.${NAME})\\.(?:database|mapper|repository|repositories|store)\\.ts$`,
  ),
  // A channel carries messages to or from something the module does not own.
  new RegExp(`^channels/${NAME}(?:\\.${NAME})?\\.channel\\.ts$`),
  new RegExp(`^channels/${NAME}(?:-channels)?\\.registry\\.ts$`),
  new RegExp(`^channels/${NAME}(?:\\.${NAME})?\\.channels\\.ts$`),
  new RegExp(`^channels/(${CHANNEL_TIER})/\\1\\.${NAME}\\.(?:channel|channels)\\.ts$`),
  new RegExp(`^stores/${NAME}(?:\\.${NAME})?\\.store\\.ts$`),
  new RegExp(`^stores/(${NAME})/(?:${NAME}|\\1\\.${NAME})\\.store\\.ts$`),
  new RegExp(`^projections/${NAME}\\.projection\\.ts$`),
  new RegExp(`^subscribers/${NAME}\\.subscriber\\.ts$`),
  new RegExp(`^processes/${NAME}\\.process\\.ts$`),
  new RegExp(`^intents/${NAME}\\.intent\\.ts$`),
  // One-shot programs run from the task launcher, composed by apps/tasks.
  new RegExp(`^tasks/${NAME}\\.task\\.ts$`),
  // Flat API declarations and explicit WebSocket protocol integrations.
  new RegExp(`^transport/${NAME}\\.(?:rest|trpc|ws)\\.ts$`),
  new RegExp(`^migrations/${NAME}-import\\.${NAME}\\.migration\\.ts$`),
];

export const SERVICE_MODULE_PATTERN = /^services\/.+\.service\.ts$/;
export const PROCESS_MANAGER_SERVICE_PATTERN = /^services\/.+-process\.service\.ts$/;

// A pure function/constant module: a package of functions in the Go sense,
// not a single-method class. Checked separately because it carries its own
// purity and import rules.
export const RULES_PATTERN = new RegExp(`^rules/${NAME}\\.rules\\.ts$`);

/**
 * Built-ins a rules module may construct: a value, not a collaborator and not
 * a reading of the world. `Date` is deliberately absent — `new Date()` is the
 * clock, the impurity this check exists to keep out of rules.
 */
export const PURE_VALUE_CONSTRUCTORS = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "RegExp",
  "URL",
  "URLSearchParams",
  "TextEncoder",
  "TextDecoder",
  "Uint8Array",
  "Uint16Array",
  "Uint32Array",
  "Int8Array",
  "Int16Array",
  "Int32Array",
  "Float32Array",
  "Float64Array",
  "ArrayBuffer",
  "DataView",
]);

export function isLowerKebabFilename(name) {
  const extension = name.match(/\.[cm]?[jt]sx?$/)?.[0];
  if (!extension) return false;
  if (name.endsWith(".d.ts")) return true;
  const stem = name.slice(0, -extension.length);
  const parts = stem.split(".");
  if (parts.length === 1) return NAME_RE.test(parts[0]);
  if (parts.length === 2 && CANONICAL_ARTIFACTS.has(parts[1])) {
    return NAME_RE.test(parts[0]);
  }
  if (parts.length === 3 && parts[2] === "test" && TEST_LEVELS.has(parts[1])) {
    return NAME_RE.test(parts[0]);
  }
  if (parts.length === 3 && CANONICAL_ARTIFACTS.has(parts[2])) {
    return parts.every((part) => NAME_RE.test(part));
  }
  const hasArtifactSuffix = CANONICAL_ARTIFACTS.has(parts.at(-1));
  if (hasArtifactSuffix) return false;
  // Non-architectural domain qualifiers (generated, native) are retained when
  // their components are already lower kebab case.
  return parts.every((part) => NAME_RE.test(part));
}

export function isStrictServerFilename(name) {
  if (!isLowerKebabFilename(name)) return false;

  const extension = name.match(/\.[cm]?[jt]sx?$/)?.[0];
  if (!extension) return false;
  const parts = name.slice(0, -extension.length).split(".");
  if (parts.length !== 2 || !SERVER_QUALIFIED_ARTIFACTS.has(parts[1])) return true;

  return !SERVER_ARCHITECTURAL_QUALIFIERS.some((qualifier) => parts[0].startsWith(`${qualifier}-`));
}

export const ARTIFACT_PARTS = new Set([
  "app",
  "adapter",
  "api",
  "channel",
  "commands",
  "errors",
  "events",
  "fixture",
  "mapper",
  "migration",
  "port",
  "process",
  "projection",
  "queries",
  "repository",
  "service",
  "store",
  "subscriber",
  "intent",
]);

export const QUALIFIED_ARTIFACTS = new Set([
  "adapter",
  "channel",
  "mapper",
  "migration",
  "repository",
  "store",
]);

export const SUBJECT_ARTIFACT =
  /\.(?:adapter|app|channel|commands|errors|events|intent|process|projection|queries|repository|service|store|subscriber)\.tsx?$/;

export function claimsSubject(candidate, feature, subject) {
  if (candidate === subject) return true;
  return candidate.startsWith(`${feature}-`) && candidate.slice(feature.length + 1) === subject;
}

export function claimedSubjects(path) {
  const filename = path.slice(path.lastIndexOf("/") + 1, -3);
  const parts = filename.split(".");
  const artifact = parts.at(-1);
  if (parts.length >= 3 && artifact && QUALIFIED_ARTIFACTS.has(artifact)) {
    return [parts.at(-2)];
  }
  return parts.filter((part) => !ARTIFACT_PARTS.has(part));
}
