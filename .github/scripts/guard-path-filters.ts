// Guards the rules that make a native `on.paths` filter safe (R1: filter not
// a superset of an internal gate; R2: filter contradicts a `*-complete`
// aggregator; R3: an unparseable filter reported rather than passed).
// Dependency-free and line-based — no YAML library on a bare runner.
// Spec: specs/ci/path-filters.feature

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface WorkflowIssue {
  file: string;
  rule: "R1" | "R2" | "R3";
  detail: string;
}

/** What the pull-request trigger says about path filtering. */
export type FilterResult =
  | { kind: "none" }
  | { kind: "filtered"; entries: string[] }
  | { kind: "unparsed"; detail: string };

const indentOf = (line: string): number => line.length - line.trimStart().length;

const isBlank = (line: string): boolean => line.trim() === "" || line.trim().startsWith("#");

/** Lines of the block introduced at `startIndex`, excluding the key line. */
export const blockUnder = (lines: string[], startIndex: number, indent: number): string[] => {
  const out: string[] = [];
  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (isBlank(line)) {
      out.push(line);
      continue;
    }
    if (indentOf(line) <= indent) break;
    out.push(line);
  }
  return out;
};

/** Strip one layer of matching quotes, and any trailing `# comment`. */
const unquote = (raw: string): string => {
  const quoted = raw.match(/^(['"])(.*?)\1\s*(?:#.*)?$/);
  if (quoted) return quoted[2]!;
  return raw.replace(/\s+#.*$/, "").trim();
};

/** Every `- value` entry in a block, unquoted, comments dropped. */
export const listEntries = (lines: string[]): string[] => {
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("- ")) continue;
    const raw = trimmed.slice(2).trim();
    if (raw.startsWith("#")) continue;
    const value = unquote(raw);
    if (value !== "") out.push(value);
  }
  return out;
};

/** `[a, "b", 'c']` → the three entries. */
const flowEntries = (value: string): string[] =>
  value
    .slice(1, -1)
    .split(",")
    .map((part) => unquote(part.trim()))
    .filter((part) => part !== "");

/**
 * Index of a key at exactly `indent`, allowing the quoted forms. YAML 1.1
 * reads a bare `on` as the boolean true, so `"on":` is a legitimate spelling
 * and used to slip past this guard entirely.
 */
const findKeyIndex = (lines: string[], key: string, indent: number): number =>
  lines.findIndex((line) => {
    if (isBlank(line) || indentOf(line) !== indent) return false;
    return new RegExp(`^(['"]?)${key}\\1\\s*:`).test(line.trim());
  });

/** Index of a key at ANY indent greater than `minIndent`. */
const findKeyAnyIndent = (lines: string[], keys: string[], minIndent: number): number =>
  lines.findIndex((line) => {
    if (isBlank(line) || indentOf(line) <= minIndent) return false;
    const trimmed = line.trim();
    return keys.some((key) => new RegExp(`^(['"]?)${key}\\1\\s*:`).test(trimmed));
  });

/**
 * Drop a trailing `# comment`, but only where YAML would treat it as one: a
 * `#` starts a comment only outside a quoted scalar and preceded by
 * whitespace, so `["a#b"]` and `"pkg # b/**"` both keep their hash.
 */
export const stripComment = (line: string): string => {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === "#" && (i === 0 || /\s/.test(line[i - 1]!))) {
      return line.slice(0, i).trimEnd();
    }
  }
  return line;
};

/**
 * The text after `key:` on its own line, with any trailing comment removed.
 * `paths:  # only the Go tree` is a block list with a note on the key line,
 * not an inline value — without the strip it read as an undecomposable value.
 */
