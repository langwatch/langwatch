import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The static half of the ClickHouse tenant-scope rule. The enforcing half is the guard on the
 * wrapped vendor client, which sees the final SQL and refuses at runtime.
 */

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

/**
 * Where ClickHouse statements are written. Every one of these files reaches
 * ClickHouse through the client the process composed, which is the client the
 * guard wraps.
 */
const SCANNED_DIRECTORIES = [
  "packages/features",
  "packages/enterprise",
  "packages/eventing/src/server/adapters/clickhouse",
];

/**
 * Files that build their own driver client with `createClient(` are outside the managed
 * client entirely - the schema migration runner, the TTL reconciler and the LangWatchQL
 * executor - so the guard never sees their statements.
 */
const BUILDS_ITS_OWN_CLIENT = /\bcreateClient\s*\(/;

const TENANT_COLUMN = "(?:TenantId|tenant_id|project_id|ProjectId)";
/**
 * A predicate position on the tenant column: bound to a parameter, or opening
 * onto an interpolation whose text this scan cannot see (a placeholder list
 * built in a helper, most often).
 */
const SCOPED_PREDICATE = new RegExp(
  `(?:^|[\\s.(])${TENANT_COLUMN}\\s*(?:=|IN)\\s*\\(?\\s*(?:\\{\\s*[A-Za-z_][A-Za-z0-9_]*\\s*:|INTERPOLATION)`,
  "i",
);

function walk(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    if (entry === "node_modules" || entry === "dist" || entry === "__tests__") continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) walk(path, found);
    else if (path.endsWith(".ts") && !path.endsWith(".test.ts")) found.push(path);
  }
  return found;
}

/** Blanks comment and string bodies so neither can steer the match. */
function maskNonCode(sql: string): string {
  const out = [...sql];
  const blank = (from: number, to: number): void => {
    for (let i = from; i < to && i < out.length; i++) if (out[i] !== "\n") out[i] = " ";
  };
  let cursor = 0;
  while (cursor < sql.length) {
    const pair = sql.slice(cursor, cursor + 2);
    if (pair === "/*" || pair === "--") {
      const close = pair === "/*" ? sql.indexOf("*/", cursor + 2) : sql.indexOf("\n", cursor);
      const end = close === -1 ? sql.length : pair === "/*" ? close + 2 : close;
      blank(cursor, end);
      cursor = end;
      continue;
    }
    const quote = sql[cursor];
    if (quote === "'" || quote === '"') {
      let scan = cursor + 1;
      while (scan < sql.length && sql[scan] !== quote) scan += sql[scan] === "\\" ? 2 : 1;
      blank(cursor + 1, Math.min(scan, sql.length));
      cursor = Math.min(scan + 1, sql.length);
      continue;
    }
    cursor += 1;
  }
  return out.join("");
}

/** Reads a template literal, standing an opaque marker in for each `${}`. */
function readTemplate(source: string, start: number): { text: string; end: number } {
  let text = "";
  let cursor = start + 1;
  while (cursor < source.length) {
    const character = source[cursor];
    if (character === "\\") {
      text += "  ";
      cursor += 2;
      continue;
    }
    if (character === "`") return { text, end: cursor + 1 };
    if (character === "$" && source[cursor + 1] === "{") {
      let depth = 1;
      let scan = cursor + 2;
      while (scan < source.length && depth > 0) {
        if (source[scan] === "{") depth++;
        else if (source[scan] === "}") depth--;
        else if (source[scan] === "`") scan = readTemplate(source, scan).end - 1;
        scan++;
      }
      text += " INTERPOLATION ";
      cursor = scan;
      continue;
    }
    text += character;
    cursor++;
  }
  return { text, end: cursor };
}

/** Advances past a string, template or comment starting at `index`, else -1. */
function skipLiteral(source: string, index: number): number {
  const character = source[index];
  if (character === "`") return readTemplate(source, index).end;
  if (character === '"' || character === "'") {
    let scan = index + 1;
    while (scan < source.length && source[scan] !== character)
      scan += source[scan] === "\\" ? 2 : 1;
    return scan + 1;
  }
  if (source.startsWith("//", index)) {
    const end = source.indexOf("\n", index);
    return end === -1 ? source.length : end;
  }
  if (source.startsWith("/*", index)) {
    const end = source.indexOf("*/", index);
    return end === -1 ? source.length : end + 2;
  }
  return -1;
}

