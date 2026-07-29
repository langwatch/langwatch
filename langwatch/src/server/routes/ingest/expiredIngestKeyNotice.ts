import { createLogger } from "@langwatch/observability";

import { splitApiKeyToken } from "~/server/api-key/api-key-token.utils";
import { prisma } from "~/server/db";
import { TtlCache } from "~/server/utils/ttlCache";

const logger = createLogger("langwatch:expired-ingest-key-notice");

/**
 * A coding agent that speaks OTLP directly has no CLI wrapper to tell it
 * its ingestion key died. Claude Code just keeps exporting into a 401
 * and the traces stop arriving with nothing on screen to explain it.
 *
 * So the rejection is recorded against the key's owner and the dashboard
 * says it: a stamp on the user, shown until they dismiss it.
 *
 * Recording is bounded on both ends. A per-key-per-day Redis claim means
 * an agent retrying every few seconds costs one `SET NX EX` per attempt
 * and one database round trip per day, and the stamp itself is two
 * nullable columns on `User`, so nothing accumulates.
 */
const NOTICE_DEDUP_TTL_MS = 24 * 60 * 60 * 1000;

const dedup = new TtlCache<number>(NOTICE_DEDUP_TTL_MS, "expired-ingest-key:");

/**
 * Record that an ingest request was turned away with a LangWatch-minted
 * ingestion key that is no longer usable.
 *
 * Called from the 401 branch of the ingest routes, where a token failed
 * to resolve. That covers not-found, revoked, expired and wrong-secret
 * alike, so the row is re-read here to confirm the key really is one of
 * ours and really is dead before anything is written: a typo in someone
 * else's bearer must not raise a notice on an unrelated account.
 *
 * Never throws. A notice is a courtesy; it must not turn an ingest 401
 * into a 500.
 */
export async function recordExpiredIngestKeyAttempt(token: string): Promise<{
  recorded: boolean;
  reason?: "not_langwatch_key" | "deduplicated" | "key_usable" | "no_owner";
}> {
  try {
    const parts = splitApiKeyToken(token);
    if (!parts) return { recorded: false, reason: "not_langwatch_key" };

    // Claim before reading: the lookup id travels in the token, so the
    // cheap gate runs before any database work.
    const claimed = await dedup.claim(parts.lookupId, Date.now());
    if (!claimed) return { recorded: false, reason: "deduplicated" };

    // Deliberately unfiltered by owner state, unlike the authentication
    // lookup: a key whose owner was deactivated is exactly the case worth
    // attributing. Nothing here authorizes anything.
    const apiKey = await prisma.apiKey.findUnique({
      where: { lookupId: parts.lookupId },
      select: {
        userId: true,
        revokedAt: true,
        expiresAt: true,
        ingestSourceType: true,
      },
    });
    if (!apiKey) return { recorded: false, reason: "not_langwatch_key" };

    const dead =
      apiKey.revokedAt !== null ||
      (apiKey.expiresAt !== null && apiKey.expiresAt < new Date());
    if (!dead) return { recorded: false, reason: "key_usable" };
    if (!apiKey.userId) return { recorded: false, reason: "no_owner" };

    await prisma.user.update({
      where: { id: apiKey.userId },
      data: { expiredIngestKeyAt: new Date() },
      select: { id: true },
    });

    logger.info(
      {
        userId: apiKey.userId,
        ingestSourceType: apiKey.ingestSourceType,
        cause: apiKey.revokedAt !== null ? "revoked" : "expired",
      },
      "recorded expired ingestion key attempt for dashboard notice",
    );
    return { recorded: true };
  } catch (error) {
    logger.warn({ error }, "failed to record expired ingestion key attempt");
    return { recorded: false };
  }
}
