/**
 * ADR-092 §12 — the org authz epoch: one integer per organization, bumped on
 * every grant write, compared on every cached read. Redis-backed so all app
 * processes share it; a missing/unavailable epoch disables caching (collect
 * fresh), never staleness.
 *
 * Whether the cache is consulted at all is the composition root's decision
 * (src/server/authz/runtime.ts owns that env read); this module only answers
 * what the epoch IS.
 */
import { createLogger } from "@langwatch/observability";
import { tryGetApp } from "../app-layer/app";

const logger = createLogger("langwatch:authz:epoch");

const EPOCH_KEY_PREFIX = "authz:epoch:";

/**
 * Current epoch for an organization, or null when there is no epoch to
 * compare against — the store is unavailable (build, tests, Redis down), the
 * key is not there, or what is stored does not parse. Null means "do not
 * cache": AuthzService collects fresh, which is always correct.
 *
 * A missing key deliberately does NOT read as epoch 0. An organization no
 * grant write has bumped yet, and one whose key was evicted or flushed, are
 * indistinguishable here, and the second is exactly the case where a shared
 * "0" would let entries cached before the flush agree with reads after it.
 * Caching starts once a write establishes the counter.
 */
export async function getAuthzEpoch({
  organizationId,
}: {
  organizationId: string;
}): Promise<number | null> {
  // Degrade by contract, like the fail-open rate limiters: no App (build,
  // unit tests) or no Redis both mean "no epoch to compare against".
  const connection = tryGetApp()?.redis;
  if (!connection) return null;
  try {
    const raw = await connection.get(`${EPOCH_KEY_PREFIX}${organizationId}`);
    if (raw == null) return null;
    // Full-string match, not parseInt(): parseInt("12abc") is 12, and
    // Number("") is 0 — either would read a foreign value as a usable
    // epoch. INCR only ever writes integers, so anything else here means
    // the key was written by something else: exactly the case null is for.
    if (!/^-?\d+$/.test(raw)) return null;
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) ? parsed : null;
  } catch (error) {
    logger.warn({ error, organizationId }, "authz epoch read failed");
    return null;
  }
}

/**
 * Bump the epoch after any grant write. Failure is logged and swallowed —
 * a failed bump only means cached grants live until their next natural
 * refresh, and the write path must never fail on cache bookkeeping.
 */
export async function bumpAuthzEpoch({
  organizationId,
}: {
  organizationId: string;
}): Promise<void> {
  const connection = tryGetApp()?.redis;
  if (!connection) return;
  try {
    await connection.incr(`${EPOCH_KEY_PREFIX}${organizationId}`);
  } catch (error) {
    logger.warn({ error, organizationId }, "authz epoch bump failed");
  }
}
