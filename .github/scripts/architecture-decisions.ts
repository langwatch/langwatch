// Finds the PR changes no lint rule or enforcer policy decides (architecture prose, a
// suppression, a new package or module, a rule, gate, exemption, ratchet or budget loosened);
// each trigger names the subject its recorded decision must cite. Lint configs and the gate
// are compared parsed on both sides through a caller-supplied reader that fails closed.
// Spec: specs/ci/pr-architecture-section.feature
import { isDependencyBot } from "./guard-deployment-impact.ts";

export type ChangedFile = {
  filename: string;
  status: string;
  patch?: string;
  /** Set by GitHub on a rename: the path on the base side. */
  previousFilename?: string;
};

export type DecisionTrigger = {
  kind:
    | "architecture-prose"
    | "lint-suppression"
    | "new-package"
    | "new-module"
    | "rule-removed"
    | "rule-loosened"
    | "ignore-added"
    | "policy-dropped"
    | "gate-weakened"
    | "test-gate-changed"
    | "exemption-widened"
    | "ratchet-removed"
    | "ratchet-grown"
    | "budget-raised";
  path: string;
  /** What the decision recording this change must name: a rule id, policy id, pattern or path. */
  subject: string;
  detail: string;
};

/** A file's contents on one side of the pull request, or undefined when it cannot be read. */
export type ContentReader = (args: { path: string; side: "base" | "head" }) => string | undefined;

/** The GitHub files API, paginated with --slurp: an array of pages of entries. */
export const parseChangedFileEntries = (json: string): ChangedFile[] => {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) throw new Error("changed-files JSON is not an array of pages");
  return parsed
    .flatMap((page) => (Array.isArray(page) ? page : [page]))
    .map((entry) => {
      const { filename, status, patch, previous_filename } = (entry ?? {}) as Record<
        string,
        unknown
      >;
      if (typeof filename !== "string" || filename === "") {
        throw new Error(`changed-files entry has no usable filename: ${JSON.stringify(entry)}`);
      }
      return {
        filename,
        status: typeof status === "string" ? status : "modified",
        patch: typeof patch === "string" ? patch : undefined,
        ...(typeof previous_filename === "string" && previous_filename !== ""
          ? { previousFilename: previous_filename }
          : {}),
      };
    });
};

const linesOf = ({ patch, sign }: { patch: string; sign: "+" | "-" }): string[] =>
  patch
    .split("\n")
    .filter((line) => line.startsWith(sign) && !line.startsWith(`${sign.repeat(3)} `))
    .map((line) => line.slice(1));

const ARCHITECTURE_RECORD = "dev/docs/ARCHITECTURE.md";
const SUPPRESSION = /\b(?:oxlint|eslint)-disable\b|\bbiome-ignore\b|\/\/\s*nolint\b/;
/** Where a suppression comment is a test fixture or the rule's own source, not a suppression. */
const RULE_SOURCES = [
  "packages/oxlint-rules/",
  "packages/architecture-enforcer/",
  ".github/scripts/",
];
const NEW_PACKAGE = /^(?:enterprise\/)?(?:modules\/[^/]+\/[^/]+|packages\/[^/]+)\/package\.json$/;
const CATALOGUE = /^(?:enterprise\/)?modules\/catalogue\.json$/;
const LINT_CONFIG = /(?:^|\/)(?:\.oxlintrc[^/]*\.jsonc?|oxlint\.[^/]*\.jsonc?)$/;
const RULE_KEY = /^\s*"([\w@/-]+\/[\w-]+)"\s*:/;
const RULE_FILE = /^packages\/oxlint-rules\/src\/rules\/[^/]+\.rule\.mjs$/;
const POLICY_FILE = /^packages\/architecture-enforcer\/src\/policies\/(?:[^/]+\/)?[^/_]+\.ts$/;
const CI_WORKFLOW = ".github/workflows/langwatch-app-ci.yml";
const POLICIES_LINE = /--policies\s+([\w,-]+)/;

const ruleKeys = (lines: readonly string[]): Set<string> =>
  new Set(lines.flatMap((line) => RULE_KEY.exec(line)?.[1] ?? []));

const policyIds = (lines: readonly string[]): Set<string> =>
  new Set(lines.flatMap((line) => POLICIES_LINE.exec(line)?.[1]?.split(",") ?? []));

const minus = (from: Set<string>, without: Set<string>): string[] =>
  [...from].filter((key) => !without.has(key)).toSorted();

