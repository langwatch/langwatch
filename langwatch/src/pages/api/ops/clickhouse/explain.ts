import { createHash, timingSafeEqual } from "node:crypto";
import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";
import { getSharedClickHouseClient } from "~/server/clickhouse/clickhouseClient";
import type { NextApiRequest, NextApiResponse } from "~/types/next-stubs";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:ops:clickhouse:explain");

/// Operator-only endpoint for running EXPLAIN against the live ClickHouse
/// instance the app is connected to. Lets the clickhouse-optimizer agent
/// validate query plans for proposed optimisations without needing direct
/// ClickHouse access. Defenses, outermost to innermost:
///
///  1. API key auth (LANGWATCH_OPS_API_KEY), constant-time compared.
///  2. Query normalization — strip `/* ... */`, `-- ...\n`, and quoted
///     string literals BEFORE the regex pass, so bypasses like
///     `url/**/('http://x')` or `WHERE 1=1 /* TenantId = */` cannot
///     evade the checks below.
///  3. Input regex filter on the normalized text — table-function
///     deny-list (url/s3/remote/file/postgresql/mysql/...), SYSTEM_SCHEMA
///     guard, multi-statement guard, forbidden-keyword guard, mandatory
///     `TenantId =` predicate (multitenancy invariant).
///  4. Server-side EXPLAIN wrapping — the caller's SQL never reaches the
///     DB unwrapped, so they cannot smuggle an INSERT/DROP/etc through.
///  5. EXPLAIN type allowlist — ANALYZE is blocked because it actually
///     executes the inner query (a load risk on prod).
///  6. Dedicated `langwatch_ops` ClickHouse user (via CLICKHOUSE_OPS_URL)
///     with only `GRANT SELECT ON langwatch.*`. No SOURCES grant ->
///     table functions rejected at the access-check layer regardless of
///     anything that slips past the input filter. **In production we
///     fail closed with 503 when this env var is unset** so the regex
///     filter is never the only line of defense on a deployed pod;
///     dev / NODE_ENV=test falls back to the shared client with a one-
///     shot warning so local hacking still works.
///  7. Per-query CH settings: readonly=1 + 10s execution cap + 10 MB
///     result cap + 1 GB memory cap, scoped to the EXPLAIN itself.
///  8. Audit log — every accepted request logs the redacted shape and
///     a sha256 prefix; raw literals are stripped so application logs
///     don't become a PII sink.

