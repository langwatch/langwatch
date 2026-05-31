import { createHash } from "node:crypto";
import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { z } from "zod";

/// Pure helpers for the /api/ops/clickhouse/explain endpoint. The handler
/// itself lives in src/server/routes/ops.ts (Hono); these functions stay
/// pure so they can be unit-tested in isolation.

export const ALLOWED_EXPLAIN_TYPES = ["PLAN", "SYNTAX", "PIPELINE", "AST", "INDEXES"] as const;
export type ExplainType = (typeof ALLOWED_EXPLAIN_TYPES)[number];

/// `ANALYZE` would execute the inner query — never allow it. The other
/// entries here are tokens that would let a caller break out of the
/// EXPLAIN wrapper into a statement that mutates state. Even though our
/// EXPLAIN wrapping should prevent execution, ClickHouse's parser is
/// flexible enough that we keep this as a fast pre-check.
const FORBIDDEN_KEYWORD_RE =
  /\b(ANALYZE|INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE|RENAME|OPTIMIZE|SYSTEM|GRANT|REVOKE|ATTACH|DETACH|EXCHANGE|FREEZE|UNFREEZE|KILL)\b/i;

/// ClickHouse table functions that can reach external/internal network
/// targets or read arbitrary local files. `readonly=1` does NOT block
/// these — read-only just means "no INSERT/ALTER/DROP", and table
/// functions are read operations. We deny them at the pre-check layer;
/// the dedicated `langwatch_ops` user adds the access-layer boundary.
const TABLE_FUNCTION_RE =
  /\b(url|urlCluster|s3|s3Cluster|remote|remoteSecure|cluster|clusterAllReplicas|file|fileCluster|hdfs|hdfsCluster|mysql|postgresql|mongodb|odbc|jdbc|sqlite|redis|deltaLake|deltaLakeCluster|iceberg|icebergCluster|hudi|hudiCluster|azureBlobStorage|azureBlobStorageCluster|executable|input|merge|loop|view|fuzzJSON|values|format|generateRandom|numbers|numbers_mt)\s*\(/i;

/// `system.*` schema exposes server internals (users, settings, queries
/// of other tenants, etc.). Reject any reference to it.
const SYSTEM_SCHEMA_RE = /\bsystem\s*\./i;

/// Per-query ClickHouse-side guardrails. Must stay aligned with the
/// langwatch_ops profile in
/// infrastructure/clickhouse-serverless/config/users.xml.template.
/// ClickHouseSettings is picky: `readonly` / `max_result_bytes` /
/// `max_memory_usage` are typed `UInt64 = string`, `max_execution_time`
/// is `Seconds = number`.
export const CLICKHOUSE_GUARDRAILS = {
  readonly: "1",
  max_execution_time: 10,
  max_result_bytes: "10000000",
  max_memory_usage: "1073741824",
} as const;

export const explainBodySchema = z.object({
  query: z.string().trim().min(1, "query is required").max(50_000),
  type: z.enum(ALLOWED_EXPLAIN_TYPES).optional(),
});

export interface ParseResult {
  ok: boolean;
  wrapped?: string;
  type?: ExplainType;
  reason?: string;
}

/// Normalize the query for the regex safety pass with a single lexer that
/// tracks string, line-comment, and (nested) block-comment state in
/// ClickHouse order. A character is either inside a string, inside a
/// comment, or in normal SQL — never two at once — so we walk char-by-char
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

export function buildExplainQuery(query: string, type: ExplainType = "PLAN"): ParseResult {
  const trimmed = query.trim();
  if (!trimmed) return { ok: false, reason: "query is empty" };
  if (/^\s*EXPLAIN\b/i.test(trimmed)) {
    return { ok: false, reason: "query already starts with EXPLAIN — pass the inner SELECT only and choose type via the `type` field" };
  }
  const normalized = stripCommentsAndStrings(trimmed);
  if (normalized.includes(";")) {
    return { ok: false, reason: "query must be a single statement (no `;`)" };
  }
  const forbidden = FORBIDDEN_KEYWORD_RE.exec(normalized);
  if (forbidden) {
    return { ok: false, reason: `forbidden keyword in query: ${(forbidden[1] ?? "").toUpperCase()}` };
  }
  const tableFn = TABLE_FUNCTION_RE.exec(normalized);
  if (tableFn) {
    return {
      ok: false,
      reason: `table function not allowed (SSRF / external-read surface): ${(tableFn[1] ?? "").toLowerCase()}()`,
    };
  }
  if (SYSTEM_SCHEMA_RE.test(normalized)) {
    return { ok: false, reason: "references to the system.* schema are not allowed" };
  }
  return { ok: true, wrapped: `EXPLAIN ${type} ${trimmed}`, type };
}

export function redactQueryForAudit(query: string): { shape: string; sha256: string } {
  const shape = query
    .replace(/'(?:\\.|[^'\\])*'/g, "'?'")
    .replace(/"(?:\\.|[^"\\])*"/g, '"?"')
    .replace(/\b\d[\d_.]*\b/g, "?")
    .replace(/\s+/g, " ")
    .trim();
  const sha256 = createHash("sha256").update(query).digest("hex").slice(0, 16);
  return { shape: shape.slice(0, 300), sha256 };
}

let opsClickHouseClient: ClickHouseClient | null = null;
let warnedAboutMissingOpsUrl = false;

/**
 * Parse CLICKHOUSE_OPS_URL into the pieces @clickhouse/client wants as
 * separate config fields. We do the userinfo split + percent-decoding
 * ourselves because the lib forwards `URL.username` / `URL.password`
 * to the wire as-is — both getters return the URL-encoded form. With a
 * Terraform-generated password that may contain '@' or '%' (which TF
 * wraps via `urlencode()` to keep the URL parseable), passing the URL
 * verbatim ends up authenticating with the encoded form (e.g. "p%40ss")
 * and ClickHouse rejects with "Authentication failed". Decoding here
 * means the wire password matches what users.xml hashes.
 */
export function parseOpsConnection(raw: string): {
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

export function getOpsClickHouseClient(): ClickHouseClient | null {
  if (opsClickHouseClient) return opsClickHouseClient;
  const url = process.env.CLICKHOUSE_OPS_URL;
  if (!url || url.trim() === "") return null;
  const parsed = parseOpsConnection(url);
  opsClickHouseClient = createClient({
    url: parsed?.url ?? url,
    username: parsed?.username || undefined,
    password: parsed?.password || undefined,
    database: parsed?.database,
    clickhouse_settings: { date_time_input_format: "best_effort" },
    max_open_connections: 5,
    keep_alive: { enabled: true, idle_socket_ttl: 1500 },
  });
  return opsClickHouseClient;
}

export function consumeMissingOpsUrlWarning(): boolean {
  if (warnedAboutMissingOpsUrl) return false;
  warnedAboutMissingOpsUrl = true;
  return true;
}

export function _resetOpsClickHouseClientForTesting(): void {
  opsClickHouseClient = null;
  warnedAboutMissingOpsUrl = false;
}
