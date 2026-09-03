/**
 * LangWatchQL analytics SQL — the per-query tenant capability.
 *
 * The database resolves a caller's tenant by looking the value produced here up
 * in the key map (`provisioning.ts`), so this function and whatever populates
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
 * ## Why bcrypt, and how it stays a usable join key
 *
 * bcrypt is the digest because the value is a hash of a secret, and a hash of a
 * secret should be a KDF whatever we believe about the keyspace behind it
 * (CodeQL `js/insufficient-password-hash`). The two properties that normally
 * make a password KDF unusable as a lookup key are dealt with here rather than
 * argued away:
 *
 * **A per-call random salt would make every lookup miss.** The key map is an
 * equality join on `KeyHash`, not a `bcrypt.compare` loop — the restricted
 * identity cannot run a verifier, it can only match the setting it was handed
 * against a row. So the salt is *derived from the secret* with HKDF instead of
 * drawn from the RNG, which keeps this a pure function of its input while still
 * giving every project a distinct salt. Deriving the salt from the secret is
 * the wrong move when the input is a human-chosen password, because it hands a
 * precomputation attack the one thing a salt is meant to deny it; it is the
 * right move when the input is a database-minted secret, where there is no
 * dictionary to precompute against and the salt's remaining job is to keep two
 * projects' digests unrelated.
 *
 * **The work factor would otherwise be paid per query.** It is paid per
 * *project*, once per process: the secret is stable, so the digest is memoised
 * under the derived salt. That also keeps the raw secret out of the cache —
 * the key is the salt, which the secret cannot be recovered from. A cold call
 * costs roughly 200ms, which is why it is awaited off the event loop rather
 * than hashed synchronously; every later query for that project reads the map.
 *
 * None of this is what makes the digest safe to hold, and the work factor
 * should not be mistaken for the control. What keeps it safe is that it is
 * useless without a session only the control plane can open: the restricted
 * identity cannot read `system.*`, and the validator refuses a `SETTINGS`
 * clause, so a caller cannot present someone else's digest as its own.
 *
 * ## Why the length guard is not paranoia
 *
 * bcrypt silently truncates its input at 72 bytes. Under a fast digest that is
 * nothing; here it means two projects whose secrets share a 72-byte prefix
 * would compute the *same capability* and read each other's rows. `lwqlKey` is
 * far shorter than that and the collision cannot happen today, which is exactly
 * why the guard has to be in the code rather than in the reader's memory: the
 * day someone lengthens the secret, this throws instead of quietly merging two
 * tenants.
 *
 * @see ./provisioning.ts — the key map this value is looked up in
 * @see ./validation/validate.ts — the `SETTINGS` refusal this design depends on
 * @see specs/analytics/lwql-api.feature
 */

import { hkdfSync } from "node:crypto";
import { hash } from "bcrypt";

/**
 * bcrypt's work factor, and part of the digest's wire format — a change here
 * changes every capability, so it is a re-provisioning of the key map.
 */
const CAPABILITY_COST = 10;

/** Domain separation, so this derivation can never collide with another. */
const SALT_NAMESPACE = "langwatchql.tenant-capability.salt.v1";
const SALT_INFO = "langwatchql.tenant-capability.v1";

/** bcrypt's salt is 16 bytes, written as 22 characters of its own base64. */
const SALT_BYTES = 16;
const SALT_CHARS = 22;

/** The input length past which bcrypt stops reading. See the guard above. */
const BCRYPT_MAX_SECRET_BYTES = 72;

/**
 * Derived capabilities, keyed by the derived salt rather than by the secret so
 * that nothing in this map can be turned back into a credential.
 *
 * It holds the in-flight hash, not the finished digest, so that concurrent
 * first queries for one project share a single hash instead of each starting
 * their own. A dashboard opening several LangWatchQL queries at once is the
 * normal case, not a rare one, and bcrypt runs on the libuv thread pool — four
 * copies of the same cold derivation would occupy all of it.
 *
 * Bounded, and evicted oldest-first: the cost of evicting a project that is
 * still active is one re-hash, so the simplest policy that cannot grow without
 * limit is the right one.
 */
const CAPABILITY_CACHE_LIMIT = 10_000;
const capabilityCache = new Map<string, Promise<string>>();

/**
 * The bcrypt salt for a secret, in the modular-crypt form bcrypt parses.
 *
 * HKDF rather than a bare digest because deriving a salt is what a KDF is for,
 * and the 16 bytes are written in bcrypt's alphabet — which is `./A-Za-z0-9`,
 * so the one character standard base64 produces that bcrypt would reject (`+`)
 * is mapped onto `.`. The trailing bits of the 22nd character are unused, and
 * bcrypt canonicalises them in its output; that is deterministic too, so the
 * digest still round-trips.
 */
function capabilitySalt(secret: string): string {
  const derived = Buffer.from(
    hkdfSync("sha256", secret, SALT_NAMESPACE, SALT_INFO, SALT_BYTES),
  );
  const encoded = derived
    .toString("base64")
    .slice(0, SALT_CHARS)
    .replace(/\+/g, ".");
  return `$2b$${String(CAPABILITY_COST).padStart(2, "0")}$${encoded}`;
}

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
export async function lwqlTenantCapability({
  secret,
}: {
  secret: string;
}): Promise<string> {
  if (!secret) {
    throw new Error(
      "LangWatchQL tenant capability requires a non-empty secret",
    );
  }
  if (Buffer.byteLength(secret, "utf8") > BCRYPT_MAX_SECRET_BYTES) {
    throw new Error(
      `LangWatchQL tenant capability requires a secret of at most ${BCRYPT_MAX_SECRET_BYTES} bytes`,
    );
  }

  const salt = capabilitySalt(secret);
  const cached = capabilityCache.get(salt);
  if (cached !== undefined) {
    return cached;
  }

  const capability = hash(secret, salt);
  if (capabilityCache.size >= CAPABILITY_CACHE_LIMIT) {
    const oldest = capabilityCache.keys().next();
    if (!oldest.done) {
      capabilityCache.delete(oldest.value);
    }
  }
  capabilityCache.set(salt, capability);
  // A failed hash must not be remembered as this project's answer: drop it so
  // the next query derives again rather than replaying the failure forever.
  // The rejection still reaches this call's caller through the returned promise.
  capability.catch(() => capabilityCache.delete(salt));
  return capability;
}
