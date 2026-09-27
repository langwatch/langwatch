/**
 * The pure guardrail pass in front of the operator-only ClickHouse EXPLAIN.
 * No client, no clock, no environment: the service owns which account runs
 * the wrapped query, and this module owns whether there is one to run.
 */
import { createHash } from "node:crypto";

import type { OpsExplainType } from "@langwatch/ops-contract";

/** Whether a query may be wrapped, and the wrapped form when it may. */
export interface OpsExplainBuild {
  wrapped?: string;
  type?: OpsExplainType;
  reason?: string;
}

/// `ANALYZE` would execute the inner query - never allow it. The other
/// entries here are tokens that would let a caller break out of the
/// EXPLAIN wrapper into a statement that mutates state. Even though our
/// EXPLAIN wrapping should prevent execution, ClickHouse's parser is
/// flexible enough that we keep this as a fast pre-check.
const FORBIDDEN_KEYWORD_RE =
  /\b(ANALYZE|INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE|RENAME|OPTIMIZE|SYSTEM|GRANT|REVOKE|ATTACH|DETACH|EXCHANGE|FREEZE|UNFREEZE|KILL)\b/i;

/// ClickHouse table functions that can reach external/internal network
/// targets or read arbitrary local files. `readonly=1` does NOT block
/// these - read-only just means "no INSERT/ALTER/DROP", and table
/// functions are read operations. We deny them at the pre-check layer;
/// the dedicated `langwatch_ops` user adds the access-layer boundary.
const TABLE_FUNCTION_RE =
  /\b(url|urlCluster|s3|s3Cluster|remote|remoteSecure|cluster|clusterAllReplicas|file|fileCluster|hdfs|hdfsCluster|mysql|postgresql|mongodb|odbc|jdbc|sqlite|redis|deltaLake|deltaLakeCluster|iceberg|icebergCluster|hudi|hudiCluster|azureBlobStorage|azureBlobStorageCluster|executable|input|merge|loop|view|fuzzJSON|values|format|generateRandom|numbers|numbers_mt)\s*\(/i;

/// `system.*` schema exposes server internals (users, settings, queries
/// of other tenants, etc.). Reject any reference to it.
const SYSTEM_SCHEMA_RE = /\bsystem\s*\./i;

/// Normalizes for the regex safety pass with a single lexer tracking
/// string, line-comment and nested block-comment state in ClickHouse order,
/// char-by-char with one state variable - never two states at once.
export function stripCommentsAndStrings(query: string): string {
  let out = "";
  let i = 0;
  while (i < query.length) {
    const scanned = scanAt(query, i);
    out += scanned.replacement;
    i = scanned.end;
  }
  return out;
}

/** What one lexer step at `start` consumes: where it ends and what stands in for it. */
type Scanned = Readonly<{ end: number; replacement: string }>;

/** A comment reads as one space, a string as its empty quotes, anything else as itself. */
function scanAt(query: string, start: number): Scanned {
  const c = query[start] ?? "";
  const next = query[start + 1];
  if (c === "/" && next === "*") return { end: skipBlockComment(query, start), replacement: " " };
  if (c === "-" && next === "-") return { end: skipToLineEnd(query, start + 2), replacement: " " };
  if (c === "#" && (start === 0 || /\s/.test(query[start - 1] ?? ""))) {
    return { end: skipToLineEnd(query, start + 1), replacement: " " };
  }
  if (c === "'" || c === '"') return { end: skipQuoted(query, start, c), replacement: c + c };
  return { end: start + 1, replacement: c };
}

/** Past a block comment opening at `start`, nested ones included. */
function skipBlockComment(query: string, start: number): number {
  let depth = 1;
  let i = start + 2;
  while (i < query.length && depth > 0) {
    const pair = query.slice(i, i + 2);
    if (pair === "/*") depth++;
    if (pair === "*/") depth--;
    i += pair === "/*" || pair === "*/" ? 2 : 1;
  }
  return i;
}

/** The newline ending a line comment, left for the caller to keep. */
function skipToLineEnd(query: string, start: number): number {
  const newline = query.indexOf("\n", start);
  return newline === -1 ? query.length : newline;
}

/** Past a quoted run opening at `start`, honouring backslash and doubled-quote escapes. */
function skipQuoted(query: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < query.length) {
    if (query[i] === "\\" && i + 1 < query.length) {
      i += 2;
    } else if (query[i] !== quote) {
      i++;
    } else if (query[i + 1] === quote) {
      i += 2;
    } else {
      return i + 1;
    }
  }
  return i;
}