const inlineValue = (line: string): string =>
  stripComment(line.trim())
    .replace(/^(['"]?)[a-z_-]+\1\s*:\s*/i, "")
    .trim();

/**
 * Does the pull-request trigger filter by path, and if so, on what? Covers
 * `pull_request`/`pull_request_target`, `paths`/`paths-ignore`, block and
 * flow sequences, quoted keys, any indentation — else comes back `unparsed`.
 */
export const pullRequestFilter = (source: string): FilterResult => {
  const lines = source.split("\n");
  const onIndex = findKeyIndex(lines, "on", 0);
  if (onIndex === -1) return { kind: "none" };

  const onBlock = blockUnder(lines, onIndex, 0);
  const prIndex = findKeyAnyIndent(onBlock, ["pull_request", "pull_request_target"], -1);
  if (prIndex === -1) return { kind: "none" };

  const prLine = onBlock[prIndex]!;
  const prBlock = blockUnder(onBlock, prIndex, indentOf(prLine));
  const pathsIndex = findKeyAnyIndent(prBlock, ["paths", "paths-ignore"], -1);
  if (pathsIndex === -1) return { kind: "none" };

  const pathsLine = prBlock[pathsIndex]!;
  const key = pathsLine.trim().split(":")[0]!.replace(/['"]/g, "");
  const value = inlineValue(pathsLine);

  // `paths-ignore` filters the workflow just as much as `paths` — it is the
  // same R2 contradiction — but its entries are exclusions, so treating them
  // as a coverage list would be wrong. Report rather than guess.
  if (key === "paths-ignore") {
    return {
      kind: "unparsed",
      detail:
        "uses `paths-ignore`, which filters the workflow but whose entries " +
        "are exclusions rather than a coverage list. This guard cannot check " +
        "R1 against it — express the filter as `paths` instead.",
    };
  }

  if (value.startsWith("[") && value.endsWith("]")) {
    return { kind: "filtered", entries: flowEntries(value) };
  }

  if (value !== "") {
    return {
      kind: "unparsed",
      detail: `\`${key}\` has the inline value \`${value}\`, which this guard cannot decompose into entries.`,
    };
  }

  const entries = listEntries(blockUnder(prBlock, pathsIndex, indentOf(pathsLine)));
  if (entries.length === 0) {
    return {
      kind: "unparsed",
      detail: `\`${key}\` is declared but no entries could be read from it.`,
    };
  }

  return { kind: "filtered", entries };
};

/** Every path named inside any `filters:` block in the file. */
export const gateFilters = (source: string): FilterResult => {
  const lines = source.split("\n");
  const out: string[] = [];
  let hasInlineBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i]!.match(/^\s*filters:\s*(.*)$/);
    if (!match) continue;
    const value = match[1]!.trim();

    // Two spellings of the same thing: a block scalar (`|`, `|-`, `>`, `>-`,
    // `|+` …) or nothing at all, both introducing a filter body on the lines
    // beneath that this guard can read.
    if (value === "" || /^[|>][-+]?\d*$/.test(value)) {
      hasInlineBlock = true;
      out.push(...listEntries(blockUnder(lines, i, indentOf(lines[i]!))));
      continue;
    }

    // dorny/paths-filter also accepts a path to a filters FILE. The paths it
    // declares are then somewhere this guard is not looking.
    return {
      kind: "unparsed",
      detail:
        `\`filters: ${value}\` is not an inline block, so the paths it declares ` +
        `are not visible here and R1 cannot be checked.`,
    };
  }

  if (!hasInlineBlock) return { kind: "none" };
  return { kind: "filtered", entries: out };
};

/**
 * Job names ending in `-complete`. The job-key indent is read from the
 * `jobs:` block, not assumed to be two — hardcoding it left a four-space
 * workflow with no detectable aggregators, so R2 never fired.
 */
export const aggregatorJobs = (source: string): string[] => {
  const lines = source.split("\n");
  const jobsIndex = findKeyIndex(lines, "jobs", 0);
  if (jobsIndex === -1) return [];

  const block = blockUnder(lines, jobsIndex, 0);
  const first = block.find((l) => !isBlank(l));
  if (first === undefined) return [];
  const jobIndent = indentOf(first);

  return block
    .filter((l) => !isBlank(l) && indentOf(l) === jobIndent && /^[a-z0-9_-]+:\s*$/i.test(l.trim()))
    .map((l) => l.trim().slice(0, -1))
    .filter((name) => name.endsWith("-complete"));
};

/** Glob pattern to anchored regex: `**` spans separators, `*` does not. */
const globToRegExp = (pattern: string): RegExp => {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        // `a/**` also covers `a` itself; `**/x` also covers a bare `x`.
        if (pattern[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
        continue;
      }
      out += "[^/]*";
      continue;
    }
    if (c === "?") {
      out += "[^/]";
      continue;
    }
    out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
};

const matches = (pattern: string, target: string): boolean => {
  if (pattern === target) return true;
  // `pkg/**` covers `pkg/anything`; the trailing `/` is kept out of the
  // prefix so it can never cover `pkgother/`.
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -2);
    if (target.startsWith(prefix)) return true;
  }
  return globToRegExp(pattern).test(target);
};

/**
 * Does the `on.paths` list, as a whole, cover `target`? Order and negation
 * are real: `[pkg/**, !pkg/ssrf/**]` does NOT cover `pkg/ssrf/address.go`
 * even though the first entry matches — checking entries independently would miss R1.
 */
export const covers = (patterns: string[], target: string): boolean => {
  let covered = false;
  for (const pattern of patterns) {
    if (pattern.startsWith("!")) {
      if (matches(pattern.slice(1), target)) covered = false;
      continue;
    }
    if (matches(pattern, target)) covered = true;
  }
  return covered;
};

export const inspect = (file: string, source: string): WorkflowIssue[] => {
  const filter = pullRequestFilter(source);
  if (filter.kind === "none") return [];

  const issues: WorkflowIssue[] = [];

  // An unparsed filter is still a FILTER — `pullRequestFilter` only reaches
  // this state having found a paths-like key under the pull-request trigger.
  // R2 still applies; only R1 is impossible, since there's nothing to compare.
  // Returning here instead would let the aggregator contradiction through on
  // exactly the files the guard has already admitted it cannot fully read.
  if (filter.kind === "unparsed") {
    issues.push({ file, rule: "R3", detail: filter.detail });
  }

  for (const aggregator of aggregatorJobs(source)) {
    issues.push({
      file,
      rule: "R2",
      detail:
        `declares a pull-request path filter AND the aggregator job ` +
        `"${aggregator}". An aggregator exists so a required check always ` +
        `reports; a path filter is what stops it reporting. Drop one.`,
    });
  }

  // R1 compares the gate's paths against the trigger's. With an unparsed
  // trigger there is nothing to compare, and R3 has already said so.
  if (filter.kind !== "filtered") return issues;

  const gate = gateFilters(source);
  if (gate.kind === "unparsed") {
    issues.push({ file, rule: "R3", detail: gate.detail });
    return issues;
  }
  if (gate.kind === "none") return issues;

  for (const declared of new Set(gate.entries)) {
    if (covers(filter.entries, declared)) continue;
    issues.push({
      file,
      rule: "R1",
      detail:
        `gate filter names "${declared}", which the on.pull_request.paths list ` +
        `does not cover. A change to it would never start this workflow, so ` +
        `the job that filter guards would silently not run.`,
    });
  }

  return issues;
};

export const main = (dir = ".github/workflows"): number => {
  const issues: WorkflowIssue[] = [];
  for (const name of readdirSync(dir).toSorted()) {
    if (!name.endsWith(".yml") && !name.endsWith(".yaml")) continue;
    issues.push(...inspect(name, readFileSync(join(dir, name), "utf8")));
  }

  if (issues.length > 0) {
    console.error("Path-filter guard failed:");
    for (const issue of issues) {
      console.error(`- [${issue.rule}] ${issue.file}: ${issue.detail}`);
    }
    return 1;
  }

  console.log("path-filter guard passed");
  return 0;
};

const isEntrypoint = (): boolean =>
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntrypoint()) {
  // The workflows directory is an argument so CI can point a trusted copy of
  // this script at the pull request's checkout, the way the pull_request_target
  // guard does — a pull request must not be able to disable its own guard by
  // editing the script in the same commit.
  process.exitCode = main(process.argv[2] ?? ".github/workflows");
}
