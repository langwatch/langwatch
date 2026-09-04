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
 * under a one-way derivation of it, which keeps the raw secret out of the cache
 * because nothing there can be turned back into a credential. A cold call costs
 * roughly 200ms, which is why it is awaited off the event loop rather than
 * hashed synchronously; every later query for that project reads the map.
 *
 * That cache is the one structure in this file shared by every tenant in the
 * process, so it is written to fail towards a wasted hash rather than towards
 * the wrong tenant: see {@link capabilityCache}.
 *
 * Be exact about what the work factor buys, because the encoding above gives
 * some of it back. The first 29 characters of every capability are the salt,
 * and the salt is `HKDF-SHA256(secret)` — so anyone holding a capability can
 * test a candidate secret with two HMACs instead of a cost-10 bcrypt. Against
 * a guessable secret that would matter, and the honest reading is that bcrypt
 * is here to satisfy the rule that a hash of a secret is a KDF, not to make
 * this digest expensive to attack. What actually makes guessing hopeless is
 * the input: `lwqlKey` is a database-minted UUID, so there is no dictionary
 * and no shortcut to 122 bits. Closing the gap properly would mean mixing in a
 * value that never leaves the control plane — a pepper, or a salt derived from
 * the project id rather than the secret — and either is a re-provisioning of
 * the key map, so it is a deliberate decision rather than a tidy-up.
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

/**
 * HKDF inputs, named for the parameter each one is passed as.
 *
 * {@link CAPABILITY_HKDF_SALT} is HKDF's *salt*: it separates this feature's
 * derivations from any other use of the same secret. The two `info` values
 * separate the bcrypt salt from the cache key, so a derivation for one can
 * never be mistaken for the other.
 *
 * All three strings are part of the wire format. Changing any of them changes
 * every capability, which is a re-provisioning of the key map rather than a
 * tidy-up — so they carry a version suffix and are not edited in place. The
 * historical `…salt.v1` in the first value is a name, not a description of
 * which parameter it feeds; it is left alone for that reason.
 */
const CAPABILITY_HKDF_SALT = "langwatchql.tenant-capability.salt.v1";
const BCRYPT_SALT_INFO = "langwatchql.tenant-capability.v1";
const CACHE_KEY_INFO = "langwatchql.tenant-capability.cache-key.v1";

/** bcrypt reads exactly 16 salt bytes, written as 22 base64 characters. */
const SALT_BYTES = 16;
/** Derived, never stated: base64 carries 6 bits a character. */
const SALT_CHARS = Math.ceil((SALT_BYTES * 8) / 6);

/**
 * The cache key is its own full-width derivation, not the salt.
 *
 * bcrypt fixes the salt at 16 bytes, and keying the cache by it would put a
 * cross-tenant leak behind a 128-bit birthday bound: two projects deriving one
 * salt would mean the second is served the first's capability, and reads the
 * first's rows. 32 bytes here costs nothing and is not the value bcrypt
 * constrains, so the key does not inherit that limit.
 */
const CACHE_KEY_BYTES = 32;

/** The input length past which bcrypt stops reading. See the guard above. */
const BCRYPT_MAX_SECRET_BYTES = 72;

/**
 * The modular-crypt prefix every capability this module derives begins with.
 *
 * Exported because the cost factor is part of the wire format: a stored digest
 * that does not start with this was derived by an older generation of this
 * function and no longer names its tenant. The backfill uses it to tell a row
 * it can trust from one it has to replace, which is the only way to know that
 * without re-deriving every project's capability on every deploy.
 */
export const CAPABILITY_PREFIX = `$2b$${String(CAPABILITY_COST).padStart(2, "0")}$`;

/**
 * Derived capabilities, keyed by a one-way derivation of the secret rather than
 * by the secret itself, so that nothing in this map can be turned back into a
 * credential.
 *
 * Every entry carries the salt it was derived under and a hit is only accepted
 * when that salt matches the one this call derived. A cache is shared by every
 * tenant in the process, so "the key matched" is not on its own a good enough
 * reason to hand back someone's capability; the salt check makes a mistaken hit
 * a recomputation rather than a cross-tenant read, and it costs one string
 * comparison.
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
const capabilityCache = new Map<
  string,
  { readonly salt: string; readonly capability: Promise<string> }
>();

/**
 * The bcrypt salt for a secret, in the modular-crypt form bcrypt parses.
 *
 * HKDF rather than a bare digest because deriving a salt is what a KDF is for.
 * The 16 bytes are then written as *standard* base64 with `+` remapped to `.`,
 * which lands them in the alphabet bcrypt accepts (`./A-Za-z0-9`) — the only
 * character standard base64 emits that bcrypt would reject.
 *
 * This is deliberately not bcrypt's own base64, whose ordering differs, so the
 * salt bcrypt decodes is a permutation of the HKDF output rather than the
 * output itself. That costs nothing here: the mapping is injective (`.` never
 * occurs in standard base64) and deterministic, so distinct secrets still get
 * distinct salts. It matters only to a reimplementation — a second
 * implementation in another language must copy *this* encoding, not bcrypt's,
 * or it will derive different capabilities and silently match no key-map row.
 * The trailing bits of the 22nd character are unused; bcrypt canonicalises
 * them in its output, deterministically, so the digest still round-trips.
 */
