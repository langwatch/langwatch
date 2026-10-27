/**
 * When a grant's end date means it no longer grants (modules/authz/specs/expiring-grants.feature).
 * The write refuses and the read drops on the same boundary, so an accepted expiry grants once.
 */
import type { CollectedBinding } from "@langwatch/authz-contract";

/** Over at exactly its end instant; a non-finite end is never a usable one. */
export function hasGrantEnded({
  expiresAtMs,
  nowMs,
}: {
  expiresAtMs: number;
  nowMs: number;
}): boolean {
  return !Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs;
}

/** The bindings still granting at `nowMs`. An ended one is absent, not revoked. */
export function liveBindings({
  bindings,
  nowMs,
}: {
  bindings: CollectedBinding[];
  nowMs: number;
}): CollectedBinding[] {
  return bindings.filter(
    ({ expiresAtMs }) => expiresAtMs == null || !hasGrantEnded({ expiresAtMs, nowMs }),
  );
}