const proseTriggers = (file: ChangedFile): DecisionTrigger[] => {
  if (file.filename !== ARCHITECTURE_RECORD || file.status === "removed") return [];
  if (file.patch === undefined) {
    return [
      {
        kind: "architecture-prose",
        path: file.filename,
        subject: file.filename,
        detail: "too large to read; treated as new prose",
      },
    ];
  }
  const added = linesOf({ patch: file.patch, sign: "+" }).filter((line) =>
    /[\p{L}\p{N}]/u.test(line),
  );
  const removed = new Set(linesOf({ patch: file.patch, sign: "-" }).map((line) => line.trim()));
  const fresh = added.filter((line) => !removed.has(line.trim()));
  return fresh.length === 0
    ? []
    : [
        {
          kind: "architecture-prose",
          path: file.filename,
          subject: file.filename,
          detail: `${fresh.length} new line(s)`,
        },
      ];
};

const suppressionTriggers = (file: ChangedFile): DecisionTrigger[] => {
  if (file.patch === undefined || RULE_SOURCES.some((prefix) => file.filename.startsWith(prefix))) {
    return [];
  }
  const count = linesOf({ patch: file.patch, sign: "+" }).filter((line) =>
    SUPPRESSION.test(line),
  ).length;
  return count === 0
    ? []
    : [
        {
          kind: "lint-suppression",
          path: file.filename,
          subject: file.filename,
          detail: `${count} added`,
        },
      ];
};

const structureTriggers = (file: ChangedFile): DecisionTrigger[] => {
  if (file.status === "added" && NEW_PACKAGE.test(file.filename)) {
    return [
      {
        kind: "new-package",
        path: file.filename,
        subject: file.filename.replace(/\/package\.json$/, ""),
        detail: "a new workspace package",
      },
    ];
  }
  if (CATALOGUE.test(file.filename) && file.patch !== undefined) {
    const roots = linesOf({ patch: file.patch, sign: "+" }).filter((line) =>
      /"root"\s*:/.test(line),
    );
    const gone = new Set(linesOf({ patch: file.patch, sign: "-" }).map((line) => line.trim()));
    const fresh = roots.filter((line) => !gone.has(line.trim()));
    return fresh.map((line): DecisionTrigger => ({
      kind: "new-module",
      path: file.filename,
      subject: /"root"\s*:\s*"([^"]+)"/.exec(line)?.[1] ?? file.filename,
      detail: line.trim(),
    }));
  }
  return [];
};

const removalTriggers = (file: ChangedFile): DecisionTrigger[] => {
  if (
    file.status === "removed" &&
    (RULE_FILE.test(file.filename) || POLICY_FILE.test(file.filename))
  ) {
    return [
      {
        kind: "rule-removed",
        path: file.filename,
        subject: file.filename,
        detail: "the rule's source is deleted",
      },
    ];
  }
  if (file.patch === undefined) return [];
  const added = linesOf({ patch: file.patch, sign: "+" });
  const removed = linesOf({ patch: file.patch, sign: "-" });
  if (LINT_CONFIG.test(file.filename)) {
    return minus(ruleKeys(removed), ruleKeys(added)).map((key): DecisionTrigger => ({
      kind: "rule-removed",
      path: file.filename,
      subject: key,
      detail: key,
    }));
  }
  if (file.filename === CI_WORKFLOW) {
    return minus(policyIds(removed), policyIds(added)).map((id): DecisionTrigger => ({
      kind: "policy-dropped",
      path: file.filename,
      subject: id,
      detail: id,
    }));
  }
  return [];
};

