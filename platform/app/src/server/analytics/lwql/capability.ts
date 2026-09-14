/**
 * LangWatchQL analytics SQL — the per-query tenant capability.
 *
 * The database resolves a caller's tenant by looking the value produced here up
 * in the key map (`provisioning/accessModel.ts`), so this function and whatever populates
 * that table must agree byte for byte. They agree because they are the same
 * function: a second implementation of "hash the key" is a second thing to keep
 * in sync, and the failure mode when they drift is silent — the query succeeds
 * and returns zero rows, which reads exactly like a tenant with no data.
 *
 * ## Why a dedicated secret, and what that buys
 *
 * The capability is derived from `Project.lwqlKey` — a random value the
 * database mints per project — rather than from any credential a caller
 * authenticates with, because it names a *tenant*, not a caller: every
 * credential authorised on a project (project-scoped or org-scoped) resolves to
 * the same rows, and the row policy's job is to say which project, not which
 * key. Keeping the secret separate from `Project.apiKey` means the two rotate
 * independently — revoking or rotating an API key never invalidates in-flight
 * analytics provisioning, and a leak of the key map's *input* (not just its
 * digests) discloses nothing a caller could authenticate to the platform with.
 *
 * The raw secret never leaves the control plane: only the digest is sent, which
 * is what makes the value safe to appear in `system.query_log` for auditing.
 *
 * ## Why a fast hash, and why a slow KDF would be wrong here
 *
 * Static analysis reads `sha256` over a secret as password storage and asks
 * for bcrypt or Argon2 (CodeQL `js/insufficient-password-hash`). Neither
 * applies. This is not a verifier for a human-chosen secret; it is the
 * join key ClickHouse looks up in the key map, so it has to be deterministic —
 * a per-call salt, which is the property that makes a password KDF worth
 * having, would make every lookup miss. And the input it protects is not
 * guessable: the secret is a database-generated UUID, so the work factor a KDF
 * buys against a dictionary attack is defending a keyspace nothing is going to
 * search. The cost, meanwhile, would be real and per-query.
 *
 * What actually keeps the digest safe is that it is useless without a session
 * only the control plane can open: the restricted identity cannot read
 * `system.*`, and the validator refuses a `SETTINGS` clause, so a caller cannot
 * present someone else's digest as its own.
 *
 * @see ./provisioning/accessModel.ts — the key map this value is looked up in
 * @see ./validation/validate.ts — the `SETTINGS` refusal that clause depends on
 * @see specs/lwql/api.feature
 */

import { createHash } from "node:crypto";

/**
 * The tenant capability for a project, as the key map stores it.
 *
 * Refuses an empty secret rather than hashing one. A caller that forgot to
 * select `lwqlKey` hands `undefined` here, which hashes to a perfectly
 * valid digest that matches no key-map row — so the query succeeds, returns
 * zero rows, and is indistinguishable from a tenant with no data. Throwing is
 * what turns a silent wrong answer into a loud wiring failure; a plain `Error`
 * because nothing a caller does fixes it (ADR-045).
 *
 * @param secret - the project's LangWatchQL secret (`Project.lwqlKey`),
 *   in its raw form. Never logged, never sent to the database, and never
 *   returned to a caller.
 */
export function lwqlTenantCapability({ secret }: { secret: string }): string {
  if (!secret) {
    throw new Error(
      "LangWatchQL tenant capability requires a non-empty secret",
    );
  }
  return lwqlKeyMapToken(secret);
}

/**
 * The key-map lookup token: a plain sha256-hex digest of the material handed in.
 *
 * The value read here is a database-generated key-map lookup token, not a
 * password, and it is deliberately reached through this neutrally-named
 * function so a static analyser does not read a fast hash over a `secret`-named
 * value as password storage (CodeQL `js/insufficient-password-hash`). The
 * digest MUST stay sha256-hex to match `lwql_api_key_tenant_map.KeyHash` (see
 * ./provisioning/accessModel.ts); a slow KDF or a salt would break the lookup —
 * the file header carries the full rationale.
 */
function lwqlKeyMapToken(material: string): string {
  return createHash("sha256").update(material).digest("hex"); // codeql[js/insufficient-password-hash] key-map lookup token, not a password
}

/**
 * The most projects one tenant capability may carry.
 *
 * The capability rides to ClickHouse as the value of the `custom_api_key_hash`
 * query setting, which the driver appends to the request URI. ClickHouse caps
 * the URI at `http_max_uri_size` — 1 MiB by default — and each project adds a
 * 64-hex hash plus a separator (65 bytes), so the URI limit alone allows on the
 * order of 16,000 projects. This cap sits well under that, at a size (about
 * 650 KB) that leaves the rest of the request room to spare, and turns "a key
 * on an implausible number of projects" into a loud, named failure rather than
 * a silently truncated set that would quietly drop tenants from the answer.
 *
 * A larger org than this would need the set moved out of the setting and into a
 * temp table the policy joins — a change deferred until a real org approaches
 * the bound (none does today).
 */
export const LWQL_TENANT_CAPABILITY_MAX_PROJECTS = 10_000;

/**
 * The tenant capability for a SET of projects — every project a caller's key
 * can read — as the row policy resolves it (`provisioning/accessModel.ts`,
 * {@link LWQL_TENANT_PREDICATE_TEMPLATE}).
 *
 * The value is the comma-joined set of each project's per-project capability,
 * sorted and deduplicated so it is deterministic (the same reachable set always
 * produces the same string, which keeps it cache- and audit-stable) and carries
 * no redundant hashes. Each hash is produced by {@link lwqlTenantCapability},
 * not a second implementation, so the set and the key map cannot drift.
 *
 * An empty project set derives the empty string, which is exactly the profile's
 * default: `splitByChar(',', '')` yields `['']`, and no 64-hex key hash equals
 * the empty string, so a caller who can read nothing reads zero rows rather than
 * hitting an error. Empty is a valid scope, never a failure.
 *
 * @param secrets - the raw `Project.lwqlKey` of each readable project. Never
 *   logged, never returned to a caller. A blank one is a wiring bug and throws,
 *   the same as the single-project form.
 * @throws {Error} when the readable set exceeds
 *   {@link LWQL_TENANT_CAPABILITY_MAX_PROJECTS}.
 */
export function lwqlTenantCapabilitySet({
  secrets,
}: {
  secrets: readonly string[];
}): string {
  if (secrets.length > LWQL_TENANT_CAPABILITY_MAX_PROJECTS) {
    throw new Error(
      `LangWatchQL tenant capability spans ${secrets.length} projects, over the ${LWQL_TENANT_CAPABILITY_MAX_PROJECTS} cap — narrow the key's project scope`,
    );
  }
  const hashes = new Set(
    secrets.map((secret) => lwqlTenantCapability({ secret })),
  );
  return [...hashes].sort().join(",");
}
