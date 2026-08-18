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
import { createLogger } from "@langwatch/observability";
import type { Context } from "hono";
import type { LedgerActor } from "~/server/app-layer/authz/ledger";

const logger = createLogger("langwatch:api:ledger-actor");

/** The stand-in for a request that names no principal at all. */
const UNATTRIBUTED_ACTOR: LedgerActor = {
  type: "system",
  id: "system:management-api",
};

export function orgRequestLedgerActor(c: Context): LedgerActor {
  const userId = c.get("apiKeyUserId") as string | null | undefined;
  if (userId) return { type: "user", id: userId };

  const apiKeyId = c.get("apiKeyId") as string | null | undefined;
  if (apiKeyId) return { type: "system", id: `apikey:${apiKeyId}` };

  logger.warn(
    { path: c.req.path, method: c.req.method },
    "an organization-authenticated request named neither a user nor an API key; attributing the grants-ledger write to the management API itself",
  );
  return UNATTRIBUTED_ACTOR;
}