/** A rule's or policy's own source: where an exemption list lives. */
const RULE_SOURCE = /^packages\/(?:oxlint-rules\/src|architecture-enforcer\/src)\/.*\.(?:m?js|ts)$/;
/** A name that marks a list of things a rule lets through. */
const EXEMPTION_NAME = /exempt|allow|legacy|ignor|except|skip|tolerat|permit|writes|inert|partial/i;
/** A finding's `allowed` field: the remedy it tells the author, not a list it lets through. */
const FINDING_REMEDY = /\ballowed\??\s*:/;
const LIST_ENTRY = /^\s*(?:["'`][^"'`]+["'`]|[\w$.]+\s*:\s*.+|\[.+\])\s*,?\s*(?:\/\/.*)?$/;
/** A shrink-only list: a key added or a count raised lets one more finding through. */
const RATCHET_FILE = /(?:^|\/)baselines\/[^/]+\.json$|(?:^|\/)[\w-]+-frozen\.json$/;
const RATCHET_COUNT = /^\s*"([^"]+)"\s*:\s*(\d+)\s*,?\s*$/;
const RATCHET_ENTRY = /^\s*"([^"]+)"\s*,?\s*$/;
const TEST_FILE = /(?:^|\/)(?:__tests__|tests?)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/;
const BUDGET_WORD =
  /budget|ceiling|\bcap\b|caps|limit|max|threshold|lessthan|timeout|_ms\b|\bmb\b|\bms\b/i;
const NUMBER = /\d+(?:[._]\d+)*/g;

/** The hunk lines in order with their signs, so an exemption entry is read in its context. */
const hunkLines = (patch: string): { sign: string; text: string }[] =>
  patch
    .split("\n")
    .filter((line) => !line.startsWith("+++ ") && !line.startsWith("--- "))
    .map((line) => ({ sign: line.slice(0, 1), text: line.slice(1) }));

const exemptionTriggers = (file: ChangedFile): DecisionTrigger[] => {
  if (
    file.patch === undefined ||
    // A new rule's lists are where it starts, not a loosening of anything.
    file.status === "added" ||
    !RULE_SOURCE.test(file.filename) ||
    /__tests__|\.test\./.test(file.filename)
  ) {
    return [];
  }
  // The nearest line above that names an exemption list, cleared when a list closes.
  let context = "";
  let widened = 0;
  for (const { sign, text } of hunkLines(file.patch)) {
    const entry = LIST_ENTRY.test(text);
    if (sign === "+" && entry && EXEMPTION_NAME.test(context)) widened += 1;
    if (entry) continue;
    if (sign === "@" || (EXEMPTION_NAME.test(text) && !FINDING_REMEDY.test(text))) context = text;
    else if (/^\s*[\]}]/.test(text)) context = "";
  }
  return widened === 0
    ? []
    : [
        {
          kind: "exemption-widened",
          path: file.filename,
          subject: file.filename,
          detail: `${widened} entry(ies) added to an exemption list`,
        },
      ];
};

const ratchetTriggers = (file: ChangedFile): DecisionTrigger[] => {
  // A new list freezes a new rule's findings: that tightens, it does not loosen.
  // A renamed one is read like a modified one: a rename can carry raised counts.
  if (!RATCHET_FILE.test(file.filename)) return [];
  if (file.status !== "modified" && file.status !== "renamed") return [];
  // A pure rename has no patch; ratchetRemovalTriggers names the old path.
  if (file.patch === undefined && file.status === "renamed") return [];
  if (file.patch === undefined) {
    return [
      {
        kind: "ratchet-grown",
        path: file.filename,
        subject: file.filename,
        detail: "too large to read; treated as grown",
      },
    ];
  }
  const counts = ({ sign }: { sign: "+" | "-" }): Map<string, number> =>
    new Map(
      linesOf({ patch: file.patch ?? "", sign }).flatMap((line) => {
        const match = RATCHET_COUNT.exec(line);
        return match ? [[match[1]!, Number(match[2])] as const] : [];
      }),
    );
  const entries = ({ sign }: { sign: "+" | "-" }): Set<string> =>
    new Set(
      linesOf({ patch: file.patch ?? "", sign }).flatMap(
        (line) => RATCHET_ENTRY.exec(line)?.[1] ?? [],
      ),
    );
  const before = counts({ sign: "-" });
  const grown = [...counts({ sign: "+" })]
    .filter(([key, count]) => count > (before.get(key) ?? 0))
    .map(([key]) => key);
  const removedEntries = entries({ sign: "-" });
  const added = [...entries({ sign: "+" })].filter((key) => !removedEntries.has(key));
  const all = [...grown, ...added];
  return all.length === 0
    ? []
    : [
        {
          kind: "ratchet-grown",
          path: file.filename,
          subject: file.filename,
          detail: `${all.length} key(s) added or raised: ${all.slice(0, 3).join(", ")}`,
        },
      ];
};

const numbersOf = (line: string): number[] =>
  [...line.matchAll(NUMBER)].map((match) => Number(match[0].replace(/_/g, "")));

const budgetTriggers = (file: ChangedFile): DecisionTrigger[] => {
  if (file.patch === undefined || !TEST_FILE.test(file.filename)) return [];
  const removed = linesOf({ patch: file.patch, sign: "-" });
  const added = linesOf({ patch: file.patch, sign: "+" });
  const shape = (line: string): string => line.replace(NUMBER, "#").trim();
  const raised = added.filter((line) => {
    if (!BUDGET_WORD.test(line)) return false;
    const before = removed.find((old) => shape(old) === shape(line));
    if (before === undefined) return false;
    const [was, now] = [numbersOf(before), numbersOf(line)];
    return now.some((value, index) => value > (was[index] ?? value));
  });
  return raised.length === 0
    ? []
    : [
        {
          kind: "budget-raised",
          path: file.filename,
          subject: file.filename,
          detail: raised
            .map((line) => line.trim())
            .slice(0, 2)
            .join(" | "),
        },
      ];
};

/** Where the enforcer's ratchet tests and their baselines live: deleting one removes a check. */
const ENFORCER_TESTS = /^packages\/architecture-enforcer\/tests\//;

const ratchetRemovalTriggers = (file: ChangedFile): DecisionTrigger[] => {
  if (file.status !== "removed" && file.status !== "renamed") return [];
  const path = file.previousFilename ?? file.filename;
  if (!ENFORCER_TESTS.test(path) && !RATCHET_FILE.test(path)) return [];
  return [
    {
      kind: "ratchet-removed",
      path,
      subject: path,
      detail: file.status === "removed" ? "deleted" : `renamed to ${file.filename}`,
    },
  ];
};

/** Whitespace and comments read from a position: what may sit between a comma and its bracket. */
const GAP = /(?:\s|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*/y;

/** The index just past the string literal opening at `index`. */
const stringEndOf = ({ text, index }: { text: string; index: number }): number => {
  let end = index + 1;
  while (end < text.length && text[end] !== '"') end += text[end] === "\\" ? 2 : 1;
  return end + 1;
};

const isTrailingComma = ({ text, index }: { text: string; index: number }): boolean => {
  GAP.lastIndex = index + 1;
  GAP.exec(text);
  const next = text[GAP.lastIndex];
  return next === "]" || next === "}";
};

/** One JSONC token at `index`: the JSON it contributes and where the next one starts. */
const jsoncStep = ({
  text,
  index,
}: {
  text: string;
  index: number;
}): { emit: string; next: number } => {
  const char = text[index]!;
  const pair = text.slice(index, index + 2);
  if (char === '"') {
    const next = stringEndOf({ text, index });
    return { emit: text.slice(index, next), next };
  }
  if (pair === "//") {
    const newline = text.indexOf("\n", index);
    return { emit: "", next: newline === -1 ? text.length : newline };
  }
  if (pair === "/*") {
    const end = text.indexOf("*/", index + 2);
    return { emit: "", next: end === -1 ? text.length : end + 2 };
  }
  if (char === ",") return { emit: isTrailingComma({ text, index }) ? "" : char, next: index + 1 };
  return { emit: char, next: index + 1 };
};

/** JSONC to JSON: comments and trailing commas dropped, strings left alone. */
const stripJsonc = (text: string): string => {
  let out = "";
  let index = 0;
  while (index < text.length) {
    const { emit, next } = jsoncStep({ text, index });
    out += emit;
    index = next;
  }
  return out;
};

const parseJsonc = (text: string): unknown => {
  try {
    return JSON.parse(stripJsonc(text));
  } catch {
    return undefined;
  }
};

type Json = Record<string, unknown>;
const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const stringsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const SEVERITY: Readonly<Record<string, number>> = {
  off: 0,
  allow: 0,
  warn: 1,
  warning: 1,
  error: 2,
  deny: 2,
};

/** A rule setting's severity, 0 (off) to 2 (error), or undefined when it names none. */
const severityOf = (value: unknown): number | undefined => {
  const level = Array.isArray(value) ? value[0] : value;
  if (typeof level === "number") return level >= 0 && level <= 2 ? level : undefined;
  return typeof level === "string" ? SEVERITY[level.toLowerCase()] : undefined;
};

const severityName = (rank: number | undefined): string =>
  rank === undefined ? "unset" : (["off", "warn", "error"][rank] ?? String(rank));

/** The scope a config entry applies to: "" for the whole config, otherwise one override glob. */
const TOP = "";

type LintModel = {
  /** scope -> rule id -> setting. Each override glob is its own scope; widening one adds one. */
  rules: Map<string, Map<string, unknown>>;
  /** The paths the config tells the linter to skip. */
  ignores: Set<string>;
  /** override glob -> the paths excluded from it, which escape whatever it enforces. */
  excludes: Map<string, Set<string>>;
};

const settingsOf = (entry: Json): [string, unknown][] => [
  ...Object.entries(isRecord(entry.rules) ? entry.rules : {}),
  ...Object.entries(isRecord(entry.categories) ? entry.categories : {}).map(
    ([name, value]): [string, unknown] => [`category:${name}`, value],
  ),
];

const setRules = ({
  rules,
  scope,
  entry,
}: {
  rules: LintModel["rules"];
  scope: string;
  entry: Json;
}): void => {
  const map = rules.get(scope) ?? new Map<string, unknown>();
  for (const [id, value] of settingsOf(entry)) map.set(id, value);
  rules.set(scope, map);
};

const addOverride = ({
  override,
  rules,
  excludes,
}: {
  override: Json;
  rules: LintModel["rules"];
  excludes: LintModel["excludes"];
}): void => {
  for (const glob of stringsOf(override.files)) {
    setRules({ rules, scope: glob, entry: override });
    const held = excludes.get(glob) ?? new Set<string>();
    for (const excluded of stringsOf(override.excludeFiles)) held.add(excluded);
    excludes.set(glob, held);
  }
};

const lintModelOf = (config: Json): LintModel => {
  const rules: LintModel["rules"] = new Map();
  setRules({ rules, scope: TOP, entry: config });
  const ignores = new Set([...stringsOf(config.ignorePatterns), ...stringsOf(config.ignores)]);
  const excludes: LintModel["excludes"] = new Map();
  for (const override of Array.isArray(config.overrides) ? config.overrides : []) {
    if (isRecord(override)) addOverride({ override, rules, excludes });
  }
  return { rules, ignores, excludes };
};

type OptionPair<T> = { before: T; after: T; at: string };

const lastKeyOf = (at: string): string => at.split(".").pop() ?? "";

const numberLoosenings = ({ before, after, at }: OptionPair<number>): string[] => {
  const looser = /^min/i.test(lastKeyOf(at)) ? after < before : after > before;
  return looser ? [`${at} ${before} -> ${after}`] : [];
};

const arrayLoosenings = ({ before, after, at }: OptionPair<unknown[]>): string[] => {
  if (EXEMPTION_NAME.test(lastKeyOf(at))) {
    const had = new Set(stringsOf(before));
    const added = stringsOf(after).filter((item) => !had.has(item));
    if (added.length > 0) return [`${at} gained ${added.join(", ")}`];
  }
  return after.flatMap((item, index) =>
    optionLoosenings({ before: before[index], after: item, at: `${at}[${index}]` }),
  );
};

const recordLoosenings = ({ before, after, at }: OptionPair<Json>): string[] =>
  Object.keys(after).flatMap((key) =>
    key in before
      ? optionLoosenings({ before: before[key], after: after[key], at: at ? `${at}.${key}` : key })
      : [],
  );

/** Where raising a number lets more through; for a `min*` option lowering it does. */
const optionLoosenings = ({ before, after, at }: OptionPair<unknown>): string[] => {
  if (typeof before === "number" && typeof after === "number") {
    return numberLoosenings({ before, after, at });
  }
  if (Array.isArray(before) && Array.isArray(after)) return arrayLoosenings({ before, after, at });
  if (isRecord(before) && isRecord(after)) return recordLoosenings({ before, after, at });
  return [];
};

const optionsOf = (value: unknown): unknown[] => (Array.isArray(value) ? value.slice(1) : []);

type Loosening = { id: string; detail: string };

/** A rule's setting in one scope, falling back to the whole-config setting. */
const settingIn = ({
  model,
  scope,
  id,
}: {
  model: LintModel;
  scope: string;
  id: string;
}): unknown => {
  const inScope = model.rules.get(scope);
  return inScope?.has(id) ? inScope.get(id) : model.rules.get(TOP)?.get(id);
};

/** How one rule in one scope is loosened; an unknown setting is enforced before, off after. */
const ruleLoosenings = ({
  before,
  after,
  scope,
  id,
}: {
  before: LintModel;
  after: LintModel;
  scope: string;
  id: string;
}): Loosening[] => {
  const valueBefore = settingIn({ model: before, scope, id });
  const valueAfter = settingIn({ model: after, scope, id });
  const rankBefore = severityOf(valueBefore) ?? (valueBefore === undefined ? 2 : undefined);
  const rankAfter = severityOf(valueAfter) ?? (valueAfter === undefined ? 0 : undefined);
  const where = scope === TOP ? "" : ` for ${scope}`;
  if (rankBefore !== undefined && rankAfter !== undefined && rankAfter < rankBefore) {
    const [from, to] = [
      severityName(severityOf(valueBefore)),
      severityName(severityOf(valueAfter)),
    ];
    return [{ id, detail: `${id} ${from} -> ${to}${where}` }];
  }
  return optionLoosenings({
    before: optionsOf(valueBefore),
    after: optionsOf(valueAfter),
    at: "",
  }).map((change) => ({ id, detail: `${id} option ${change.replace(/^\[\d+\]\.?/, "")}${where}` }));
};

const scopeLoosenings = ({
  before,
  after,
  scope,
}: {
  before: LintModel;
  after: LintModel;
  scope: string;
}): Loosening[] => {
  const was = before.rules.get(scope) ?? new Map<string, unknown>();
  const now = after.rules.get(scope) ?? new Map<string, unknown>();
  return (
    [...new Set([...was.keys(), ...now.keys()])]
      // A whole-config rule that is gone is rule-removed's business.
      .filter((id) => scope !== TOP || now.has(id))
      .flatMap((id) => ruleLoosenings({ before, after, scope, id }))
  );
};

/**
 * Every rule a config enforces less after the change: a severity lowered, a rule
 * turned down for a new glob, a glob dropped from an override that enforced it,
 * or a numeric option raised. A missing fact never hides a loosening.
 */
const lintLoosenings = ({ before, after }: { before: LintModel; after: LintModel }): Loosening[] =>
  [...new Set([...before.rules.keys(), ...after.rules.keys()])].flatMap((scope) =>
    scopeLoosenings({ before, after, scope }),
  );

/** One trigger per subject, details joined, so a rule loosened for ten globs is one citation. */
const bySubject = (triggers: readonly DecisionTrigger[]): DecisionTrigger[] => {
  const merged = new Map<string, DecisionTrigger>();
  for (const trigger of triggers) {
    const key = `${trigger.kind}\u0000${trigger.path}\u0000${trigger.subject}`;
    const held = merged.get(key);
    merged.set(
      key,
      held === undefined ? trigger : { ...held, detail: `${held.detail}; ${trigger.detail}` },
    );
  }
  return [...merged.values()];
};

const lintConfigTriggers = ({
  file,
  read,
}: {
  file: ChangedFile;
  read: ContentReader | undefined;
}): DecisionTrigger[] => {
  // A new config loosens nothing that existed; a deleted one is read by its removed rule keys.
  if (read === undefined || !LINT_CONFIG.test(file.filename)) return [];
  if (file.status !== "modified" && file.status !== "renamed") return [];
  const basePath = file.previousFilename ?? file.filename;
  const before = parseJsonc(read({ path: basePath, side: "base" }) ?? "");
  const after = parseJsonc(read({ path: file.filename, side: "head" }) ?? "");
  if (!isRecord(before) || !isRecord(after)) {
    return [
      {
        kind: "rule-loosened",
        path: file.filename,
        subject: file.filename,
        detail: "could not read or parse the config on both sides; treated as loosened",
      },
    ];
  }
  const [was, now] = [lintModelOf(before), lintModelOf(after)];
  const loosened = lintLoosenings({ before: was, after: now }).map(
    ({ id, detail }): DecisionTrigger => ({
      kind: "rule-loosened",
      path: file.filename,
      subject: id,
      detail,
    }),
  );
  const ignore = ({ pattern, detail }: { pattern: string; detail: string }): DecisionTrigger => ({
    kind: "ignore-added",
    path: file.filename,
    subject: pattern,
    detail,
  });
  const ignored = [...now.ignores]
    .filter((pattern) => !was.ignores.has(pattern))
    .map((pattern) => ignore({ pattern, detail: `ignores ${pattern}` }));
  // An exclusion added to an override that already applied; a new override's narrow nothing.
  const excluded = [...now.excludes].flatMap(([glob, patterns]) => {
    const had = was.excludes.get(glob);
    if (had === undefined) return [];
    return [...patterns]
      .filter((pattern) => !had.has(pattern))
      .map((pattern) =>
        ignore({ pattern, detail: `excludes ${pattern} from the override for ${glob}` }),
      );
  });
  return bySubject([...loosened, ...ignored, ...excluded]);
};

/**
 * The CI steps that run the enforcer's policies, its ratchet tests and the
 * lint rules' tests. Making one skippable, or changing what it runs, switches
 * those checks off without deleting a line of them.
 */
const GATE_STEPS = [
  "Architecture lint (blocking)",
  "Architecture policy tests (blocking)",
  "Oxlint rule tests (blocking)",
] as const;

type GateShape = { step: Map<string, string>; job: Map<string, string> };

/** A YAML mapping's keys at one indent, each with its value and continuation lines as text. */
const keysAt = ({
  lines,
  indent,
}: {
  lines: readonly string[];
  indent: number;
}): Map<string, string> => {
  const keys = new Map<string, string>();
  let current: string | undefined;
  for (const line of lines) {
    const width = line.length - line.trimStart().length;
    const text = line.trim();
    const key = width === indent ? /^([\w-]+):\s*(.*)$/.exec(text) : null;
    if (key) {
      current = key[1]!;
      keys.set(current, key[2]!.trim());
    } else if (current !== undefined && text !== "" && !text.startsWith("#") && width > indent) {
      keys.set(current, `${keys.get(current)} ${text}`.trim());
    }
  }
  return keys;
};

const indentOf = (line: string): number => line.length - line.trimStart().length;

/** A blank line, a comment, or a line indented past the step's dash belongs to the step. */
const isInsideStep = ({ line, dash }: { line: string; dash: number }): boolean => {
  const text = line.trim();
  return text === "" || text.startsWith("#") || indentOf(line) > dash;
};

/** The gate step's keys and its job's keys, or undefined when the workflow has no gate step. */
const gateShapeOf = ({
  workflow,
  step,
}: {
  workflow: string;
  step: string;
}): GateShape | undefined => {
  const lines = workflow.replace(/\r\n?/g, "\n").split("\n");
  const name = lines.findIndex((line) =>
    new RegExp(
      `^\\s*(?:-\\s+)?name:\\s*["']?${step.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']?\\s*$`,
    ).test(line),
  );
  if (name === -1) return undefined;
  let start = name;
  while (start > 0 && !/^\s*-\s/.test(lines[start]!)) start -= 1;
  const dash = indentOf(lines[start]!);
  let end = start + 1;
  while (end < lines.length && isInsideStep({ line: lines[end]!, dash })) end += 1;
  const stepLines = lines
    .slice(start, end)
    .map((line, index) => (index === 0 ? line.replace("-", " ") : line));
  let job = start;
  while (job > 0 && !/^ {2}[\w-]+:\s*$/.test(lines[job]!)) job -= 1;
  const steps = lines.findIndex((line, index) => index > job && /^ {4}steps:\s*$/.test(line));
  return {
    step: keysAt({ lines: stepLines, indent: dash + 2 }),
    job: keysAt({ lines: lines.slice(job + 1, steps === -1 ? start : steps), indent: 4 }),
  };
};

