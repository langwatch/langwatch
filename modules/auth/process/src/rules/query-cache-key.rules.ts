import { hkdfSync } from "node:crypto";

import type { Instant } from "@langwatch/time";

/** How long one cache key seals; a row sealed one epoch back still opens, and is re-sealed. */
export const QUERY_CACHE_EPOCH_MS = 7 * 24 * 60 * 60 * 1000;

/** Whose mirrored reads a key seals: the server-resolved session, and who browses as its user. */
export type QueryCacheKeyOwner = Readonly<{
  sessionId: string;
  impersonatorId: string | undefined;
}>;

/** The epoch the server's clock is in; the browser never computes one. */
export function queryCacheEpochOf({ at }: { at: Instant }): number {
  return Math.floor(at.epochMilliseconds / QUERY_CACHE_EPOCH_MS);
}

/**
 * The 256-bit key a browser seals its mirrored reads under, per session and epoch; derived,
 * never stored. A revoked or ended session derives no key again, so its disk copy is dead.
 */
export function queryCacheKeyDeriver({
  secret,
}: {
  secret: string | undefined;
}): (input: QueryCacheKeyOwner & { epoch: number }) => string {
  return ({ sessionId, impersonatorId, epoch }) => {
    // Fail closed rather than derive from nothing, as the lock-out hasher does.
    if (secret === undefined || secret.length === 0) {
      throw new Error("cannot derive a query-cache key: this deployment named no session secret");
    }
    const info = `lw-query-cache|${sessionId}|${impersonatorId ?? ""}|${epoch}`;

    return Buffer.from(hkdfSync("sha256", secret, "", info, 32)).toString("base64");
  };
}
