// The strict feature layout grammar: what a source file inside a feature
// package may be called and where it may sit. The oxlint rules
// `feature-source-filename`, `feature-source-layout` and
// `feature-source-subject` decide with these; the CLI imports the same
// patterns for the checks that need the whole package graph.

export const NAME = "[a-z0-9]+(?:-[a-z0-9]+)*";
const NAME_RE = new RegExp(`^${NAME}$`);

/**
 * Every artifact suffix the layout knows, once. `side` is the half it may sit
 * in; `canonical` lets it end a filename; `subject` makes the name before it a
 * claimed subject; `qualified` lets a tier or backend segment precede that name.
 */
const ARTIFACT_TABLE = {
  api: { side: "process", canonical: true },
  app: { side: "contract", canonical: true, subject: true },
  channel: { side: "process", canonical: true, subject: true, qualified: true },
  commands: { side: "contract", canonical: true, subject: true },
  composition: { side: "process", canonical: true },
  errors: { side: "contract", canonical: true, subject: true },
  events: { side: "contract", canonical: true, subject: true },
  fixture: {},
  intent: { side: "process", canonical: true, subject: true },
  mapper: { side: "process", qualified: true },
  migration: { side: "process", canonical: true, qualified: true },
  process: { side: "process", canonical: true, subject: true },
  projection: { side: "process", canonical: true, subject: true },
  queries: { side: "contract", canonical: true, subject: true },
  repository: { side: "process", canonical: true, subject: true, qualified: true },
  rules: { side: "process", canonical: true },
  service: { side: "contract", canonical: true, subject: true },
  store: { side: "process", canonical: true, subject: true, qualified: true },
  subscriber: { side: "process", canonical: true, subject: true },
  task: { side: "process", canonical: true },
};

function artifactsWhere(predicate) {
  return Object.keys(ARTIFACT_TABLE).filter((name) => predicate(ARTIFACT_TABLE[name]));
}

export const CANONICAL_ARTIFACTS = new Set(artifactsWhere((artifact) => artifact.canonical));
export const ARTIFACT_PARTS = new Set(Object.keys(ARTIFACT_TABLE));
export const QUALIFIED_ARTIFACTS = new Set(artifactsWhere((artifact) => artifact.qualified));
const CONTRACT_ARTIFACTS = artifactsWhere((artifact) => artifact.side === "contract").join("|");
const PROCESS_ONLY_ARTIFACTS = artifactsWhere((artifact) => artifact.side === "process");

/** The process-only suffixes, in prose, for the message that refuses one in a contract. */
export const PROCESS_ONLY_ARTIFACT_LIST = PROCESS_ONLY_ARTIFACTS.map((name) => `\`.${name}\``).join(
  ", ",
);

export const TEST_LEVELS = new Set(["unit", "integration", "e2e"]);

/** Test sources, at any depth; the same definition `classify` uses, so the two cannot disagree. */
export const TEST_DIRECTORY = /(?:^|\/)(?:__tests__|__mocks__|tests)(?:\/|$)/;

export const PROCESS_QUALIFIERS = [
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
export const CHANNEL_TIERS = ["eventing", "http", "memory", "redis", "s3", "ses", "slack", "sqs"];
const CHANNEL_TIER = CHANNEL_TIERS.join("|");

/** The feature API token has one portable home; other API modules are transports. */
export function isFeatureApiContract(sourcePath, feature) {
  return sourcePath === `${feature}.api.ts`;
}

export const CONTRACT_ARTIFACT = new RegExp(`^${NAME}\\.(?:${CONTRACT_ARTIFACTS})\\.ts$`);
export const PROCESS_ONLY_CONTRACT_ARTIFACT = new RegExp(
  `\\.(?:${PROCESS_ONLY_ARTIFACTS.join("|")})\\.ts$`,
);
export const CONTRACT_ARTIFACT_SUFFIX = new RegExp(`\\.(?:${CONTRACT_ARTIFACTS})\\.ts$`);
export const CONTRACT_ARTIFACT_ONLY = new RegExp(`^(?:${CONTRACT_ARTIFACTS})\\.ts$`);

/**
 * The closed list of process-source homes, in prose, for the message a refused
 * file prints. A test pins it to `PROCESS_PATTERNS` so the two cannot drift.
 */
export const PROCESS_HOMES =
  "index.ts, <feature>.server.ts, app/<feature>.app.ts, app/<feature>.members.ts, " +
  "transport/<feature>.<rest|trpc|ws>.ts, services/<name>.service.ts, " +
  "repositories/ (interfaces, the bundle, the registry, and a backend folder beside them), " +
  "channels/ (the interface, the bundle, the registry, and a tier folder beside them), " +
  "eventing/<feature>.pipeline.ts and what it names, rules/<name>.rules.ts, " +
  "tasks/<name>.task.ts, migrations/, " +
  "app/<feature>-composition.build.ts (the ported process composition a converted module still carries; it only shrinks)";

export const PROCESS_PATTERNS = [
  /^index\.ts$/,
  new RegExp(`^${NAME}\\.server\\.ts$`),
  new RegExp(`^app/${NAME}\\.app\\.ts$`),
  // The closed record of members a process hands the app (ADR-144), declared
  // beside the app it feeds.
  new RegExp(`^app/${NAME}\\.members\\.ts$`),
  // The ported process composition a converted module still carries. A named,
  // documented artifact rather than a refusal, because redlining it mid-recovery
  // helps nobody; the expectation is that it shrinks to nothing as repositories
  // and members conversion completes (ADR-144).
  new RegExp(`^app/${NAME}-composition\\.build\\.ts$`),
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
  // Event sourcing is one folder, not six. The pipeline declares the aggregate,
  // its events, its projections, its subscribers, its process managers and its
  // commands through `definePipeline` from `@langwatch/eventing`; the files
  // beside it hold what that declaration names.
  new RegExp(`^eventing/${NAME}\\.pipeline\\.ts$`),
  new RegExp(
    `^eventing/${NAME}\\.(?:events|commands|schemas|projection|subscriber|process|intent|store)\\.ts$`,
  ),
  new RegExp(
    `^eventing/(${NAME})/(?:${NAME}|\\1\\.${NAME})\\.(?:events|commands|schemas|projection|subscriber|process|intent|store)\\.ts$`,
  ),
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

export function isStrictProcessFilename(name) {
  if (!isLowerKebabFilename(name)) return false;

  const extension = name.match(/\.[cm]?[jt]sx?$/)?.[0];
  if (!extension) return false;
  const parts = name.slice(0, -extension.length).split(".");
  if (parts.length !== 2 || !QUALIFIED_ARTIFACTS.has(parts[1])) return true;

  return !PROCESS_QUALIFIERS.some((qualifier) => parts[0].startsWith(`${qualifier}-`));
}

export const SUBJECT_ARTIFACT = new RegExp(
  `\\.(?:${artifactsWhere((artifact) => artifact.subject).join("|")})\\.tsx?$`,
);

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
