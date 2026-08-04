/**
 * Governed analytics SQL — the per-query tenant capability.
 *
 * The database resolves a caller's tenant by looking the value produced here up
 * in the key map (`provisioning.ts`), so this function and whatever populates
 * that table must agree byte for byte. They agree because they are the same
 * function: a second implementation of "hash the key" is a second thing to keep
 * in sync, and the failure mode when they drift is silent — the query succeeds
 * and returns zero rows, which reads exactly like a tenant with no data.
 *
 * ## Why the project key, and what that buys
 *
 * The capability is derived from the project's own API key rather than from the
 * particular credential that made the request, because it names a *tenant*, not
 * a caller: every credential authorised on a project resolves to the same rows,
 * and the row policy's job is to say which project, not which key. The security
 * property is unchanged — reaching another tenant's rows still requires that
 * tenant's project key, which already grants full access to the same data — and
 * it keeps the key map one row per project rather than one per live credential.
 *
 * The raw key never leaves the control plane: only the digest is sent, which is
 * what makes the value safe to appear in `system.query_log` for auditing.
 *
 * @see ./provisioning.ts — the key map this value is looked up in
 * @see specs/analytics/governed-sql-api.feature
 */

import { createHash } from "node:crypto";

/**
 * The tenant capability for a project, as the key map stores it.
 *
 * @param apiKey - the project's API key, in its raw form. Never logged, never
 *   sent to the database, and never returned to a caller.
 */
export function governedTenantCapability({ apiKey }: { apiKey: string }): string {
  return createHash("sha256").update(apiKey).digest("hex");
}