const ALLOWED_TYPES = ["PLAN", "SYNTAX", "PIPELINE", "AST", "INDEXES"] as const;
type ExplainType = (typeof ALLOWED_TYPES)[number];

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
/// functions are read operations. An attacker with a leaked key + just
/// `url(...)` could turn this endpoint into an SSRF surface against any
/// host the prod ClickHouse server can reach. We deny them at the
/// pre-check layer; the dedicated ClickHouse user should additionally
/// have these revoked at the grant layer (future hardening, tracked).
/// Matches `name(` so an unrelated identifier ending in e.g. "url" is
/// not false-rejected.
const TABLE_FUNCTION_RE =
  /\b(url|urlCluster|s3|s3Cluster|remote|remoteSecure|cluster|clusterAllReplicas|file|fileCluster|hdfs|hdfsCluster|mysql|postgresql|mongodb|odbc|jdbc|sqlite|redis|deltaLake|deltaLakeCluster|iceberg|icebergCluster|hudi|hudiCluster|azureBlobStorage|azureBlobStorageCluster|executable|input|merge|loop|view|fuzzJSON|values|format|generateRandom|numbers|numbers_mt)\s*\(/i;

/// `system.*` schema exposes server internals (users, settings, queries
/// of other tenants, etc.). Reject any reference to it.
const SYSTEM_SCHEMA_RE = /\bsystem\s*\./i;

/// Every ClickHouse query in this codebase MUST be scoped by TenantId
/// (multitenancy invariant). EXPLAIN is no different — an unscoped
/// EXPLAIN reveals partition stats across tenants. Soft check: the
/// query body must mention `TenantId =` somewhere. The caller is
/// trusted to pass the correct value; this just ensures the query is
/// of the right shape and not a "SELECT count() FROM stored_spans".
const TENANT_PREDICATE_RE = /\bTenantId\s*=/;

/// Per-query ClickHouse-side guardrails. readonly=1 prevents writes even
/// if the wrapping or pre-check is bypassed. max_execution_time caps a
/// runaway EXPLAIN PIPELINE on a huge table. max_result_bytes caps the
/// response so an EXPLAIN INDEXES on a wide table can't OOM the box.
/// max_memory_usage backstops a query that the result-bytes cap doesn't
/// reach (e.g. a heavy GROUP BY in EXPLAIN PIPELINE).
/// Must stay aligned with the langwatch_ops profile in
/// infrastructure/clickhouse-serverless/config/users.xml.template.
/// ClickHouseSettings is picky: `readonly` / `max_result_bytes` /
/// `max_memory_usage` are typed `UInt64 = string`, `max_execution_time`
/// is `Seconds = number`.
const CLICKHOUSE_GUARDRAILS = {
  readonly: "1",
  max_execution_time: 10,
  max_result_bytes: "10000000",
  max_memory_usage: "1073741824",
} as const;

const bodySchema = z.object({
  query: z.string().trim().min(1, "query is required").max(50_000),
  type: z.enum(ALLOWED_TYPES).optional(),
});

export interface ParseResult {
  ok: boolean;
  /// The wrapped SQL to send to ClickHouse, or undefined when ok=false.
  wrapped?: string;
  type?: ExplainType;
  /// Human-readable rejection reason for ok=false.
  reason?: string;
}

/// Strip block comments with a small state machine that tracks nesting —
/// ClickHouse treats `/* outer /* inner */ */` as ONE comment, but a
/// non-greedy regex would stop at the first `*/` and resurrect the
/// fake-predicate-bearing tail (`TenantId = '...' */`) as live SQL text.
/// Replaces each top-level comment with a single space so adjacency
/// tricks like `INS/**/ERT` collapse to `INS ERT` (no keyword reborn).
/// If a comment is unbalanced (depth never returns to 0), we consume to
/// EOF — same behaviour ClickHouse exhibits, the query would fail to
/// parse there too, so the regex pass treating the rest as gone is fine.
function stripBlockComments(s: string): string {
  let out = "";
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (depth === 0) {
      if (s[i] === "/" && s[i + 1] === "*") {
        depth = 1;
        i++; // consume the `*`
        continue;
      }
      out += s[i];
    } else {
      if (s[i] === "/" && s[i + 1] === "*") {
        depth++;
        i++;
      } else if (s[i] === "*" && s[i + 1] === "/") {
        depth--;
        i++;
        if (depth === 0) out += " "; // separator so `a/**/b` -> `a b`
      }
      // else: swallow the char, we're inside a comment
    }
  }
  return out;
}

