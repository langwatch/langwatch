/**
 * The operator-only `POST /api/ops/clickhouse/explain` family.
 *
 * Lets the clickhouse-optimizer agent run EXPLAIN against the ClickHouse
 * instance the deployment holds. Defenses, outermost to innermost:
 *
 *   1. An operator secret, constant-time compared.
 *   2. Query normalization (single ClickHouse-aware lexer) — bypasses like
 *      `url/**\/('http://x')` and `'/*' = 'x' OR ... url(...)` can't evade the
 *      regex pass.
 *   3. Input regex filter on the normalized text — table-function deny-list,
 *      SYSTEM_SCHEMA guard, multi-statement guard, forbidden-keyword guard.
 *      Tenant scoping is NOT enforced here on purpose: the optimizer agent
 *      legitimately runs cross-tenant EXPLAINs across the fleet.
 *   4. Server-side EXPLAIN wrapping — the caller's SQL never reaches ClickHouse
 *      unwrapped.
 *   5. EXPLAIN type allowlist — ANALYZE is blocked (it would execute the inner
 *      query).
 *   6. A dedicated readonly ClickHouse account, which is the ONE thing this
 *      family cannot compose for itself. It arrives as a service the process
 *      built from its own `CLICKHOUSE_OPS_URL`, and a process that has none
 *      does not mount this family at all — the fail-closed rule the platform
 *      application spelled as a 503 in production is a 404 here, because a
 *      family that cannot be served safely is absent rather than refusing.
 *   7. Per-query ClickHouse settings: readonly=1 + 10s exec cap + 10MB result
 *      cap + 1GB memory cap.
 *   8. Audit log of every accepted request — redacted shape + sha256 prefix,
 *      raw literals stripped so logs aren't a PII sink.
 *
 * Cross-tenant by design, which is why it is a transport in THIS package
 * rather than one more family beside the product ones: nothing else in the
 * deployment reads ClickHouse without a tenant key, and keeping the exception
 * in the operator feature is what makes it findable.
 */
import { timingSafeEqual } from "node:crypto";

import { handlerManagedAuth } from "@langwatch/api";
import type { AppRestSecurity, MountableRestApp } from "@langwatch/api/rest";

import type { OpsExplainService } from "../../services/ops-clickhouse-explain.service";
import {
  buildExplainQuery,
  explainBodySchema,
  redactQueryForAudit,
} from "../../services/ops-clickhouse-explain.core";

/** What the family needs from the process it is mounted in. */
export interface OpsClickHouseExplainRestPorts {
  /**
   * The operator secret a caller presents. Read per request so a deployment
   * that rotates it without a restart is honoured, and REQUIRED: a family with
   * no secret to compare against must not be mounted.
   */
  opsApiKey: () => string;
  /**
   * The dedicated readonly account's EXPLAIN service.
   *
   * Resolved per request, as every other family's service is: mounting must
   * not force a ClickHouse client to be opened.
   */
  explain: () => OpsExplainService;
  /**
   * Whether this deployment is production, for the service's own fail-closed
   * rule. Passed rather than read from the environment: a transport package
   * reads no environment.
   */
  isProduction: boolean;
}

/** `POST /api/ops/clickhouse/explain`, bound to one process. */
export function createOpsClickHouseExplainRestApp(options: {
  security: AppRestSecurity;
  ports: OpsClickHouseExplainRestPorts;
}): MountableRestApp {
  const { security, ports } = options;
  const secured = security.createServiceApp({ basePath: "/api" });

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
      if (!bearerTokenMatches(c.req.header("authorization"), ports.opsApiKey())) {
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

      const outcome = await ports.explain().explain({
        wrappedQuery: built.wrapped!,
        type: built.type!,
        isProduction: ports.isProduction,
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

  return secured.hono;
}

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
