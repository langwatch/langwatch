/**
 * Reading shape out of the vendor's untyped statement values, so
 * ./vendorClient.ts never imports `@clickhouse/client`. These total,
 * defensive readers answer for a wrong-shaped value rather than throwing.
 */

import { createHash } from "node:crypto";

/** The statement categories the outcome metric is labelled by. */
export type VendorQueryType = "SELECT" | "INSERT" | "OTHER";

/** The fields of a params object that are safe to put in a log line. */
export interface VendorQueryMeta {
  queryId?: string;
  format?: string;
  paramKeys?: string[];
  table?: string;
}

export function safeQueryMeta(params: unknown): VendorQueryMeta {
  if (!params || typeof params !== "object") return {};
  const p = params as Record<string, unknown>;
  const meta: VendorQueryMeta = {};

  if (typeof p.query_id === "string") meta.queryId = p.query_id;
  if (typeof p.format === "string") meta.format = p.format;
  if (typeof p.table === "string") meta.table = p.table;
  if (p.query_params && typeof p.query_params === "object") {
    meta.paramKeys = Object.keys(p.query_params as Record<string, unknown>);
  }

  return meta;
}

export function extractQueryType(params: unknown): VendorQueryType {
  if (!params || typeof params !== "object") return "OTHER";
  const p = params as Record<string, unknown>;
  if (typeof p.query !== "string") return "OTHER";
  const trimmed = p.query.trimStart().toUpperCase();
  if (trimmed.startsWith("SELECT")) return "SELECT";
  if (trimmed.startsWith("WITH")) return "SELECT";
  if (trimmed.startsWith("INSERT")) return "INSERT";
  return "OTHER";
}

export function extractTableName(params: unknown): string {
  const meta = safeQueryMeta(params);
  return meta.table ?? "unknown";
}

export function extractQueryPreview(params: unknown): string | undefined {
  if (!params || typeof params !== "object") return undefined;
  const p = params as Record<string, unknown>;
  if (typeof p.query !== "string") return undefined;
  return p.query.length > 200 ? p.query.slice(0, 200) + "..." : p.query;
}

export function extractRawQuery(params: unknown): string {
  if (!params || typeof params !== "object") return "";
  const p = params as Record<string, unknown>;
  return typeof p.query === "string" ? p.query : "";
}

/**
 * The server-side exception prefix (`Code: 241. DB::Exception: ...`). The
 * class name is deliberately loose — every `*Exception` thrown means the
 * query died, and missing one is the expensive direction: an error row hits the decoder.
 */
const CLICKHOUSE_EXCEPTION_SIGNATURE = /^Code: \d+\. (\w+::)?\w*Exception:/;

/**
 * A row is the server's exception line only when `exception` is its sole
 * key AND the value carries the ClickHouse error signature — the sole-key
 * test alone would reject `SELECT status AS exception` legitimately.
 */
export function inbandExceptionOf(row: unknown): string | undefined {
  if (row === null || typeof row !== "object" || Array.isArray(row)) {
    return undefined;
  }
  if (Object.keys(row).length !== 1) return undefined;
  const exception = (row as { exception?: unknown }).exception;
  if (typeof exception !== "string") return undefined;
  return CLICKHOUSE_EXCEPTION_SIGNATURE.test(exception) ? exception : undefined;
}

/** A run of SQL code, or a quoted identifier kept verbatim. */
type SqlPart = { text: string; quoted: boolean };

/**
 * The query as code and quoted identifiers, each string literal as `?` and comments dropped, in
 * one linear pass (a backtracking regex is quadratic), so no quote or comment swallows later SQL.
 */
function sqlPartsOf(query: string): SqlPart[] {
  const parts: SqlPart[] = [];
  let code = "";
  let i = 0;
  while (i < query.length) {
    const skipped = skipLiteralOrComment({ query, i });
    if (skipped === null) {
      code += query[i];
      i++;
    } else if (skipped.quoted) {
      parts.push({ text: code, quoted: false }, { text: skipped.replacement, quoted: true });
      code = "";
      i = skipped.next;
    } else {
      code += skipped.replacement;
      i = skipped.next;
    }
  }
  parts.push({ text: code, quoted: false });

  return parts;
}

/** The query with each string literal as `?` and its comments dropped; identifiers kept. */
export function withoutLiteralsOrComments(query: string): string {
  return sqlPartsOf(query)
    .map((part) => part.text)
    .join("");
}

/** ClickHouse's line comment openers: `--`, `//`, `#!` and `# `. */
const LINE_COMMENT_OPENERS = new Set(["--", "//", "#!", "# "]);

/** What a literal or comment starting at `i` becomes, and where the SQL resumes; null if none. */
function skipLiteralOrComment({
  query,
  i,
}: {
  query: string;
  i: number;
}): { replacement: string; next: number; quoted?: true } | null {
  const ch = query[i];
  if (ch === "'") return { replacement: "?", next: endOfQuoted({ query, i: i + 1, quote: "'" }) };
  if (ch === "$") return heredocAt({ query, i });
  if (ch === '"' || ch === "`") {
    const next = endOfQuoted({ query, i: i + 1, quote: ch });
    return { replacement: query.slice(i, next), next, quoted: true };
  }
  const pair = query.slice(i, i + 2);
  if (LINE_COMMENT_OPENERS.has(pair)) {
    const end = query.indexOf("\n", i);
    return { replacement: "", next: end === -1 ? query.length : end };
  }
  if (pair === "/*") {
    const end = query.indexOf("*/", i + 2);
    return { replacement: " ", next: end === -1 ? query.length : end + 2 };
  }

  return null;
}

/** The opening tag of a ClickHouse heredoc string literal, `$$` or `$tag$`. */
const HEREDOC_TAG = /\$[A-Za-z_]\w*\$|\$\$/y;

/** A heredoc literal starting at `i`, read whole so a `--` inside it is no comment; else null. */
function heredocAt({
  query,
  i,
}: {
  query: string;
  i: number;
}): { replacement: string; next: number } | null {
  HEREDOC_TAG.lastIndex = i;
  const tag = HEREDOC_TAG.exec(query)?.[0];
  if (tag === undefined) return null;
  const end = query.indexOf(tag, i + tag.length);

  return { replacement: "?", next: end === -1 ? query.length : end + tag.length };
}

/** The index just past the `quote` closing a run starting at `i`; a doubled quote stays in. */
function endOfQuoted({ query, i, quote }: { query: string; i: number; quote: string }): number {
  let at = i;
  while (at < query.length) {
    if (query[at] === "\\") at += 2;
    else if (query[at] !== quote) at += 1;
    else if (query[at + 1] === quote) at += 2;
    else return at + 1;
  }

  return at;
}

/**
 * A query with its literals and layout removed, hashed, so the same statement run for another
 * tenant, time window or limit is one key. The warning is about the statement's form.
 */
export function queryShapeOf(rawQuery: string): string {
  const shape = sqlPartsOf(rawQuery)
    .map((part) =>
      part.quoted ? part.text : part.text.replace(/\b\d+(?:\.\d+)?\b/g, "?").replace(/\s+/g, " "),
    )
    .join("")
    .trim();

  return createHash("sha256").update(shape).digest("base64url");
}
