import { hkdfSync } from "node:crypto";

import type { Instant } from "@langwatch/time";

/** How long one cache key seals; a row sealed one epoch back still opens, and is re-sealed. */
export const QUERY_CACHE_EPOCH_MS = 7 * 24 * 60 * 60 * 1000;

/** Who a browser's mirrored reads belong to: the user, and whoever is browsing as them. */
export type QueryCacheKeyOwner = Readonly<{ userId: string; impersonatorId: string | undefined }>;

/** The epoch the server's clock is in; the browser never computes one. */
export function queryCacheEpochOf({ at }: { at: Instant }): number {
  return Math.floor(at.epochMilliseconds / QUERY_CACHE_EPOCH_MS);
}

/**
 * The 256-bit key a browser seals its mirrored reads under in one epoch; derived, never stored.
 * ponytail: no per-user generation exists, so revoking a user's sessions leaves their disk
 * copy readable to them until the epoch moves on; mix in a generation column to rotate it.
 */
export function queryCacheKeyDeriver({
  secret,
}: {
  secret: string | undefined;
}): (input: QueryCacheKeyOwner & { epoch: number }) => string {
  return ({ userId, impersonatorId, epoch }) => {
    // Fail closed rather than derive from nothing, as the lock-out hasher does.
    if (secret === undefined || secret.length === 0) {
      throw new Error("cannot derive a query-cache key: this deployment named no session secret");
    }
    const info = `lw-query-cache|${userId}|${impersonatorId ?? ""}|${epoch}`;

    return Buffer.from(hkdfSync("sha256", secret, "", info, 32)).toString("base64");
  };
}