function capabilitySalt(secret: string): string {
  const derived = Buffer.from(
    hkdfSync(
      "sha256",
      secret,
      CAPABILITY_HKDF_SALT,
      BCRYPT_SALT_INFO,
      SALT_BYTES,
    ),
  );
  const encoded = derived
    .toString("base64")
    .slice(0, SALT_CHARS)
    .replace(/\+/g, ".");
  return `${CAPABILITY_PREFIX}${encoded}`;
}

/**
 * The cache key for a secret: one-way, full width, and separated from the salt
 * by its own `info` so the two derivations cannot be confused for each other.
 */
function capabilityCacheKey(secret: string): string {
  return Buffer.from(
    hkdfSync(
      "sha256",
      secret,
      CAPABILITY_HKDF_SALT,
      CACHE_KEY_INFO,
      CACHE_KEY_BYTES,
    ),
  ).toString("hex");
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
 * Refuses a secret over 72 bytes for the same reason, and it is the more
 * dangerous of the two: bcrypt stops reading there, so two secrets sharing a
 * 72-byte prefix would derive one capability and the two projects holding it
 * would read each other's rows. Callers that hash a set of projects should
 * expect this per project rather than letting one bad key take the batch down.
 *
 * The result is memoised process-wide per secret, so only the first call for a
 * project pays the work factor — roughly 200ms — and later calls are a map
 * lookup. That is why this is async and must never be made synchronous: a
 * 200ms blocking hash on a shared API process stalls every in-flight request.
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
  const cacheKey = capabilityCacheKey(secret);

  // Only a hit whose salt was derived from *this* secret is this caller's
  // answer. Anything else is treated as a miss and recomputed, so the worst a
  // key collision could cost is one hash rather than another tenant's rows.
  const cached = capabilityCache.get(cacheKey);
  if (cached !== undefined && cached.salt === salt) {
    // Re-inserted so the map orders by last use rather than by first: eviction
    // walks insertion order, and without this a project queried on every
    // request is dropped as readily as one queried once at boot.
    capabilityCache.delete(cacheKey);
    capabilityCache.set(cacheKey, cached);
    return cached.capability;
  }

  // bcrypt validates a salt's *shape* but not its alphabet: a character
  // outside `./A-Za-z0-9` stops its base64 decoder early and leaves the rest
  // of the salt buffer as uninitialised memory, so it answers with a digest
  // under a salt nobody chose instead of refusing. Today's encoder cannot emit
  // one — but switching it to `base64url` would, and the symptom would be a
  // capability that matches no key-map row, which reads exactly like a tenant
  // with no data. Checking the digest carries the salt it was asked for turns
  // that into the loud failure this module's header insists on. The final salt
  // character is excluded because bcrypt canonicalises its unused trailing
  // bits.
  const capability = hash(secret, salt).then((digest) => {
    if (!digest.startsWith(salt.slice(0, -1))) {
      throw new Error(
        "LangWatchQL tenant capability: bcrypt returned a digest under a different salt than it was given",
      );
    }
    return digest;
  });
  if (capabilityCache.size >= CAPABILITY_CACHE_LIMIT) {
    const oldest = capabilityCache.keys().next();
    if (!oldest.done) {
      capabilityCache.delete(oldest.value);
    }
  }
  capabilityCache.set(cacheKey, { salt, capability });
  // A failed hash must not be remembered as this project's answer: drop it so
  // the next query derives again rather than replaying the failure forever.
  // The rejection still reaches this call's caller through the returned promise.
  capability.catch(() => {
    if (capabilityCache.get(cacheKey)?.capability === capability) {
      capabilityCache.delete(cacheKey);
    }
  });
  return capability;
}
