/**
 * ADR-092 §12 — the org authz epoch: one integer per organization, bumped on
 * every grant write, compared on every cached read. Redis-backed so all app
 * processes share it; a missing/unavailable epoch disables caching (collect
 * fresh), never staleness.
 *
 * Reads process.env directly (same rationale as server/redis.ts): these are
 * internal rollout knobs, not user configuration.
 */
import { createLogger } from "@langwatch/observability";
import { connection, isBuildOrNoRedis } from "../redis";

const logger = createLogger("langwatch:authz:epoch");

const EPOCH_KEY_PREFIX = "authz:epoch:";

/**
 * Current epoch for an organization, or null when the epoch store is
 * unavailable (build, tests, Redis down) — null means "do not cache".
 */
export async function getAuthzEpoch({
  organizationId,
}: {
  organizationId: string;
}): Promise<number | null> {
  if (isBuildOrNoRedis || !connection) return null;
  try {
    const raw = await connection.get(`${EPOCH_KEY_PREFIX}${organizationId}`);
    if (raw == null) return 0;
    const parsed = Number.parseInt(raw, 10);
    return Number.isNaN(parsed) ? null : parsed;
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
  if (isBuildOrNoRedis || !connection) return;
  try {
    await connection.incr(`${EPOCH_KEY_PREFIX}${organizationId}`);
  } catch (error) {
    logger.warn({ error, organizationId }, "authz epoch bump failed");
  }
}
