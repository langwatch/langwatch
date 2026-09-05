/**
 * The operator-only `POST /api/ops/clickhouse/explain` family.
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
          // The engine's own prose names cluster internals; the explain
          // service logs it.
          return c.json({ message: "ClickHouse refused the EXPLAIN" }, 502);
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