const SKIP_KEYS = ["if", "continue-on-error"];
/** The gate's command with its policy list taken out: that list is policy-dropped's business. */
const commandOf = (run: string | undefined): string =>
  (run ?? "")
    .replace(/^[>|][-+]?\s*/, "")
    .replace(POLICIES_LINE, "--policies")
    .replace(/\s+/g, " ")
    .trim();

const stepChanges = ({ before, after }: { before: GateShape; after: GateShape }): string[] => {
  const commandBefore = commandOf(before.step.get("run"));
  const commandAfter = commandOf(after.step.get("run"));
  return [
    ...SKIP_KEYS.flatMap((key) =>
      before.step.get(key) === after.step.get(key)
        ? []
        : [
            `step ${key}: ${before.step.get(key) ?? "(none)"} -> ${after.step.get(key) ?? "(none)"}`,
          ],
    ),
    ...SKIP_KEYS.flatMap((key) =>
      before.job.get(key) === after.job.get(key)
        ? []
        : [`job ${key}: ${before.job.get(key) ?? "(none)"} -> ${after.job.get(key) ?? "(none)"}`],
    ),
    ...(commandBefore === commandAfter ? [] : [`command: ${commandBefore} -> ${commandAfter}`]),
  ];
};

const gateTriggers = ({
  file,
  read,
}: {
  file: ChangedFile;
  read: ContentReader | undefined;
}): DecisionTrigger[] => {
  if (file.filename !== CI_WORKFLOW && file.previousFilename !== CI_WORKFLOW) return [];
  const trigger = ({ step, detail }: { step: string; detail: string }): DecisionTrigger => ({
    kind: "gate-weakened",
    path: CI_WORKFLOW,
    subject: step,
    detail,
  });
  const every = (detail: string): DecisionTrigger[] =>
    GATE_STEPS.map((step) => trigger({ step, detail }));
  if (file.status === "removed") return every("the CI workflow is deleted");
  if (read === undefined) return [];
  const beforeText = read({ path: CI_WORKFLOW, side: "base" });
  const afterText = read({ path: file.filename, side: "head" });
  if (beforeText === undefined || afterText === undefined) {
    return every("could not read the workflow on both sides; treated as weakened");
  }
  return GATE_STEPS.flatMap((step) => {
    const before = gateShapeOf({ workflow: beforeText, step });
    if (before === undefined) return [];
    const after = gateShapeOf({ workflow: afterText, step });
    if (after === undefined) return [trigger({ step, detail: "the step is removed" })];
    const changes = stepChanges({ before, after });
    return changes.length === 0 ? [] : [trigger({ step, detail: changes.join("; ") })];
  });
};