/// Strip SQL comments and quoted string literals from the query so the
/// regex pass below cannot be tricked by tokens that the ClickHouse parser
/// will treat as no-ops. Without this, `url/**/('http://x')` evades the
/// table-function check (`\burl\s*\(` doesn't see the `/* */` between
/// `url` and `(`), and `WHERE 1=1 /* TenantId = */` satisfies the tenant
/// predicate without filtering anything. Nested block comments are
/// handled by stripBlockComments above.
///
/// Returns the normalized text — same length as the input is NOT
/// guaranteed. We use this only for the safety regex pass; the EXECUTED
/// query is always the caller's original text, because the EXPLAIN
/// wrapping + ClickHouse parser handle the real SQL.
export function stripCommentsAndStrings(query: string): string {
  // The order matters. Block comments may legally contain `'` or `"`
  // (and line-comment markers) that would otherwise open a phantom
  // string. So strip comments first, then strings.
  let s = stripBlockComments(query);
  // Line comments -- ... and # ... to end of line (CH supports both `--`
  // and `#`; the # form must be at start-of-token to count, but we play
  // safe and strip from `#` to newline whenever found).
  s = s.replace(/--[^\n]*/g, " ");
  s = s.replace(/(^|\s)#[^\n]*/g, "$1 ");
  // Quoted string literals — both single- and double-quoted, with `\'`
  // and `\"` escape handling. The replacement leaves an empty pair so
  // the resulting string still parses if anything cares (regex doesn't).
  s = s.replace(/'(?:\\.|[^'\\])*'/g, "''");
  s = s.replace(/"(?:\\.|[^"\\])*"/g, '""');
  return s;
}

/// Pure function for the SQL-wrapping logic so it stays unit-testable.
/// Returns `{ ok: true, wrapped }` when the query is acceptable, or
/// `{ ok: false, reason }` with a one-line user-facing reason otherwise.
export function buildExplainQuery(query: string, type: ExplainType = "PLAN"): ParseResult {
  const trimmed = query.trim();
  if (!trimmed) return { ok: false, reason: "query is empty" };
  if (/^\s*EXPLAIN\b/i.test(trimmed)) {
    return { ok: false, reason: "query already starts with EXPLAIN — pass the inner SELECT only and choose type via the `type` field" };
  }
  // Normalize once and run every regex against the result. The EXECUTED
  // query stays the original (literals, comments and all) — the EXPLAIN
  // wrapper plus the access-layer boundary on the dedicated user are
  // what actually decide what runs.
  const normalized = stripCommentsAndStrings(trimmed);
  if (normalized.includes(";")) {
    // ClickHouse HTTP rejects multi-statement queries already, but reject
    // here so we don't even hand it to the driver. Catches trailing `;`
    // copy-paste and any attempt at statement chaining. Checking the
    // normalized text means a `;` inside a string literal is fine.
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
  if (!TENANT_PREDICATE_RE.test(normalized)) {
    return {
      ok: false,
      reason: "query must include a `TenantId = ...` predicate (multitenancy invariant)",
    };
  }
  return { ok: true, wrapped: `EXPLAIN ${type} ${trimmed}`, type };
}

/// Audit-safe fingerprint for the log. The query can contain TenantIds
/// (acceptable to log internally) but also PII-bearing literals from a
/// `WHERE` clause — names, emails, span attributes. Strip every quoted
/// literal and number so what we keep is the SQL shape only, plus a
/// hash to correlate identical queries across log lines.
export function redactQueryForAudit(query: string): { shape: string; sha256: string } {
  const shape = query
    // Drop single- and double-quoted string literals.
    .replace(/'(?:\\.|[^'\\])*'/g, "'?'")
    .replace(/"(?:\\.|[^"\\])*"/g, '"?"')
    // Drop bare numeric literals (durations, ids, partition keys, etc.).
    .replace(/\b\d[\d_.]*\b/g, "?")
    // Collapse whitespace so the log line is a single readable token.
    .replace(/\s+/g, " ")
    .trim();
  const sha256 = createHash("sha256").update(query).digest("hex").slice(0, 16);
  return { shape: shape.slice(0, 300), sha256 };
}

/// Lazily-built dedicated client for the langwatch_ops user. Module-scoped
/// cache so we reuse the connection pool across requests; reset only when
/// the env var changes (which doesn't happen in a live pod). When
/// CLICKHOUSE_OPS_URL is unset, returns null and the handler falls back to
/// the shared default-user client.
let opsClickHouseClient: ClickHouseClient | null = null;
let warnedAboutMissingOpsUrl = false;

