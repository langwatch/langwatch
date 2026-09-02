/**
 * Hono route for the operator-only /api/ops/clickhouse/explain endpoint.
 *
 * Lets the clickhouse-optimizer agent run EXPLAIN against the live
 * ClickHouse instance the app is connected to. Defenses, outermost to
 * innermost:
 *
 *   1. API key auth (LANGWATCH_OPS_API_KEY), constant-time compared.
 *   2. Query normalization (single CH-aware lexer) — bypasses like
 *      `url/**\/('http://x')` and `'/*' = 'x' OR ... url(...)` can't
 *      evade the regex pass.
 *   3. Input regex filter on the normalized text — table-function
 *      deny-list, SYSTEM_SCHEMA guard, multi-statement guard,
 *      forbidden-keyword guard. Tenant scoping is NOT enforced here
 *      on purpose: the optimizer agent legitimately runs cross-tenant
 *      EXPLAINs across the fleet.
 *   4. Server-side EXPLAIN wrapping — the caller's SQL never reaches
 *      CH unwrapped.
 *   5. EXPLAIN type allowlist — ANALYZE is blocked (it would execute
 *      the inner query).
 *   6. Dedicated langwatch_ops CH user (via CLICKHOUSE_OPS_URL) with
 *      only `GRANT SELECT ON langwatch.*` and no SOURCES grant. **In
 *      production we fail closed with 503 when this env var is unset**
 *      so the regex filter is never the only line of defense.
 *   7. Per-query CH settings: readonly=1 + 10s exec cap + 10MB result
 *      cap + 1GB memory cap.
 *   8. Audit log of every accepted request — redacted shape + sha256
 *      prefix, raw literals stripped so logs aren't a PII sink.
 *
 * History note: this used to live at src/pages/api/ops/clickhouse/explain.ts
 * back when the app was Next.js. After the move to a Hono-based service,
 * the file kept compiling but was never bound to an HTTP path, so the
 * endpoint silently 404'd in production despite green unit + integration
 * tests (the tests invoked the handler function directly instead of going
 * through HTTP). This version is registered in api-router.ts and the
 * integration test issues real HTTP requests.
 */
import { timingSafeEqual } from "node:crypto";
import { createServiceApp } from "~/server/api/security";
import { handlerManagedAuth } from "@langwatch/platform-api/app-rest";
import {
  buildExplainQuery,
  explainBodySchema,
  redactQueryForAudit,
} from "~/server/ops/explain-core";

function bearerTokenMatches(headerValue: string | undefined, expected: string): boolean {
  if (!headerValue) return false;
  const m = /^Bearer\s+(.+)$/i.exec(headerValue.trim());
  if (!m?.[1]) return false;
  const presented = m[1].trim();
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const secured = createServiceApp({ basePath: "/api" });

secured
  .access(
    handlerManagedAuth({
      reason:
        "Bearer LANGWATCH_OPS_API_KEY constant-time compared; missing or wrong key returns 401. Operator-only endpoint for the clickhouse-optimizer agent.",
      // Operator secret, not an RBAC permission.
      permissions: [],
      credential: "internal",
    }),
  )
  .post("/ops/clickhouse/explain", async (c) => {
    const expected = process.env.LANGWATCH_OPS_API_KEY;
    if (!expected) {
      // Fail closed when not configured.
      return c.json({ message: "Unauthorized" }, 401);
    }
    if (!bearerTokenMatches(c.req.header("authorization"), expected)) {
      return c.json({ message: "Unauthorized" }, 401);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ message: "request body must be JSON" }, 400);
    }
    const parsed = explainBodySchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue?.path?.length ? `${issue.path.join(".")}: ` : "";
      return c.json({ message: `${path}${issue?.message ?? "invalid body"}` }, 400);
    }

    const built = buildExplainQuery(parsed.data.query, parsed.data.type);
    if (!built.ok) {
      return c.json({ message: built.reason }, 400);
    }

    const outcome = await c.app.opsExplain.service.explain({
      wrappedQuery: built.wrapped!,
      type: built.type!,
      isProduction: process.env.NODE_ENV === "production",
      auditFields: redactQueryForAudit(parsed.data.query),
    });

    switch (outcome.status) {
      case "not_configured_in_production":
        return c.json(
          {
            message:
              "ClickHouse ops user is not configured on this instance (CLICKHOUSE_OPS_URL unset in production).",
          },
          503,
        );
      case "unavailable":
        return c.json({ message: "ClickHouse is not configured on this instance" }, 503);
      case "error":
        return c.json({ message: `ClickHouse error: ${outcome.message}` }, 502);
      case "ok":
        return c.json({ type: built.type, rows: outcome.rows });
    }
  });

export const app = secured.hono;