function extentFrom(source: string, start: number, terminator: "semicolon" | "brace"): number {
  let depth = 0;
  let cursor = start;
  while (cursor < source.length) {
    const skipped = skipLiteral(source, cursor);
    if (skipped !== -1) {
      cursor = skipped;
      continue;
    }
    const character = source[cursor];
    if (character === "(" || character === "[" || character === "{") depth++;
    else if (character === ")" || character === "]" || character === "}") {
      depth--;
      if (terminator === "brace" && depth === 0) return cursor + 1;
      if (depth < 0) return cursor;
    } else if (terminator === "semicolon" && character === ";" && depth === 0) return cursor;
    cursor++;
  }
  return source.length;
}

/**
 * Every SQL-bearing literal inside a range: template literals and quoted
 * strings alike, because a `WHERE` clause is as often an array of
 * `"TenantId = {tenantId:String}"` strings joined with AND as it is a template.
 */
function literalsIn(source: string, from: number, to: number): string {
  let text = "";
  let cursor = from;
  while (cursor < to) {
    const character = source[cursor];
    if (character === "`") {
      const template = readTemplate(source, cursor);
      text += `${template.text}\n`;
      cursor = template.end;
      continue;
    }
    if (character === '"' || character === "'") {
      const end = skipLiteral(source, cursor);
      text += `${source.slice(cursor + 1, Math.max(cursor + 1, end - 1))}\n`;
      cursor = end;
      continue;
    }
    const skipped = skipLiteral(source, cursor);
    cursor = skipped === -1 ? cursor + 1 : skipped;
  }
  return text;
}

/**
 * The body of the function whose signature starts at `from`.
 */
function bodyAfterSignature(source: string, from: number): string | null {
  let cursor = source.indexOf(")", from);
  for (let hop = 0; hop < 3 && cursor !== -1; hop++) {
    const open = source.indexOf("{", cursor);
    if (open === -1) return null;
    const end = extentFrom(source, open, "brace");
    const next = source.slice(end).search(/\S/);
    if (next !== -1 && source[end + next] === "{") {
      cursor = end;
      continue;
    }
    return source.slice(open, end);
  }
  return null;
}

/**
 * Every name in the file, mapped to the source of what it was declared as.
 */
function declarationsOf(source: string): Map<string, string> {
  const declarations = new Map<string, string>();
  const add = (name: string, code: string): void => {
    declarations.set(name, `${declarations.get(name) ?? ""}\n${code}`);
  };
  for (const match of source.matchAll(
    /(?:^|[\s;])(?:const|let|var)\s+[[{]([^}\]]{1,400})[\]}]\s*(?::[^=;]*)?=/g,
  )) {
    const start = (match.index ?? 0) + match[0].length;
    const code = source.slice(start, extentFrom(source, start, "semicolon"));
    for (const name of (match[1] as string).match(/[A-Za-z_$][\w$]*/g) ?? []) add(name, code);
  }
  for (const match of source.matchAll(
    /(?:^|[\s;])(?:const|let|var|readonly)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]*)?=/g,
  )) {
    const start = (match.index ?? 0) + match[0].length;
    add(match[1] as string, source.slice(start, extentFrom(source, start, "semicolon")));
  }
  for (const match of source.matchAll(
    /(?:^|[\s;])(?:export\s+)?(?:async\s+)?(?:function\s+|static\s+|private\s+|public\s+|protected\s+)*([A-Za-z_$][\w$]*)\s*\(/g,
  )) {
    const body = bodyAfterSignature(source, match.index ?? 0);
    if (body === null) continue;
    add(match[1] as string, body);
  }
  return declarations;
}

/** The SQL reachable from one expression, following names up to `depth` hops. */
function sqlReachableFrom({
  code,
  declarations,
  depth,
  seen = new Set<string>(),
}: {
  code: string;
  declarations: Map<string, string>;
  depth: number;
  seen?: Set<string>;
}): string {
  let text = literalsIn(code, 0, code.length);
  if (depth === 0) return text;
  for (const name of code.match(/[A-Za-z_$][\w$]*/g) ?? []) {
    if (seen.has(name)) continue;
    seen.add(name);
    const declaration = declarations.get(name);
    if (declaration === undefined) continue;
    text += `\n${sqlReachableFrom({ code: declaration, declarations, depth: depth - 1, seen })}`;
  }
  return text;
}

interface CallSite {
  file: string;
  line: number;
  verdict: "scoped" | "declared-unscoped" | "unresolvable" | "unscoped";
}

