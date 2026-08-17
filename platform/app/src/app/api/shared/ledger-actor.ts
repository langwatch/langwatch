/**
 * Who a REST write is attributed to in the grants ledger (ADR-092).
 *
 * Org-authenticated routes carry the credential and, when the key acts for a
 * person, that person. A key acting for nobody is a system principal named
 * after the credential, so an audit reader can still group a provisioning
 * run's writes — the same rule `managementActor` applies to the audit log.
 */
import type { Context } from "hono";
import type { LedgerActor } from "~/server/app-layer/authz/ledger";

export function orgRequestLedgerActor(c: Context): LedgerActor {
  const userId = c.get("apiKeyUserId") as string | null | undefined;
  if (userId) return { type: "user", id: userId };
  return { type: "system", id: `apikey:${c.get("apiKeyId") as string}` };
}
