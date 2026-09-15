#!/usr/bin/env node
/**
 * The mechanical half of the Date-to-Temporal migration.
 *
 * The rewrite rules beside this file carry the `fix:` templates; this driver
 * decides WHERE each one may fire. ast-grep is syntactic, so a bare
 * `ast-grep scan -U` would rewrite the Dates that a boundary still owns —
 * Prisma arguments, Intl formatting, calendar stepping. The driver reads the
 * file-local evidence instead: a moment is only rewritten when the same file
 * proves what it is, and every other site is reported as residue for hands.
 *
 *   node apply-temporal-codemod.mjs --dry-run <paths...>
 *   node apply-temporal-codemod.mjs --apply   <paths...>
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../../..");

const RULE_FILES = {
  compare: "temporal-instant-compare.yml",
  epochMillisecondsFromIso: "temporal-epoch-milliseconds-from-iso.yml",
  epochMilliseconds: "temporal-instant-epoch-milliseconds.yml",
  fromIso: "temporal-instant-from-iso.yml",
  isoString: "temporal-instant-iso-string.yml",
  nowEpochMilliseconds: "temporal-now-epoch-milliseconds.yml",
  nowInstant: "temporal-now-instant.yml",
  nowIsoString: "temporal-now-iso-string.yml",
  since: "temporal-instant-since.yml",
};

// The one-clock rule's own scope, restated so the codemod never proposes an
// edit the linter would not have asked for.
const GOVERNED =
  /^(?:apps\/[^/]+\/src\/|packages\/[^/]+\/|sdks\/typescript\/src\/|mcp\/typescript\/src\/)/;
const TIME_PACKAGE = /^packages\/time\//;
const PRISMA_SEAM = /(?:^|\/)(?:repositories\/prisma\/|adapters\/postgres\.)/;
const DECLARATION = /\.d\.[cm]?ts$/;
const TEST_FILE = /\.(?:test|spec|unit|integration|e2e)\.[cm]?[jt]sx?$/;
const TEST_DIRECTORY = /(?:^|\/)(?:__tests__|__mocks__|tests)(?:\/|$)/;
const SOURCE_FILE = /\.[cm]?tsx?$/;
const GENERATED = /(?:^|\/)generated(?:\/|\.)|\.generated\./;

/** Every file the codemod may touch: what the rule governs, minus the seams. */
export function isCodemodTarget(workspacePath) {
  if (!SOURCE_FILE.test(workspacePath)) return false;
  if (!GOVERNED.test(workspacePath)) return false;
  if (TIME_PACKAGE.test(workspacePath)) return false;
  if (PRISMA_SEAM.test(workspacePath)) return false;
  if (DECLARATION.test(workspacePath)) return false;
  if (GENERATED.test(workspacePath)) return false;
  if (TEST_FILE.test(workspacePath) || TEST_DIRECTORY.test(workspacePath)) return false;

  return true;
}

function ruleText(name, language) {
  const text = readFileSync(join(HERE, RULE_FILES[name]), "utf8");

  return text.replaceAll("language: TypeScript", `language: ${language}`);
}

function normalize(matches) {
  return matches.map((match) => ({
    end: match.range.byteOffset.end,
    replacement: match.replacement,
    ruleId: match.ruleId,
    start: match.range.byteOffset.start,
    text: match.text,
    vars: Object.fromEntries(
      Object.entries(match.metaVariables?.single ?? {}).map(([key, value]) => [
        key,
        { end: value.range.byteOffset.end, start: value.range.byteOffset.start, text: value.text },
      ]),
    ),
  }));
}

/** ast-grep matches for one rule over one file, with metavariables. */
function scanOne(name, file, source) {
  const language = file.endsWith("x") ? "Tsx" : "TypeScript";
  const out = execFileSync(
    "ast-grep",
    ["scan", "--inline-rules", ruleText(name, language), "--json=compact", "--stdin"],
    { encoding: "utf8", input: source, maxBuffer: 256 * 1024 * 1024 },
  );

  return normalize(JSON.parse(out || "[]"));
}

