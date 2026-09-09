/**
 * The pure guardrail pass in front of the operator-only ClickHouse EXPLAIN.
 *
 * Everything here decides whether a query may be wrapped and run at all, and
 * what may be written about it afterwards. No client, no clock, no
 * environment: the service owns which account runs the wrapped query, and this
 * module owns whether there is a wrapped query to run.
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

/// Normalize the query for the regex safety pass with a single lexer that
/// tracks string, line-comment, and (nested) block-comment state in
/// ClickHouse order. A character is either inside a string, inside a
/// comment, or in normal SQL - never two at once - so we walk char-by-char
/// with one state variable. See the full rationale in the previous
/// commits' reviewer threads (string-vs-comment bypass, nested comments).
export function stripCommentsAndStrings(query: string): string {
  let out = "";
  let i = 0;
  const n = query.length;
  while (i < n) {
    const c = query[i];
    const next = query[i + 1];

    if (c === "/" && next === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (query[i] === "/" && query[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (query[i] === "*" && query[i + 1] === "/") {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }
      out += " ";
      continue;
    }

    if (c === "-" && next === "-") {
      i += 2;
      while (i < n && query[i] !== "\n") i++;
      out += " ";
      continue;
    }

    if (c === "#" && (i === 0 || /\s/.test(query[i - 1] ?? ""))) {
      i++;
      while (i < n && query[i] !== "\n") i++;
      out += " ";
      continue;
    }

    if (c === "'") {
      i++;
      while (i < n) {
        if (query[i] === "\\" && i + 1 < n) {
          i += 2;
          continue;
        }
        if (query[i] === "'" && query[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (query[i] === "'") {
          i++;
          break;
        }
        i++;
      }
      out += "''";
      continue;
    }

    if (c === '"') {
      i++;
      while (i < n) {
        if (query[i] === "\\" && i + 1 < n) {
          i += 2;
          continue;
        }
        if (query[i] === '"' && query[i + 1] === '"') {
          i += 2;
          continue;
        }
        if (query[i] === '"') {
          i++;
          break;
        }
        i++;
      }
      out += '""';
      continue;
    }

    out += c;
    i++;
  }
  return out;
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
 * The ops connection URL, split into the fields @clickhouse/client wants. The
 * userinfo split and percent-decoding are ours because the library forwards
 * `URL.username` / `URL.password` to the wire in their encoded form, so a
 * password carrying '@' or '%' would authenticate as "p%40ss" and be refused.
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