export function buildExplainQuery(query: string, type: OpsExplainType = "PLAN"): OpsExplainBuild {
  const trimmed = query.trim();
  if (!trimmed) return { reason: "query is empty" };
  if (/^\s*EXPLAIN\b/i.test(trimmed)) {
    return {
      reason:
        "query already starts with EXPLAIN - pass the inner SELECT only and choose type via the `type` field",
    };
  }
  const normalized = stripCommentsAndStrings(trimmed);
  if (normalized.includes(";")) {
    return { reason: "query must be a single statement (no `;`)" };
  }
  const forbidden = FORBIDDEN_KEYWORD_RE.exec(normalized);
  if (forbidden) {
    return {
      reason: `forbidden keyword in query: ${(forbidden[1] ?? "").toUpperCase()}`,
    };
  }
  const tableFn = TABLE_FUNCTION_RE.exec(normalized);
  if (tableFn) {
    return {
      reason: `table function not allowed (SSRF / external-read surface): ${(tableFn[1] ?? "").toLowerCase()}()`,
    };
  }
  if (SYSTEM_SCHEMA_RE.test(normalized)) {
    return {
      reason: "references to the system.* schema are not allowed",
    };
  }
  // `INDEXES` is not a top-level EXPLAIN type in ClickHouse - it's a
  // modifier on `EXPLAIN PLAN` (`EXPLAIN PLAN indexes = 1 ...`). Sending
  // `EXPLAIN INDEXES <query>` raises a parser error and the endpoint
  // 502s. Expand it to the canonical form so callers can pass `INDEXES`
  // as a logical type without needing to know that wrinkle.
  const prefix = type === "INDEXES" ? "EXPLAIN PLAN indexes = 1, actions = 1" : `EXPLAIN ${type}`;
  return { wrapped: `${prefix} ${trimmed}`, type };
}

/**
 * What may be written down about a query that ran: its SHAPE with every
 * literal replaced, and a short digest of the original. Never the text - the
 * audit stream outlives the incident, and a query can carry a tenant's data.
 */
export function redactQueryForAudit(query: string): {
  shape: string;
  sha256: string;
} {
  const shape = query
    .replace(/'(?:\\.|[^'\\])*'/g, "'?'")
    .replace(/"(?:\\.|[^"\\])*"/g, '"?"')
    .replace(/\b\d[\d_.]*\b/g, "?")
    .replace(/\s+/g, " ")
    .trim();
  const sha256 = createHash("sha256").update(query).digest("hex").slice(0, 16);
  return { shape: shape.slice(0, 300), sha256 };
}

/**
 * The ops connection URL, split into the fields @clickhouse/client wants.
 * Userinfo split and percent-decoding are ours - the library forwards them
 * still encoded, so a password with '@' or '%' would authenticate wrong.
 */
export function findOpsConnection(raw: string): {
  url: string;
  username: string;
  password: string;
  database?: string;
} | null {
  try {
    const u = new URL(raw);
    const username = u.username ? decodeURIComponent(u.username) : "";
    const password = u.password ? decodeURIComponent(u.password) : "";
    const database =
      u.pathname && u.pathname !== "/"
        ? decodeURIComponent(u.pathname.replace(/^\//, ""))
        : undefined;
    const cleanUrl = `${u.protocol}//${u.host}`;
    return { url: cleanUrl, username, password, database };
  } catch {
    return null;
  }
}