/**
 * Every rule's matches for a whole batch of files at once. One ast-grep process
 * per rule and language beats one per file by two orders of magnitude, and the
 * per-file decisions afterwards are unchanged.
 *
 * @returns {Map<string, Map<string, object[]>>} rule name -> file -> matches
 */
export function collectMatches(files, { cwd = ROOT } = {}) {
  const index = new Map();
  const byLanguage = {
    Tsx: files.filter((file) => file.endsWith("x")),
    TypeScript: files.filter((file) => !file.endsWith("x")),
  };
  for (const name of Object.keys(RULE_FILES)) {
    const perFile = new Map();
    for (const file of files) perFile.set(file, []);
    for (const [language, paths] of Object.entries(byLanguage)) {
      if (paths.length === 0) continue;
      for (let at = 0; at < paths.length; at += 400) {
        const batch = paths.slice(at, at + 400);
        const out = execFileSync(
          "ast-grep",
          ["scan", "--inline-rules", ruleText(name, language), "--json=compact", ...batch],
          { cwd, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 },
        );
        for (const match of JSON.parse(out || "[]")) {
          perFile.get(match.file)?.push(...normalize([match]));
        }
      }
    }
    index.set(name, perFile);
  }

  return index;
}

/**
 * ast-grep reports byte offsets; JavaScript slices in UTF-16 code units. One
 * non-ASCII character anywhere above a match makes the two disagree, and the
 * edit lands in the middle of the next statement, so every offset is converted
 * before anything reasons about it.
 */
function byteToCharOffset(source) {
  if (Buffer.byteLength(source, "utf8") === source.length) return (offset) => offset;
  const map = new Map();
  let byte = 0;
  let char = 0;
  for (const codePoint of source) {
    map.set(byte, char);
    byte += Buffer.byteLength(codePoint, "utf8");
    char += codePoint.length;
  }
  map.set(byte, char);

  return (offset) => map.get(offset) ?? offset;
}

const converters = new Map();
function converterFor(file, source) {
  const cached = converters.get(file);
  if (cached && cached.source === source) return cached.convert;
  const convert = byteToCharOffset(source);
  converters.set(file, { convert, source });

  return convert;
}

