/**
 * Who a REST write is attributed to in the grants ledger (ADR-092).
 *
 * Org-authenticated routes carry the credential and, when the key acts for a
 * person, that person. A key acting for nobody is a system principal named
 * after the credential, so an audit reader can still group a provisioning
 * run's writes — the same rule `managementActor` applies to the audit log.
 *
 * The actor id is written into a durable fact, so it is never allowed to be
 * an interpolated `undefined`. A context carrying neither a user nor a key id
 * is not something a caller can be told about — org authentication should
 * have set one — so the write is attributed to the service itself and the
 * anomaly is logged, rather than persisting `apikey:undefined` in the audit
 * trail of every such write.
 */
import type { LedgerActor } from "@langwatch/authz-server";
import { createLogger } from "@langwatch/observability";
import type { Context } from "hono";
import { ledgerActorFor } from "~/server/app-layer/authz/ledger-actor";

const logger = createLogger("langwatch:api:ledger-actor");

export function orgRequestLedgerActor(c: Context): LedgerActor {
  const userId = c.get("apiKeyUserId") as string | null | undefined;
  const apiKeyId = c.get("apiKeyId") as string | null | undefined;

  if (!userId && !apiKeyId) {
    logger.warn(
      { path: c.req.path, method: c.req.method },
      "an organization-authenticated request named neither a user nor an API key; attributing the grants-ledger write to the management API itself",
    );
  }

  return ledgerActorFor({ userId, apiKeyId, fallback: "managementApi" });
}
