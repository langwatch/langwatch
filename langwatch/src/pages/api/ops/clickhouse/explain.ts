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
///  2. Query normalization — a single lexer strips `/* ... */` (nested),
///     `-- ...\n`, `#`-comments, and quoted string literals in lockstep
///     with the actual ClickHouse parser. Bypasses like
///     `url/**/('http://x')` or `'/*' = 'x' OR ... url(...)` cannot evade
///     the regex pass below; an opener inside a string stays inside the
///     string, and vice versa.
///  3. Input regex filter on the normalized text — table-function
///     deny-list (url/s3/remote/file/postgresql/mysql/...), SYSTEM_SCHEMA
///     guard, multi-statement guard, forbidden-keyword guard. Tenant
///     scoping is NOT enforced here on purpose: the operator agent
///     legitimately runs cross-tenant EXPLAINs for fleet-wide queries,
///     and the boundary is at the user level (defense 6), not the SQL
///     text.
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

/// Tenant scoping is intentionally NOT enforced by this endpoint. The
/// clickhouse-optimizer agent is an operator and legitimately runs
/// cross-tenant EXPLAINs (e.g. to find a query shape that's slow across
/// the whole fleet, not just one project). The security boundary is the
/// langwatch_ops user with no SOURCES grant, not the SQL text; layering
/// a `TenantId =` regex on top would only false-reject the cross-tenant
/// cases that are part of the job.

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

/// Normalize the query for the regex safety pass with a single lexer that
/// tracks string, line-comment, and (nested) block-comment state in
/// ClickHouse order. The previous implementation ran block-comment
/// stripping BEFORE string-literal stripping, which let a `/*` inside a
/// legitimate SQL string open a phantom comment that swallowed real SQL
/// after it (the reviewer repro: `'/*' = 'x' OR ... url('http://...')`
/// would normalize to nothing past the first quoted `/*`, hiding the
/// live table-function call from the deny-list).
///
/// A character is either inside a string, inside a comment, or in normal
/// SQL — never two at once — so we walk char-by-char with one state
/// variable. Replacements preserve word boundaries:
///   - strings collapse to `''` / `""` so `WHERE x = '...'` keeps shape
///   - comments collapse to a single space so `INS/**/ERT` becomes
///     `INS ERT` (no resurrected keyword)
/// Unbalanced openers (string or block comment) consume to EOF, which is
/// what the CH parser does anyway — that query would fail to execute.
///
/// We use this only for the regex safety pass; the EXECUTED query is
/// always the caller's original text. The EXPLAIN wrapping plus the
/// langwatch_ops user (no SOURCES, scoped SELECT) are what actually
/// decide what runs.
export function stripCommentsAndStrings(query: string): string {
  let out = "";
  let i = 0;
  const n = query.length;
  while (i < n) {
    const c = query[i];
    const next = query[i + 1];

    // Block comment opener — takes precedence over `/` as a normal char.
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
      out += " "; // word boundary
      continue;
    }

    // `--` line comment.
    if (c === "-" && next === "-") {
      i += 2;
      while (i < n && query[i] !== "\n") i++;
      out += " ";
      continue;
    }

    // `#` line comment — only at the start of a token (preceded by start
    // or whitespace), to avoid clobbering identifiers like `tag#1`.
    if (c === "#" && (i === 0 || /\s/.test(query[i - 1] ?? ""))) {
      i++;
      while (i < n && query[i] !== "\n") i++;
      out += " ";
      continue;
    }

    // Single-quoted string. ClickHouse supports `''` (doubled) AND `\'`
    // (escaped) as a literal quote inside the string. We handle both.
    if (c === "'") {
      i++;
      while (i < n) {
        if (query[i] === "\\" && i + 1 < n) {
          i += 2;
          continue;
        }
        if (query[i] === "'" && query[i + 1] === "'") {
          i += 2; // escaped via doubling
          continue;
        }
        if (query[i] === "'") {
          i++; // closing quote
          break;
        }
        i++;
      }
      out += "''";
      continue;
    }

    // Double-quoted identifier / string (CH treats `"name"` as an
    // identifier but the principle is the same — keep the regex pass
    // from peeking inside).
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
