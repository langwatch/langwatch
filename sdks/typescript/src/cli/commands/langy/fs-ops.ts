/**
 * The file tools, in Node, so the shared folder needs no host tool at all.
 *
 * Every path goes through the folder boundary here as well as in `policy.ts`.
 * The second check is not a repeat: a write resolves the real path again right
 * before it opens the file, which is what closes the window between the
 * decision and the write where a symlink can be swapped.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type {
  LocalEditParams,
  LocalFindParams,
  LocalGrepParams,
  LocalLsParams,
  LocalReadParams,
  LocalWriteParams,
} from "../../../agent/local-control-protocol";
import { LocalCallFailure } from "./errors";
import { resolvePathInsideRoot } from "./policy";

/** Directories skipped when the folder has no `.gitignore` to read. */
const ALWAYS_SKIPPED = new Set([".git", "node_modules"]);

/** How many bytes of one file the search reads before it gives up on it. */
const MAX_SEARCHED_FILE_BYTES = 2 * 1024 * 1024;

const DEFAULT_GREP_LIMIT = 200;
const DEFAULT_FIND_LIMIT = 500;
const DEFAULT_LS_LIMIT = 500;
const DEFAULT_READ_LINES = 2_000;

/**
 * The absolute path of a target inside the folder. Refuses anything that
 * resolves outside, naming the folder that is allowed.
 */
export function insideRoot({
  target,
  root,
}: {
  target: string;
  root: string;
}): string {
  const check = resolvePathInsideRoot({ target, root });
  if (!check.inside) {
    throw new LocalCallFailure({
      code: "path_refused",
      message: `Only paths inside ${root} are allowed. "${target}" resolves to ${check.resolved}, which is outside it.`,
    });
  }
  return check.resolved;
}

const notFound = ({ target }: { target: string }): LocalCallFailure =>
  new LocalCallFailure({
    code: "not_found",
    message: `There is no ${target} in the shared folder.`,
  });

/** The file as numbered lines, the way the model reads a file everywhere else. */
export function readFile({
  params,
  root,
}: {
  params: LocalReadParams;
  root: string;
}): string {
  const target = insideRoot({ target: params.path, root });
  let content: string;
  try {
    content = fs.readFileSync(target, "utf8");
  } catch {
    throw notFound({ target: params.path });
  }
  const lines = content.split("\n");
  const from = Math.max(1, params.offset ?? 1);
  const count = params.limit ?? DEFAULT_READ_LINES;
  const slice = lines.slice(from - 1, from - 1 + count);
  const numbered = slice
    .map((line, index) => `${from + index}\t${line}`)
    .join("\n");
  const rest = lines.length - (from - 1 + slice.length);
  return rest > 0
    ? `${numbered}\n[${rest} more line${rest === 1 ? "" : "s"}. Read again with offset ${from + slice.length}.]`
    : numbered;
}

/**
 * Writes the file, creating the directories it needs. The boundary is checked
 * again on the resolved path right before the write.
 */
export function writeFile({
  params,
  root,
}: {
  params: LocalWriteParams;
  root: string;
}): string {
  const target = insideRoot({ target: params.path, root });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  insideRoot({ target, root });
  fs.writeFileSync(target, params.content, "utf8");
  const lines = params.content === "" ? 0 : params.content.split("\n").length;
  return `Wrote ${path.relative(root, target)} (${lines} line${lines === 1 ? "" : "s"}).`;
}

/**
 * Applies the replacements in order. Each `oldText` must appear exactly once,
 * so an edit is never applied to the wrong place; anything else is an error
 * the model can act on.
 */