export function getOpsClickHouseClient(): ClickHouseClient | null {
  if (opsClickHouseClient) return opsClickHouseClient;
  const url = process.env.CLICKHOUSE_OPS_URL;
  if (!url || url.trim() === "") return null;
  let parsed: URL | string = url;
  try {
    parsed = new URL(url);
  } catch {
    // pass raw if not a valid URL — driver may still accept it
  }
  opsClickHouseClient = createClient({
    url: parsed,
    clickhouse_settings: { date_time_input_format: "best_effort" },
    max_open_connections: 5,
    keep_alive: { enabled: true, idle_socket_ttl: 1500 },
  });
  return opsClickHouseClient;
}

/// Exported for unit tests to reset the cached client between tests.
export function _resetOpsClickHouseClientForTesting(): void {
  opsClickHouseClient = null;
  warnedAboutMissingOpsUrl = false;
}

function isAuthorized(req: NextApiRequest): boolean {
  const expected = process.env.LANGWATCH_OPS_API_KEY;
  if (!expected) return false; // fail closed when not configured
  const raw = req.headers.authorization;
  if (typeof raw !== "string") return false;
  const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
  if (!m?.[1]) return false;
  const presented = m[1].trim();
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }
  if (!isAuthorized(req)) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: fromZodError(parsed.error).message });
  }
  const built = buildExplainQuery(parsed.data.query, parsed.data.type);
  if (!built.ok) {
    return res.status(400).json({ message: built.reason });
  }

  // Prefer the dedicated langwatch_ops user (no SOURCES grant, so url/s3/
  // remote/file/postgresql table functions are refused at the access-check
  // layer). In PRODUCTION, fail closed when CLICKHOUSE_OPS_URL is unset —
  // a fallback to the default-user client would leave the regex filter as
  // the only line of defense, and that filter is best-effort (a determined
  // attacker can find SQL syntax the deny-list doesn't cover; see also the
  // comment / string-literal bypasses fixed in stripCommentsAndStrings).
  // In dev / test we still fall back with a warning so local hacking and
  // pre-prod migrations work.
  let client = getOpsClickHouseClient();
  let usingFallback = false;
  if (!client) {
    if (process.env.NODE_ENV === "production") {
      logger.error(
        "CLICKHOUSE_OPS_URL is not set in production — refusing to fall back to the default-user client. " +
          "Provision the langwatch_ops user (see infrastructure/clickhouse-serverless/config/users.xml.template) " +
          "and set CLICKHOUSE_OPS_URL.",
      );
      return res.status(503).json({
        message:
          "ClickHouse ops user is not configured on this instance (CLICKHOUSE_OPS_URL unset in production).",
      });
    }
    if (!warnedAboutMissingOpsUrl) {
      logger.warn(
        "CLICKHOUSE_OPS_URL is not set — /ops/clickhouse/explain is falling back to the default-user client. " +
          "Provision the langwatch_ops user (see infrastructure/clickhouse-serverless/config/users.xml.template) " +
          "and set CLICKHOUSE_OPS_URL to remove this fallback.",
      );
      warnedAboutMissingOpsUrl = true;
    }
    usingFallback = true;
    client = getSharedClickHouseClient();
  }
  if (!client) {
    return res.status(503).json({ message: "ClickHouse is not configured on this instance" });
  }

  // Audit log: shape + hash only. Literals (tenant ids, span attributes,
  // user-supplied values) are stripped so application logs don't become
  // a PII sink. The hash lets us correlate repeated identical queries.
  logger.info(
    { type: built.type, usingFallback, ...redactQueryForAudit(parsed.data.query) },
    "ops explain",
  );

  try {
    const result = await client.query({
      query: built.wrapped!,
      format: "JSONEachRow",
      clickhouse_settings: CLICKHOUSE_GUARDRAILS,
    });
    const rows = await result.json();
    return res.status(200).json({ type: built.type, rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err: msg }, "ops explain failed");
    return res.status(502).json({ message: `ClickHouse error: ${msg}` });
  }
}