/** The packages whose tests are the ratchets and the rules' own checks. */
const TEST_PACKAGES = /^packages\/(?:architecture-enforcer|oxlint-rules)\//;
const TEST_MANIFEST = /^packages\/(?:architecture-enforcer|oxlint-rules)\/package\.json$/;
const VITEST_CONFIG = /(?:^|\/)vitest(?:\.[\w-]+)*\.config\.[cm]?[jt]s$/;

/**
 * A change to what runs those packages' tests: their vitest config added,
 * changed or removed, or their `test` script changed. Narrowing an include
 * glob skips a ratchet as surely as deleting it.
 */
const isRunnerConfig = (name: string): boolean =>
  TEST_PACKAGES.test(name) && VITEST_CONFIG.test(name);

/** A manifest's `test` script, null when it has none, undefined when it cannot be read. */
const testScriptOf = ({
  read,
  path,
  side,
}: {
  read: ContentReader;
  path: string;
  side: "base" | "head";
}): unknown => {
  const text = read({ path, side });
  if (text === undefined) return undefined;
  try {
    const manifest: unknown = JSON.parse(text);
    const scripts = isRecord(manifest) ? manifest.scripts : undefined;
    return isRecord(scripts) ? (scripts.test ?? null) : null;
  } catch {
    return undefined;
  }
};

