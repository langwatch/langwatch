import { RUN_KEY_LIFETIME_MS } from "@langwatch/api-key-contract";

/** A held run key is handed out only while at least this much of its life remains. */
export const RUN_KEY_REUSE_MARGIN_MS = 5 * 60 * 1000;

/** The life a handed-out key must still have: the caller's bound, never under the margin. */
export function runKeyFloorMs(minRemainingMs: number | undefined): number {
  return Math.max(RUN_KEY_REUSE_MARGIN_MS, minRemainingMs ?? 0);
}

/** A fresh key outlives the caller's bound by the reuse window, so it can still be shared. */
export function runKeyLifetimeMs(minRemainingMs: number | undefined): number {
  return Math.max(RUN_KEY_LIFETIME_MS, runKeyFloorMs(minRemainingMs) + RUN_KEY_REUSE_MARGIN_MS);
}

/** A held key serves another run only while it still covers that run's floor. */
export function isRunKeyReusable({
  expiresAtMs,
  nowMs,
  minRemainingMs,
}: {
  expiresAtMs: number;
  nowMs: number;
  minRemainingMs: number | undefined;
}): boolean {
  return expiresAtMs - nowMs >= runKeyFloorMs(minRemainingMs);
}

/** The needed permissions the starter does not hold, in the order they are listed. */
export function missingRunPermissions({
  needed,
  held,
}: {
  needed: readonly string[];
  held: readonly string[];
}): readonly string[] {
  const holds = new Set(held);

  return needed.filter((permission) => !holds.has(permission));
}

/** One key per starter, starting key, project and permission set: a narrower run never borrows. */
export function runKeyCacheKey({
  userId,
  callerApiKeyId,
  projectId,
  permissions,
}: {
  userId: string | null;
  callerApiKeyId?: string | null | undefined;
  projectId: string;
  permissions: readonly string[];
}): string {
  return JSON.stringify([userId, callerApiKeyId ?? null, projectId, [...permissions].toSorted()]);
}
