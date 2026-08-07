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
 * ## Why a fast hash, and why a slow KDF would be wrong here
 *
 * Static analysis reads `sha256` over something named `apiKey` as password
 * storage and asks for bcrypt or Argon2 (CodeQL `js/insufficient-password-hash`).
 * Neither applies. This is not a verifier for a human-chosen secret; it is the
 * join key ClickHouse looks up in the key map, so it has to be deterministic —
 * a per-call salt, which is the property that makes a password KDF worth
 * having, would make every lookup miss. And the input it protects is not
 * guessable: `generateApiKey` draws 48 characters from a 62-character alphabet,
 * so the work factor a KDF buys against a dictionary attack is defending a
 * keyspace nothing is going to search. The cost, meanwhile, would be real and
 * per-query.
 *
 * What actually keeps the digest safe is that it is useless without a session
 * only the control plane can open: the restricted identity cannot read
 * `system.*`, and the validator refuses a `SETTINGS` clause, so a caller cannot
 * present someone else's digest as its own.
 *
 * @see ./provisioning.ts — the key map this value is looked up in
 * @see ./validation/validate.ts — the `SETTINGS` refusal that clause depends on
 * @see specs/analytics/governed-sql-api.feature
 */

import { createHash } from "node:crypto";

/**
 * The tenant capability for a project, as the key map stores it.
 *
 * @param apiKey - the project's API key, in its raw form. Never logged, never
 *   sent to the database, and never returned to a caller.
 */
export function governedTenantCapability({
  apiKey,
}: {
  apiKey: string;
}): string {
  return createHash("sha256").update(apiKey).digest("hex");
}