/** How a test package's manifest changed what runs its tests, or undefined when it did not. */
const manifestChange = ({
  file,
  read,
  basePath,
}: {
  file: ChangedFile;
  read: ContentReader | undefined;
  basePath: string;
}): string | undefined => {
  if (file.status === "removed" || file.status === "renamed") {
    return `the package manifest is ${file.status}`;
  }
  if (read === undefined) {
    const touched = /^[-+]\s*"test"\s*:/m.test(file.patch ?? "");
    return touched || file.patch === undefined ? "the test script changed" : undefined;
  }
  if (file.status === "added") return undefined;
  const before = testScriptOf({ read, path: basePath, side: "base" });
  const after = testScriptOf({ read, path: file.filename, side: "head" });
  if (before === undefined || after === undefined) {
    return "could not read the manifest on both sides; treated as changed";
  }
  return before === after
    ? undefined
    : `test script: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`;
};

const testRunnerTriggers = ({
  file,
  read,
}: {
  file: ChangedFile;
  read: ContentReader | undefined;
}): DecisionTrigger[] => {
  const basePath = file.previousFilename ?? file.filename;
  const paths = [basePath, file.filename];
  const trigger = (detail: string): DecisionTrigger => ({
    kind: "test-gate-changed",
    path: file.filename,
    subject: file.filename,
    detail,
  });
  if (paths.some(isRunnerConfig)) return [trigger(`vitest config ${file.status}`)];
  if (!paths.some((name) => TEST_MANIFEST.test(name))) return [];
  const change = manifestChange({ file, read, basePath });
  return change === undefined ? [] : [trigger(change)];
};