function scanWith(index, name, file, source) {
  const matches = index ? (index.get(name)?.get(file) ?? []) : scanOne(name, file, source);
  const convert = converterFor(file, source);

  return matches.map((match) => ({
    ...match,
    end: convert(match.end),
    start: convert(match.start),
    vars: Object.fromEntries(
      Object.entries(match.vars).map(([key, value]) => [
        key,
        { ...value, end: convert(value.end), start: convert(value.start) },
      ]),
    ),
  }));
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const STRING_LITERAL = /^(?:"[^"]*"|'[^']*'|`[^`$]*`)$/;

/** True when the file annotates `name` a string, so `new Date(name)` parses one. */
function isDeclaredString(source, name) {
  if (!IDENTIFIER.test(name)) return false;
  const annotated = new RegExp(`\\b${name}\\s*:\\s*string\\b`);
  const assigned = new RegExp(`\\b${name}\\s*=\\s*(?:"|'|\`)`);

  return annotated.test(source) || assigned.test(source);
}

/** True when `new Date(x)` is provably parsing a string. */
function isStringMoment(source, argument) {
  if (STRING_LITERAL.test(argument)) return true;

  return isDeclaredString(source, argument);
}

/**
 * True when the string is written out here, so `Temporal.Instant.from` can be
 * checked by eye. A runtime string keeps its `Date` parse: the two disagree on
 * a date-only value and on anything unparseable.
 */
function isLiteralMoment(argument) {
  return STRING_LITERAL.test(argument);
}

/** Every occurrence of `name` used as a value, by byte offset. */
function valueOccurrences(source, name) {
  const pattern = new RegExp(`(?<![A-Za-z0-9_$.])${name}(?![A-Za-z0-9_$])`, "g");
  const offsets = [];
  for (const match of source.matchAll(pattern)) {
    const after = source.slice(match.index + name.length, match.index + name.length + 2);
    // `{ name: value }` and `name:` in a type position are not reads of it.
    if (/^\s*:/.test(after)) continue;
    offsets.push(match.index);
  }

  return offsets;
}

/**
 * The moments this file proves. A `const` bound to `new Date()` or to
 * `new Date(<string>)` is an instant only when EVERY later read of the name is
 * one the rewrite keeps working: `getTime`, `valueOf`, `toISOString`, or an
 * operand of a comparison or subtraction whose other side is also proven. One
 * unaccounted read and the binding is left alone, because that read is where a
 * Date is still expected.
 */
function proveInstants({ file, index, source }) {
  const declarations = new Map();
  for (const match of scanWith(index, "nowInstant", file, source)) {
    const declared = declaredBy(source, match);
    if (declared) declarations.set(declared.name, { ...declared, kind: "now", match });
  }
  for (const match of scanWith(index, "fromIso", file, source)) {
    const argument = match.vars.ISO?.text ?? "";
    if (!isLiteralMoment(argument)) continue;
    const declared = declaredBy(source, match);
    if (declared) declarations.set(declared.name, { ...declared, kind: "iso", match });
  }

  const safeReads = new Map();
  const record = (name, offset) => {
    if (!safeReads.has(name)) safeReads.set(name, new Set());
    safeReads.get(name).add(offset);
  };
  const memberMatches = [
    ...scanWith(index, "epochMilliseconds", file, source),
    ...scanWith(index, "isoString", file, source),
  ];
  for (const match of memberMatches) {
    const receiver = match.vars.RECEIVER;
    if (receiver && IDENTIFIER.test(receiver.text)) record(receiver.text, receiver.start);
  }

  const pairMatches = [...scanWith(index, "compare", file, source), ...scanWith(index, "since", file, source)];
  const proven = new Set(declarations.keys());
  for (;;) {
    const pairReads = new Map();
    for (const match of pairMatches) {
      const left = match.vars.LEFT ?? match.vars.LATER;
      const right = match.vars.RIGHT ?? match.vars.EARLIER;
      if (!left || !right) continue;
      if (!proven.has(left.text) || !proven.has(right.text)) continue;
      pairReads.set(left.start, left.text);
      pairReads.set(right.start, right.text);
    }

    const rejected = [];
    for (const name of proven) {
      const declaration = declarations.get(name);
      const accounted = new Set([
        declaration.nameOffset,
        ...(safeReads.get(name) ?? []),
        ...[...pairReads].filter(([, text]) => text === name).map(([offset]) => offset),
      ]);
      const unaccounted = valueOccurrences(source, name).filter((offset) => !accounted.has(offset));
      if (unaccounted.length > 0) rejected.push(name);
    }
    if (rejected.length === 0) break;
    for (const name of rejected) proven.delete(name);
  }

  return { declarations, proven };
}

/**
 * The `const NAME = <match>` this match initializes, when it is exactly that.
 * A `let`, a reassignment or a second declaration of the same name disqualifies
 * it: the codemod only reasons about a name bound once.
 */
function declaredBy(source, match) {
  const before = source.slice(0, match.start);
  const declaration = /(?:^|[\s;{}(])(const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::[^=]*)?=\s*$/
    .exec(before);
  if (!declaration) return undefined;
  const [, keyword, name] = declaration;
  if (keyword !== "const") return undefined;
  const bindings = source.match(new RegExp(`\\b(?:const|let|var|function)\\s+${name}\\b`, "g"));
  if ((bindings?.length ?? 0) !== 1) return undefined;
  const reassigned = new RegExp(`(?<![A-Za-z0-9_$.])${name}\\s*(?:\\+|-|\\*|\\/)?=(?!=|>)`, "g");
  const writes = source.match(reassigned) ?? [];
  if (writes.length !== 1) return undefined;

  return { name, nameOffset: before.length - declaration[0].length + declaration[0].indexOf(name) };
}

const SAFE_RECEIVER_RULES = new Set([
  "temporal-instant-epoch-milliseconds",
  "temporal-instant-iso-string",
]);

/** Every edit the codemod will make to one file, plus what it declined. */
export function planFile({ file, index, source }) {
  const { declarations, proven } = proveInstants({ file, index, source });
  const edits = [];
  const declined = [];

  for (const match of scanWith(index, "nowEpochMilliseconds", file, source)) edits.push(match);
  for (const match of scanWith(index, "nowIsoString", file, source)) edits.push(match);

  for (const name of proven) edits.push(declarations.get(name).match);

  for (const match of [...scanWith(index, "epochMilliseconds", file, source), ...scanWith(index, "isoString", file, source)]) {
    if (!SAFE_RECEIVER_RULES.has(match.ruleId)) continue;
    const receiver = match.vars.RECEIVER;
    if (!receiver) continue;
    // `new Date().getTime()` and friends are the now-rules' own matches, and
    // the outermost-wins dedupe keeps theirs; they are not residue.
    if (receiver.text === "new Date()") continue;
    if (IDENTIFIER.test(receiver.text)) {
      if (proven.has(receiver.text)) edits.push(match);
      else declined.push({ reason: "receiver is not a proven instant", ...match });
      continue;
    }
    declined.push({ reason: "receiver is not a proven instant", ...match });
  }

  for (const match of [...scanWith(index, "compare", file, source), ...scanWith(index, "since", file, source)]) {
    const left = match.vars.LEFT ?? match.vars.LATER;
    const right = match.vars.RIGHT ?? match.vars.EARLIER;
    if (!left || !right) continue;
    if (proven.has(left.text) && proven.has(right.text)) edits.push(match);
  }

  // `new Date(iso).getTime()` with no binding in between. `toEpochMs` is the
  // seam that keeps the `Date` parse, so this is safe where narrowing to
  // `Temporal.Instant.from` would not be.
  for (const match of scanWith(index, "epochMillisecondsFromIso", file, source)) {
    const argument = match.vars.ISO?.text ?? "";
    if (isStringMoment(source, argument)) edits.push(match);
    else declined.push({ reason: "argument is not provably a string", ...match });
  }

  for (const match of scanWith(index, "fromIso", file, source)) {
    const argument = match.vars.ISO?.text ?? "";
    const declared = declaredBy(source, match);
    if (declared && proven.has(declared.name)) continue;
    // Already inside a `toEpochMs(...)` rewrite of the whole chained call.
    if (edits.some((edit) => edit.start <= match.start && match.end <= edit.end)) continue;
    if (!isStringMoment(source, argument)) {
      declined.push({ reason: "argument is not provably a string", ...match });
      continue;
    }
    if (!isLiteralMoment(argument)) {
      declined.push({ reason: "a runtime string keeps its Date parse", ...match });
      continue;
    }
    declined.push({ reason: "result is not provably used as an instant", ...match });
  }

  for (const match of scanWith(index, "nowInstant", file, source)) {
    const declared = declaredBy(source, match);
    if (declared && proven.has(declared.name)) continue;
    const chained = /^\s*\.(getTime|valueOf|toISOString)\s*\(\s*\)/.test(source.slice(match.end));
    if (chained) continue;
    declined.push({ reason: "result is not provably used as an instant", ...match });
  }

  return { declined, edits: dedupe(edits) };
}

/** Outermost-wins, so a chained rewrite never has an inner edit applied twice. */
function dedupe(edits) {
  const sorted = [...edits].sort((a, b) => a.start - b.start || b.end - a.end);
  const kept = [];
  let boundary = -1;
  for (const edit of sorted) {
    if (edit.start < boundary) continue;
    kept.push(edit);
    boundary = edit.end;
  }

  return kept;
}

const TIME_IMPORT = /import\s*\{([^}]*)\}\s*from\s*["']@langwatch\/time["']\s*;?/;

/** The `@langwatch/time` import the rewritten file now needs. */
function withImport(source, edits) {
  const emitted = edits.map((edit) => edit.replacement).join("\n");
  const needed = new Set();
  if (/\bnowInstant\(/.test(emitted)) needed.add("nowInstant");
  if (/\bTemporal\./.test(emitted)) needed.add("Temporal");
  if (/\btoEpochMs\(/.test(emitted)) needed.add("toEpochMs");
  if (needed.size === 0) return source;

  // A file that already binds `Temporal` or `nowInstant` from somewhere else
  // is left alone rather than given a second, colliding declaration.
  const foreign = [...source.matchAll(/^import\s[^\n]*?;$/gm)]
    .filter((line) => !line[0].includes("@langwatch/time"))
    .some((line) => [...needed].some((name) => new RegExp(`\\b${name}\\b`).test(line[0])));
  if (foreign) return undefined;

  const existing = TIME_IMPORT.exec(source);
  if (existing) {
    const names = new Set(
      existing[1]
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean),
    );
    for (const name of needed) if (!hasBinding(names, name)) names.add(name);
    const rendered = `import { ${[...names].sort(compareBindings).join(", ")} } from "@langwatch/time";`;

    return source.replace(existing[0], rendered);
  }

  const statement = `import { ${[...needed].sort(compareBindings).join(", ")} } from "@langwatch/time";\n`;
  const imports = [...source.matchAll(/^import\s[^\n]*?;$/gm)];
  if (imports.length > 0) {
    const last = imports.at(-1);
    const at = last.index + last[0].length;

    return `${source.slice(0, at)}\n${statement.trimEnd()}${source.slice(at)}`;
  }
  const directive = /^(?:"use [a-z]+";|'use [a-z]+';)\n/.exec(source);
  const at = directive ? directive[0].length : 0;

  return `${source.slice(0, at)}${statement}${source.slice(at)}`;
}

function hasBinding(names, name) {
  for (const entry of names) if (entry === name || entry.startsWith(`${name} as `)) return true;

  return false;
}

function compareBindings(a, b) {
  const bare = (name) => name.replace(/^type\s+/, "").toLowerCase();

  return bare(a).localeCompare(bare(b));
}

/** The rewritten source for one file, or undefined when nothing fires. */
export function rewriteFile({ file, index, source }) {
  const { declined, edits } = planFile({ file, index, source });
  if (edits.length === 0) return { declined, edits, output: undefined };

  let output = source;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    output = output.slice(0, edit.start) + edit.replacement + output.slice(edit.end);
  }

  const imported = withImport(output, edits);
  if (imported === undefined) {
    return { declined: [...declined, ...edits.map((edit) => ({ reason: "the file already binds Temporal or nowInstant elsewhere", ...edit }))], edits: [], output: undefined };
  }

  return { declined, edits, output: imported };
}

function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const rootFlag = args.find((argument) => argument.startsWith("--root="));
  const root = rootFlag ? resolve(rootFlag.slice("--root=".length)) : ROOT;
  const listFlag = args.find((argument) => argument.startsWith("--files="));
  const listed = listFlag
    ? readFileSync(listFlag.slice("--files=".length), "utf8").split("\n").filter(Boolean)
    : args.filter((argument) => !argument.startsWith("--"));

  const targets = listed
    .map((path) => relative(root, resolve(root, path)).split("\\").join("/"))
    .filter(isCodemodTarget)
    .filter((file) => /\bDate\b/.test(readFileSync(join(root, file), "utf8")));

  const index = collectMatches(targets, { cwd: root });
  const report = [];
  for (const file of targets) {
    const source = readFileSync(join(root, file), "utf8");
    const { declined, edits, output } = rewriteFile({ file, index, source });
    if (edits.length === 0 && declined.length === 0) continue;
    report.push({
      declined: declined.map((entry) => ({ reason: entry.reason, text: entry.text })),
      edits: edits.map((entry) => ({ ruleId: entry.ruleId, text: entry.text })),
      file,
    });
    if (apply && output !== undefined) writeFileSync(join(root, file), output);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