export function editFile({
  params,
  root,
}: {
  params: LocalEditParams;
  root: string;
}): string {
  const target = insideRoot({ target: params.path, root });
  let content: string;
  try {
    content = fs.readFileSync(target, "utf8");
  } catch {
    throw notFound({ target: params.path });
  }
  for (const [index, edit] of params.edits.entries()) {
    const occurrences = content.split(edit.oldText).length - 1;
    if (occurrences === 0) {
      throw new LocalCallFailure({
        code: "not_found",
        message: `Edit ${index + 1} of ${params.edits.length} did not apply: its old text is not in ${params.path}. Read the file again and repeat the text exactly, whitespace included.`,
      });
    }
    if (occurrences > 1) {
      throw new LocalCallFailure({
        code: "not_found",
        message: `Edit ${index + 1} of ${params.edits.length} did not apply: its old text is in ${params.path} ${occurrences} times. Give more of the surrounding lines so the text appears once.`,
      });
    }
    content = content.replace(edit.oldText, edit.newText);
  }
  insideRoot({ target, root });
  fs.writeFileSync(target, content, "utf8");
  return `Applied ${params.edits.length} edit${params.edits.length === 1 ? "" : "s"} to ${path.relative(root, target)}.`;
}

/** The names in one directory, directories first, marked with a trailing slash. */
export function listDirectory({
  params,
  root,
}: {
  params: LocalLsParams;
  root: string;
}): string {
  const target = insideRoot({ target: params.path ?? ".", root });
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(target, { withFileTypes: true });
  } catch {
    throw notFound({ target: params.path ?? "." });
  }
  const limit = params.limit ?? DEFAULT_LS_LIMIT;
  const named = entries
    .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
    .sort((left, right) => {
      const byKind = Number(right.endsWith("/")) - Number(left.endsWith("/"));
      return byKind === 0 ? left.localeCompare(right) : byKind;
    });
  const shown = named.slice(0, limit);
  const rest = named.length - shown.length;
  const header = path.relative(root, target) || ".";
  return [
    `${header}:`,
    ...shown,
    ...(rest > 0 ? [`[${rest} more entries]`] : []),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Walking the folder
// ---------------------------------------------------------------------------

/** One `.gitignore` rule, as a matcher over a path relative to the folder. */
interface IgnoreRule {
  test: RegExp;
  negated: boolean;
  directoryOnly: boolean;
}

/** A glob as a regular expression: `*`, `**` and `?` and nothing else. */
export function globToRegExp(pattern: string): RegExp {
  let source = "";
  let index = 0;
  while (index < pattern.length) {
    const char = pattern[index]!;
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        // `**/` crosses directories and also matches nothing at all.
        source += pattern[index + 2] === "/" ? "(?:.*/)?" : ".*";
        index += pattern[index + 2] === "/" ? 3 : 2;
        continue;
      }
      source += "[^/]*";
      index += 1;
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      index += 1;
      continue;
    }
    source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    index += 1;
  }
  return new RegExp(`^${source}$`);
}

const ruleFrom = (line: string): IgnoreRule | null => {
  let pattern = line.trim();
  if (pattern === "" || pattern.startsWith("#")) return null;
  const negated = pattern.startsWith("!");
  if (negated) pattern = pattern.slice(1);
  const directoryOnly = pattern.endsWith("/");
  if (directoryOnly) pattern = pattern.slice(0, -1);
  const anchored = pattern.startsWith("/");
  if (anchored) pattern = pattern.slice(1);
  const body = globToRegExp(pattern).source.replace(/^\^|\$$/g, "");
  const test = anchored
    ? new RegExp(`^${body}(?:/|$)`)
    : new RegExp(`(?:^|/)${body}(?:/|$)`);
  return { test, negated, directoryOnly };
};

/** The folder's own ignore rules, or the two defaults when it has none. */
export function loadIgnoreRules(root: string): IgnoreRule[] {
  const file = path.join(root, ".gitignore");
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .map(ruleFrom)
    .filter((rule): rule is IgnoreRule => rule !== null);
}

const isIgnored = ({
  relative,
  isDirectory,
  rules,
}: {
  relative: string;
  isDirectory: boolean;
  rules: IgnoreRule[];
}): boolean => {
  const candidate = isDirectory ? `${relative}/` : relative;
  let ignored = false;
  for (const rule of rules) {
    if (rule.directoryOnly && !isDirectory) continue;
    if (!rule.test.test(candidate)) continue;
    ignored = !rule.negated;
  }
  return ignored;
};