/**
 * Every change in the PR that no check decides. A dependency bot's PR makes
 * none. `read` supplies a file's contents on each side; without it, lint
 * configs and the gate are read from their diff lines only.
 */
export const findDecisionTriggers = ({
  files,
  author,
  read,
}: {
  files: readonly ChangedFile[];
  author: string;
  read?: ContentReader;
}): DecisionTrigger[] =>
  isDependencyBot(author)
    ? []
    : files.flatMap((file) => [
        ...proseTriggers(file),
        ...suppressionTriggers(file),
        ...structureTriggers(file),
        ...removalTriggers(file),
        ...lintConfigTriggers({ file, read }),
        ...gateTriggers({ file, read }),
        ...testRunnerTriggers({ file, read }),
        ...exemptionTriggers(file),
        ...ratchetRemovalTriggers(file),
        ...ratchetTriggers(file),
        ...budgetTriggers(file),
      ]);

/** What a decision's `Rule:` may name: lint rules, enforcer policies, their specs, the gate. */
export const isRulePath = (path: string): boolean =>
  /^packages\/(?:oxlint-rules|architecture-enforcer)\//.test(path) ||
  LINT_CONFIG.test(path) ||
  path === CI_WORKFLOW;

/** A shrink-only list: the debt a rule tolerates, never the rule that encodes a decision. */
export const isBaselinePath = (path: string): boolean =>
  RATCHET_FILE.test(path) || /(?:^|\/)tests\/baselines\//.test(path);

/**
 * Kinds that loosen a config, the gate or a ratchet in their own file, so that file cannot
 * be the rule answering them. An exemption in a rule's source is absent: changing that rule
 * is a legitimate answer to it.
 */
const LOOSENING_KINDS: ReadonlySet<DecisionTrigger["kind"]> = new Set([
  "rule-removed",
  "rule-loosened",
  "ignore-added",
  "policy-dropped",
  "gate-weakened",
  "test-gate-changed",
  "ratchet-removed",
  "ratchet-grown",
]);

export const loosensItsFile = (trigger: DecisionTrigger): boolean =>
  LOOSENING_KINDS.has(trigger.kind);
