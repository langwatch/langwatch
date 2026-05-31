import { timingSafeEqual } from "node:crypto";
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

/// Per-query ClickHouse-side guardrails. readonly=1 prevents writes even
/// if the wrapping or pre-check is bypassed. max_execution_time caps a
/// runaway EXPLAIN PIPELINE on a huge table. max_result_bytes caps the
/// response so an EXPLAIN INDEXES on a wide table can't OOM the box.
const CLICKHOUSE_GUARDRAILS = {
  readonly: 1,
  max_execution_time: 5,
  max_result_bytes: 10_000_000,
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
    return { ok: false, reason: `forbidden keyword in query: ${forbidden[1].toUpperCase()}` };
  }
  return { ok: true, wrapped: `EXPLAIN ${type} ${trimmed}`, type };
}

function isAuthorized(req: NextApiRequest): boolean {
  const expected = process.env.LANGWATCH_OPS_API_KEY;
  if (!expected) return false; // fail closed when not configured
  const raw = req.headers.authorization;
  if (typeof raw !== "string") return false;
  const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
  if (!m) return false;
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

  logger.info(
    { type: built.type, queryPreview: parsed.data.query.slice(0, 200) },
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