/**
 * Every file under `from`, relative to the folder. `.git` and `node_modules`
 * are always skipped; the folder's `.gitignore` is honored on top of that.
 */
export function* walkFiles({
  from,
  root,
  rules,
}: {
  from: string;
  root: string;
  rules: IgnoreRule[];
}): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(from, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (ALWAYS_SKIPPED.has(entry.name)) continue;
    const absolute = path.join(from, entry.name);
    const relative = path.relative(root, absolute);
    const isDirectory = entry.isDirectory();
    if (isIgnored({ relative, isDirectory, rules })) continue;
    if (entry.isSymbolicLink()) {
      // A link is followed only when it stays inside the folder.
      const check = resolvePathInsideRoot({ target: absolute, root });
      if (!check.inside) continue;
    }
    if (isDirectory) {
      yield* walkFiles({ from: absolute, root, rules });
      continue;
    }
    if (entry.isFile()) yield relative;
  }
}

const escapeLiteral = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Text search over the folder, with the matching lines and their numbers. */
export function grep({
  params,
  root,
}: {
  params: LocalGrepParams;
  root: string;
}): string {
  const from = insideRoot({ target: params.path ?? ".", root });
  const source = params.literal ? escapeLiteral(params.pattern) : params.pattern;
  let matcher: RegExp;
  try {
    matcher = new RegExp(source, params.ignoreCase ? "i" : "");
  } catch (error) {
    throw new LocalCallFailure({
      code: "exec_failed",
      message: `The search pattern is not a valid regular expression: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
  }
  const glob = params.glob === undefined ? null : globToRegExp(params.glob);
  const limit = params.limit ?? DEFAULT_GREP_LIMIT;
  const context = params.context ?? 0;
  const rules = loadIgnoreRules(root);
  const found: string[] = [];

  for (const relative of walkFiles({ from, root, rules })) {
    if (found.length >= limit) break;
    if (glob && !glob.test(relative)) continue;
    const absolute = path.join(root, relative);
    let content: string;
    try {
      if (fs.statSync(absolute).size > MAX_SEARCHED_FILE_BYTES) continue;
      content = fs.readFileSync(absolute, "utf8");
    } catch {
      continue;
    }
    // A null byte means a binary file: searching it produces noise.
    if (content.includes("\u0000")) continue;
    const lines = content.split("\n");
    for (const [index, line] of lines.entries()) {
      if (found.length >= limit) break;
      if (!matcher.test(line)) continue;
      const first = Math.max(0, index - context);
      const last = Math.min(lines.length - 1, index + context);
      for (let cursor = first; cursor <= last; cursor += 1) {
        const marker = cursor === index ? ":" : "-";
        found.push(`${relative}${marker}${cursor + 1}${marker}${lines[cursor]}`);
      }
    }
  }
  if (found.length === 0) return `No line matches ${params.pattern}.`;
  return found.length >= limit
    ? `${found.join("\n")}\n[stopped at ${limit} matches]`
    : found.join("\n");
}

/** File names under the folder that match a glob. */
export function findFiles({
  params,
  root,
}: {
  params: LocalFindParams;
  root: string;
}): string {
  const from = insideRoot({ target: params.path ?? ".", root });
  const matcher = globToRegExp(params.pattern);
  const limit = params.limit ?? DEFAULT_FIND_LIMIT;
  const rules = loadIgnoreRules(root);
  const found: string[] = [];
  for (const relative of walkFiles({ from, root, rules })) {
    if (found.length >= limit) break;
    if (matcher.test(relative) || matcher.test(path.basename(relative))) {
      found.push(relative);
    }
  }
  if (found.length === 0) return `No file matches ${params.pattern}.`;
  return found.length >= limit
    ? `${found.join("\n")}\n[stopped at ${limit} files]`
    : found.join("\n");
}
