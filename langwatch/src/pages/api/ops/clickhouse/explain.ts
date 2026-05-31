import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";
import { getSharedClickHouseClient } from "~/server/clickhouse/clickhouseClient";
import type { NextApiRequest, NextApiResponse } from "~/types/next-stubs";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:ops:clickhouse:explain");

/// Operator-only endpoint for running EXPLAIN against the live ClickHouse
/// instance the app is connected to. Lets the clickhouse-optimizer agent
/// validate query plans for proposed optimisations without needing direct
/// ClickHouse access. Defenses:
///
///  1. API key auth (LANGWATCH_OPS_API_KEY), constant-time compared.
///  2. Server-side EXPLAIN wrapping — the user's SQL never reaches the
///     DB unwrapped, so they cannot smuggle an INSERT/DROP/etc through.
///  3. EXPLAIN type allowlist — ANALYZE is blocked because it actually
///     executes the inner query (a load risk on prod).
///  4. Forbidden-keyword pre-filter, defense in depth on top of the
///     wrapper. Catches `INSERT`/`DROP`/`ALTER`/etc in the body.
///  5. ClickHouse-side readonly=1 + a 5s execution cap + 10 MB result
///     cap, the actual backstop if everything above is bypassed.
///  6. Audit log — every accepted request logs caller-identified label,
///     EXPLAIN type, and the first 200 chars of the query.

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
/// The ClickHouse settings type expects string values, even for the
/// numeric ones — the server parses them.
const CLICKHOUSE_GUARDRAILS = {
  readonly: "1",
  max_execution_time: "5",
  max_result_bytes: "10000000",
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

/// Pure function for the SQL-wrapping logic so it stays unit-testable.
/// Returns `{ ok: true, wrapped }` when the query is acceptable, or
/// `{ ok: false, reason }` with a one-line user-facing reason otherwise.
export function buildExplainQuery(query: string, type: ExplainType = "PLAN"): ParseResult {
  const trimmed = query.trim();
  if (!trimmed) return { ok: false, reason: "query is empty" };
  if (/^\s*EXPLAIN\b/i.test(trimmed)) {
    return { ok: false, reason: "query already starts with EXPLAIN — pass the inner SELECT only and choose type via the `type` field" };
  }
  if (trimmed.includes(";")) {
    // ClickHouse HTTP rejects multi-statement queries already, but reject
    // here so we don't even hand it to the driver. Catches trailing `;`
    // copy-paste and any attempt at statement chaining.
    return { ok: false, reason: "query must be a single statement (no `;`)" };
  }
  const forbidden = FORBIDDEN_KEYWORD_RE.exec(trimmed);
  if (forbidden) {
    return { ok: false, reason: `forbidden keyword in query: ${(forbidden[1] ?? "").toUpperCase()}` };
  }
  const tableFn = TABLE_FUNCTION_RE.exec(trimmed);
  if (tableFn) {
    return {
      ok: false,
      reason: `table function not allowed (SSRF / external-read surface): ${(tableFn[1] ?? "").toLowerCase()}()`,
    };
  }
  if (SYSTEM_SCHEMA_RE.test(trimmed)) {
    return { ok: false, reason: "references to the system.* schema are not allowed" };
  }
  if (!TENANT_PREDICATE_RE.test(trimmed)) {
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

  const client = getSharedClickHouseClient();
  if (!client) {
    return res.status(503).json({ message: "ClickHouse is not configured on this instance" });
  }

  // Audit log: shape + hash only. Literals (tenant ids, span attributes,
  // user-supplied values) are stripped so application logs don't become
  // a PII sink. The hash lets us correlate repeated identical queries.
  logger.info({ type: built.type, ...redactQueryForAudit(parsed.data.query) }, "ops explain");

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