function callSitesIn(file: string, source: string): CallSite[] {
  const declarations = declarationsOf(source);
  const sites: CallSite[] = [];
  const calls = /\.query\s*(?:<[^;{}()]*?>)?\s*\(/g;
  let call: RegExpExecArray | null;
  while ((call = calls.exec(source)) !== null) {
    let cursor = calls.lastIndex;
    let depth = 1;
    while (cursor < source.length && depth > 0) {
      const skipped = skipLiteral(source, cursor);
      if (skipped !== -1) {
        cursor = skipped;
        continue;
      }
      if (source[cursor] === "(") depth++;
      else if (source[cursor] === ")") depth--;
      cursor++;
    }
    const argumentsStart = calls.lastIndex;
    const argumentsText = source.slice(argumentsStart, cursor - 1);
    const property = /(?:^|[\s,{])query\s*:\s*/.exec(argumentsText);
    if (property === null) continue;
    const line = source.slice(0, call.index).split("\n").length;
    if (/(?:^|[\s,{])unscoped\s*:/.test(argumentsText)) {
      sites.push({ file, line, verdict: "declared-unscoped" });
      continue;
    }
    let valueAt = argumentsStart + property.index + property[0].length;
    while (/\s/.test(source[valueAt] ?? "")) valueAt++;
    const quote = source[valueAt];
    const expression =
      quote === "`"
        ? source.slice(valueAt, readTemplate(source, valueAt).end)
        : quote === '"' || quote === "'"
          ? source.slice(valueAt, source.indexOf(quote, valueAt + 1) + 1)
          : (/^[^,\n]*/.exec(source.slice(valueAt))?.[0]?.trim() ?? "");
    const statement = sqlReachableFrom({ code: expression, declarations, depth: 3 });
    if (SCOPED_PREDICATE.test(maskNonCode(statement))) {
      sites.push({ file, line, verdict: "scoped" });
    } else {
      // Only a statement this scan could read end to end is called unscoped.
      // One still holding an interpolation whose text lives in another module
      // is reported as unreadable rather than failed on a guess - the runtime
      // guard sees that one with the real SQL in hand.
      const readable =
        (quote === "`" || quote === '"' || quote === "'") && !statement.includes("INTERPOLATION");
      sites.push({ file, line, verdict: readable ? "unscoped" : "unresolvable" });
    }
  }
  return sites;
}

function scan(): CallSite[] {
  const sites: CallSite[] = [];
  for (const directory of SCANNED_DIRECTORIES) {
    for (const file of walk(join(ROOT, directory))) {
      const source = readFileSync(file, "utf8");
      if (!/clickhouse/i.test(source) && !/clickhouse/i.test(file)) continue;
      if (BUILDS_ITS_OWN_CLIENT.test(source)) continue;
      sites.push(...callSitesIn(relative(ROOT, file), source));
    }
  }
  return sites;
}

describe("ClickHouse repositories", () => {
  const sites = scan();

  describe("when a repository issues a statement whose SQL this scan can read", () => {
    /** @scenario "a new bypass cannot be introduced unnoticed" */
    it("scopes it to a tenant, or declares in writing why it does not", () => {
      const offenders = sites
        .filter((site) => site.verdict === "unscoped")
        .map(
          (site) =>
            `${site.file}:${site.line} — no tenant predicate and no \`unscoped: { reason }\``,
        );

      expect(offenders).toEqual([]);
    });
  });

  it("finds the statements it is meant to be reading", () => {
    expect(sites.length).toBeGreaterThan(150);
    expect(sites.filter((site) => site.verdict === "scoped").length).toBeGreaterThan(100);
    expect(sites.filter((site) => site.verdict === "declared-unscoped").length).toBeGreaterThan(9);
  });

  describe("when the rule itself is exercised", () => {
    const classify = (source: string): CallSite["verdict"] =>
      (callSitesIn("fixture.ts", source)[0] as CallSite).verdict;

    it("fails a literal statement with no tenant predicate", () => {
      expect(classify('await client.query({ query: "SELECT 1 FROM trace_summaries" });')).toBe(
        "unscoped",
      );
    });

    it("passes the same statement once it declares why it spans tenants", () => {
      expect(
        classify(
          'await client.query({ query: "SELECT 1 FROM trace_summaries", unscoped: { reason: "why" } });',
        ),
      ).toBe("declared-unscoped");
    });

    it("passes a statement whose predicate is built in a helper it can follow", () => {
      expect(
        classify(
          [
            "function whereFor() {",
            '  return ["TenantId = {tenantId:String}"].join(" AND ");',
            "}",
            "const clause = whereFor();",
            "await client.query({ query: `SELECT 1 FROM t WHERE ${clause}` });",
          ].join("\n"),
        ),
      ).toBe("scoped");
    });

    it("declines to judge a statement built in another module", () => {
      expect(classify("await client.query({ query: `SELECT 1 FROM t ${elsewhere}` });")).toBe(
        "unresolvable",
      );
    });
  });
});
